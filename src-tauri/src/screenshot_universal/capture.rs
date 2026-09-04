//! 全平台截图采集后端：基于 xcap 的三平台全屏冻结帧。
//!
//! 坐标约定：所有平台统一归一为「物理像素」的虚拟桌面坐标。
//! xcap 在不同平台的 x/y/width/height 语义不一致：
//! - Windows / macOS：返回物理像素（dmPosition / CGDisplayBounds 像素）。
//! - Linux X11：返回逻辑像素（已除以 scale_factor）。
//!
//! 这里统一换算为物理像素，前端覆盖层与选区映射只依赖一套坐标系。

use image::RgbaImage;
use serde::Serialize;
#[cfg(not(windows))]
use xcap::Monitor;

/// 一次采集得到的单显示器信息（物理像素 + 原始 RGBA 帧）。
#[derive(Clone, Debug)]
pub struct MonitorCapture {
    /// 显示器索引（与 xcap 返回顺序一致，用于 overlay 窗口 label 后缀）。
    pub index: u32,
    /// 是否主显示器。
    pub is_primary: bool,
    /// 显示器名称（友好名，尽力获取）。
    pub name: String,
    /// 物理像素缩放系数（1.0 = 100%）。
    pub scale_factor: f32,
    /// 物理像素桌面矩形（虚拟桌面坐标）。
    pub desktop_rect: crate::screenshot_shared::types::PhysicalDesktopRectI32,
    /// 采集帧（RGBA，逐行连续，尺寸 = 物理像素）。PNG 编码延迟到协议
    /// 请求时再进行并缓存，避免阻塞「建窗 + 返回」的关键路径。
    pub rgba: RgbaImage,
}

/// 平台支持情况。
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformMode {
    /// 支持截图（Windows / macOS / Linux X11）。
    Supported,
    /// Linux Wayland 会话：不支持。
    WaylandUnsupported,
}

/// 检测当前平台是否支持截图。
///
/// 只在入口做一次轻量检测（Linux Wayland 会话不支持）；
/// macOS 屏幕录制权限在采集失败时以特定错误字符串表达。
pub fn detect_platform_mode() -> PlatformMode {
    if cfg!(target_os = "linux") && is_wayland_session() {
        return PlatformMode::WaylandUnsupported;
    }
    PlatformMode::Supported
}

fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
}

/// 采集全屏冻结帧的统一入口。
///
/// - Windows：用 DXGI Desktop Duplication（`crate::screenshot_shared::capture` 的
///   DXGI 后端，GPU 直读，远快于 xcap 的 GDI BitBlt 全屏拷贝）。
/// - macOS / Linux X11：用 xcap。
pub fn capture_desktop() -> Result<Vec<MonitorCapture>, String> {
    #[cfg(windows)]
    {
        capture_desktop_dxgi()
    }
    #[cfg(not(windows))]
    {
        capture_desktop_xcap()
    }
}

/// Windows：DXGI Desktop Duplication 采集。
///
/// 复用现有 `screenshot::capture` 的 DXGI 后端，把 `DesktopSnapshot`
/// （BGRA 帧）转换为 `MonitorCapture`（PNG 缓存）。
#[cfg(windows)]
fn capture_desktop_dxgi() -> Result<Vec<MonitorCapture>, String> {
    use crate::screenshot_shared::capture::{create_backend, CaptureOptions};

    let mut backend = create_backend().map_err(|e| e.message)?;
    let snapshot = backend
        .capture_all(CaptureOptions::default())
        .map_err(|e| e.message)?;

    // BGRA → RGBA 通道交换（纯 CPU，并行）。PNG 编码延迟到协议请求时。
    let converted = std::thread::scope(|scope| {
        let handles: Vec<_> = snapshot
            .monitors
            .iter()
            .enumerate()
            .map(|(index, m)| {
                scope.spawn(move || {
                    let mut rgba = m.frame.buffer.clone();
                    for px in rgba.chunks_exact_mut(4) {
                        px.swap(0, 2);
                    }
                    let img = RgbaImage::from_raw(m.frame.width, m.frame.height, rgba)
                        .ok_or_else(|| "采集帧像素数据无效".to_string())?;
                    Ok::<MonitorCapture, String>(MonitorCapture {
                        index: index as u32,
                        is_primary: false, // DXGI 后端未标记主屏；排序由桌面坐标决定
                        name: format!("Display {index}"),
                        scale_factor: m.scale_factor as f32,
                        desktop_rect: m.desktop_rect,
                        rgba: img,
                    })
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().map_err(|_| "转换线程异常退出".to_string()).and_then(|r| r))
            .collect::<Result<Vec<_>, String>>()
    })?;

    let mut out = converted;
    // 稳定排序：主屏优先（DXGI 首屏通常为主），再按桌面位置。
    out.sort_by_key(|m| {
        (
            m.desktop_rect.left,
            m.desktop_rect.top,
            m.index,
        )
    });
    Ok(out)
}

/// macOS / Linux X11：xcap 采集。
///
/// xcap 的 `Monitor` 不是 `Send`（内部含平台句柄），无法把采集移入线程；
/// 但 PNG 编码是纯 CPU 操作、输入帧数据可 Send，因此在多显示器时把编码
/// 并行执行，缩短编码耗时（多屏下编码是主要瓶颈之一）。
#[cfg(not(windows))]
fn capture_desktop_xcap() -> Result<Vec<MonitorCapture>, String> {
    let monitors = Monitor::all().map_err(|e| format!("枚举显示器失败：{e}"))?;
    if monitors.is_empty() {
        return Err("未找到可用显示器".to_string());
    }

    // 串行采集（xcap Monitor 非 Send），拿到每屏原始帧 + 元数据。
    struct Pending {
        index: u32,
        is_primary: bool,
        name: String,
        scale_factor: f32,
        desktop_rect: crate::screenshot_shared::types::PhysicalDesktopRectI32,
        frame: RgbaImage,
    }

    let mut pending = Vec::with_capacity(monitors.len());
    for (index, monitor) in monitors.iter().enumerate() {
        let frame = monitor.capture_image().map_err(|e| {
            #[cfg(target_os = "macos")]
            {
                // macOS 无屏幕录制权限时 capture_image 失败，映射为可操作错误。
                if is_macos_capture_denied(&e) {
                    return "缺少屏幕录制权限，请在系统设置中允许后重试".to_string();
                }
            }
            format!("截屏失败：{e}")
        })?;
        let is_primary = monitor.is_primary().unwrap_or(false);
        let name = monitor.name().unwrap_or_else(|_| format!("Monitor {index}"));
        let scale_factor = monitor.scale_factor().unwrap_or(1.0);

        // 物理像素矩形。Windows/macOS 的 x/y 已是物理；Linux X11 是逻辑，乘以缩放恢复物理。
        let (px, py, pw, ph) = physical_monitor_rect(monitor, scale_factor);

        let desktop_rect = crate::screenshot_shared::types::PhysicalDesktopRectI32::new(
            px,
            py,
            px
                .checked_add(pw)
                .ok_or_else(|| "显示器宽度溢出".to_string())?,
            py
                .checked_add(ph)
                .ok_or_else(|| "显示器高度溢出".to_string())?,
        )
        .ok_or_else(|| format!("显示器 {index} 几何无效"))?;

        pending.push(Pending {
            index: index as u32,
            is_primary,
            name,
            scale_factor,
            desktop_rect,
            frame,
        });
    }

    // xcap 返回的帧已是 RGBA（无需通道交换），PNG 编码延迟到协议请求时。
    let mut out: Vec<MonitorCapture> = pending
        .into_iter()
        .map(|p| MonitorCapture {
            index: p.index,
            is_primary: p.is_primary,
            name: p.name,
            scale_factor: p.scale_factor,
            desktop_rect: p.desktop_rect,
            rgba: p.frame,
        })
        .collect();

    // 稳定排序：优先主显示器，再按桌面位置（左→右、上→下），保证 overlay 窗口顺序稳定。
    out.sort_by_key(|m| {
        (
            !m.is_primary,
            m.desktop_rect.top,
            m.desktop_rect.left,
            m.index,
        )
    });

    Ok(out)
}

/// 返回显示器的物理像素 x/y/width/height（虚拟桌面坐标）。
///
/// xcap 在 Linux X11 下 x/y/width/height 返回逻辑像素（除以 scale_factor），
/// Windows/macOS 返回物理像素。这里统一乘回缩放恢复物理像素，保证跨平台一致。
#[cfg(not(windows))]
fn physical_monitor_rect(monitor: &Monitor, scale_factor: f32) -> (i32, i32, i32, i32) {
    let x = monitor.x().unwrap_or(0);
    let y = monitor.y().unwrap_or(0);
    let w = monitor.width().unwrap_or(0);
    let h = monitor.height().unwrap_or(0);

    #[cfg(target_os = "linux")]
    {
        let sf = if scale_factor > 0.0 { scale_factor } else { 1.0 };
        (
            ((x as f32) * sf).round() as i32,
            ((y as f32) * sf).round() as i32,
            ((w as f32) * sf).round() as i32,
            ((h as f32) * sf).round() as i32,
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = scale_factor;
        (x, y, w as i32, h as i32)
    }
}

/// 判断 macOS 截屏失败是否由缺少屏幕录制权限引起。
///
/// macOS 无屏幕录制权限时 `CGWindowListCreateImage` 返回空 CGImage，
/// xcap 的 `macos/capture.rs` 中 `RgbaImage::from_raw` 因此返回
/// `RgbaImage::from_raw failed`。匹配该典型错误即可判定权限问题。
#[cfg(target_os = "macos")]
fn is_macos_capture_denied(err: &xcap::XCapError) -> bool {
    matches!(err, xcap::XCapError::Error(msg) if msg.contains("from_raw"))
}

/// 将采集帧转为 PNG 字节，供前端 `<img>` 显示。采集时调用一次并缓存到
/// `MonitorCapture::png`，后续协议响应复用缓存，不再重复编码。
pub fn frame_to_png(frame: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    frame
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("编码采集帧失败：{e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wayland_detected_only_on_linux() {
        // Windows 上绝不应误判为 Wayland（即使环境变量被污染）。
        std::env::set_var("XDG_SESSION_TYPE", "wayland");
        let mode = detect_platform_mode();
        if cfg!(target_os = "linux") {
            assert_eq!(mode, PlatformMode::WaylandUnsupported);
        } else {
            assert_eq!(mode, PlatformMode::Supported);
        }
    }
}
