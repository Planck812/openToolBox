//! 全屏透明覆盖层窗口（Webview）创建与销毁。
//!
//! 每个显示器创建一个 `overlay-<index>` 的透明置顶 Webview 窗口，
//! 覆盖该显示器的物理桌面矩形。窗口内由前端渲染冻结帧 + 选区交互。
//!
//! 注意：Windows 上同步 Tauri command 内创建窗口会死锁（wry 的
//! CreateCoreWebView2Environment 与 tao 消息循环冲突），因此所有建窗
//! 命令必须 `#[tauri::command(async)]`。

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::screenshot_shared::types::PhysicalDesktopRectI32;

/// 覆盖层窗口 label 前缀。
pub const OVERLAY_LABEL_PREFIX: &str = "overlay-";

/// 为指定显示器矩形创建透明覆盖层窗口。
///
/// `desktop_rect` 是物理像素坐标；`monitor_scale` 是显示器的缩放系数，
/// 用于把物理像素换算成窗口定位所需的逻辑像素。
pub fn create_overlay_window<R: Runtime>(
    app: &AppHandle<R>,
    monitor_index: u32,
    desktop_rect: PhysicalDesktopRectI32,
    monitor_scale: f64,
) -> Result<String, String> {
    let label = format!("{OVERLAY_LABEL_PREFIX}{monitor_index}");
    let scale = if monitor_scale > 0.0 { monitor_scale } else { 1.0 };

    let width = desktop_rect.width().ok_or_else(|| "显示器宽度无效".to_string())?;
    let height = desktop_rect
        .height()
        .ok_or_else(|| "显示器高度无效".to_string())?;

    let logical_x = desktop_rect.left as f64 / scale;
    let logical_y = desktop_rect.top as f64 / scale;
    let logical_w = width as f64 / scale;
    let logical_h = height as f64 / scale;

    let url = overlay_window_url(app)?;

    WebviewWindowBuilder::new(app, &label, url)
        .title("全平台截图")
        .position(logical_x, logical_y)
        .inner_size(logical_w, logical_h)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(true)
        // 首次鼠标事件即接受焦点（WebView2 键盘焦点需点击获得）。
        .accept_first_mouse(true)
        // 必须可见创建：WebView2 在隐藏窗口内创建会导致渲染空白（见
        // WebView2Feedback#1077），即使 JS 正常执行页面也不绘制。
        // 「空白过渡」问题由 OverlayView 把 html/body 背景强制透明解决：
        // 加载期间透出桌面而非白底，帧绘制完成后覆盖桌面。
        .visible(true)
        .build()
        .map_err(|e| format!("创建覆盖层窗口失败：{e}"))?;
    // 建窗后强制聚焦，确保 WebView 键盘事件（Z/Alt+C）可达。
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
    }

    Ok(label)
}

/// 覆盖层的应用入口 URL。开发模式指向 dev server，生产使用打包的 index.html。
fn overlay_window_url<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let dev_url = app
            .config()
            .build
            .dev_url
            .as_ref()
            .ok_or_else(|| "开发入口未配置".to_string())?
            .clone();
        Ok(WebviewUrl::External(dev_url))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Ok(WebviewUrl::App("index.html".into()))
    }
}

/// 关闭指定 label 的覆盖层窗口。
pub fn close_overlay_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }
}

/// 关闭全部覆盖层窗口。
pub fn close_all_overlay_windows<R: Runtime>(app: &AppHandle<R>) {
    for label in overlay_labels(app) {
        close_overlay_window(app, &label);
    }
}

/// 收集当前所有覆盖层窗口的 label。
fn overlay_labels<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|k| k.starts_with(OVERLAY_LABEL_PREFIX))
        .cloned()
        .collect()
}
