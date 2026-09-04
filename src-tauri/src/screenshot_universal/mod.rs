//! 全平台截图（Windows / macOS / Linux X11）。
//!
//! 新增独立工具，与现有 Windows 专属截图（`crate::screenshot`）并存。
//! 架构：xcap 采集 + Webview 全屏覆盖层 + 前端 TS 交互状态机 + 前端 canvas 出图。
//!
//! 会话生命周期：
//! - `screenshot_universal_start`：隐藏主窗口 → 平台检查 → xcap 采集 → 建覆盖层 → 返回 session。
//! - 前端在各覆盖层窗口内取帧渲染、完成选区与标注。
//! - `screenshot_universal_finish`：接收前端 canvas 导出的最终 PNG，走 history-first 完成事务。
//! - `screenshot_universal_cancel`：关闭覆盖层、恢复主窗口。

pub mod capture;
pub mod overlay;

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::AppError;
use capture::{capture_desktop, detect_platform_mode, MonitorCapture, PlatformMode};
use crate::screenshot_shared::types::{
    CancelSessionResult, MainWindowSnapshot, PhysicalDesktopRectI32, ScreenshotTriggerSource,
};

/// 一次会话持有的状态：采集帧、覆盖层 label、主窗口快照。
struct ActiveSession {
    session_id: String,
    /// 覆盖层窗口 label → 采集帧（RGBA 字节，PNG 由读取时编码）。
    frames: HashMap<String, capture::MonitorCapture>,
    /// 帧访问 token → 覆盖层窗口 label。
    frame_tokens: HashMap<String, String>,
    main_window: MainWindowSnapshot,
}

static ACTIVE: OnceLock<Mutex<ActiveSlot>> = OnceLock::new();

fn active_mutex() -> &'static Mutex<ActiveSlot> {
    ACTIVE.get_or_init(|| Mutex::new(ActiveSlot::Idle))
}

/// 会话槽状态：Idle 空闲 / Starting 已预占（采集建窗中）/ Ready 有进行中会话。
enum ActiveSlot {
    Idle,
    Starting,
    Ready(ActiveSession),
}

/// 会话槽「Starting」预留的 RAII 清理：任何提前返回都把预留槽还原为 Idle。
struct StartingReservation;

impl Drop for StartingReservation {
    fn drop(&mut self) {
        if let Ok(mut guard) = active_mutex().lock() {
            if matches!(*guard, ActiveSlot::Starting) {
                *guard = ActiveSlot::Idle;
            }
        }
    }
}

/// 会话开始时返回给前端的覆盖层信息。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartOverlaySession {
    pub session_id: String,
    /// 每个覆盖层窗口一条。
    pub monitors: Vec<OverlayMonitorInfo>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMonitorInfo {
    /// 覆盖层窗口 label 后缀。
    pub monitor_index: u32,
    /// 该显示器物理像素桌面矩形。
    pub desktop_rect: PhysicalDesktopRectI32,
    /// 采集帧访问 token（不透明，一次性）。
    pub frame_token: String,
    /// 采集帧 URL（自定义协议 `frame-image://<token>`），前端 <img> 直接加载，
    /// 绕过 invoke JSON IPC 传输大字节数组（快得多）。
    pub frame_url: String,
    /// 物理像素缩放系数。
    pub scale_factor: f64,
}

/// 生成不透明帧访问 token。
fn new_frame_token() -> String {
    format!("fr-{}", uuid::Uuid::new_v4())
}

/// 采集帧图片协议 scheme。前端用 `<img src="http://frame-image.localhost/<token>">` 直接加载，
/// 数据以 HTTP 响应流式传输，比 invoke 返回 Vec<u8>（JSON 序列化大数组）快得多。
/// 注意：Tauri 自定义协议默认走 http（非 https），CSP 需放行对应 origin。
pub const FRAME_IMAGE_SCHEME: &str = "frame-image";

/// 注册采集帧图片协议。
///
/// 请求格式：`http://frame-image.localhost/<frame_token>`，按 token 查会话内采集帧，
/// 编码 PNG 返回。token 无效返回 404，不泄露帧。
pub fn register_frame_image_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    use tauri::http::{header::CACHE_CONTROL, header::CONTENT_TYPE, Response, StatusCode};

    builder.register_uri_scheme_protocol(FRAME_IMAGE_SCHEME, |_app, request| {
        // 由前置校验保证（内部不变量）：status 为合法常量、body 为空，body() 不会失败。
        let bad = |status| Response::builder().status(status).body(Vec::new()).unwrap();
        let mut segments = request.uri().path().trim_start_matches('/').split('/');
        let Some(token) = segments.next() else {
            return bad(StatusCode::BAD_REQUEST);
        };
        if segments.next().is_some() {
            return bad(StatusCode::BAD_REQUEST);
        }

        let Ok(guard) = active_mutex().lock() else {
            return bad(StatusCode::INTERNAL_SERVER_ERROR);
        };
        let ActiveSlot::Ready(session) = &*guard else {
            return bad(StatusCode::NOT_FOUND);
        };
        let Some(label) = session.frame_tokens.get(token) else {
            return bad(StatusCode::NOT_FOUND);
        };
        let Some(m) = session.frames.get(label) else {
            return bad(StatusCode::NOT_FOUND);
        };
        // 直接返回原始 RGBA 字节：完全绕开 PNG 编码（4K 全屏 PNG 编码需
        // 1~2s，是「loading 转很久」的元凶）。前端 fetch 后 putImageData 渲染。
        // Access-Control-Allow-Origin：fetch 需要 CORS（<img> 不需要）。
        // status/headers 均为合法值（值来自 u32 to_string 的 ASCII 数字），body() 不会失败。
        Response::builder()
            .status(StatusCode::OK)
            .header(CACHE_CONTROL, "no-store")
            .header(CONTENT_TYPE, "application/octet-stream")
            .header("Access-Control-Allow-Origin", "*")
            .header("X-Image-Width", m.rgba.width().to_string())
            .header("X-Image-Height", m.rgba.height().to_string())
            .body(m.rgba.clone().into_raw())
            .unwrap()
    })
}

/// 隐藏主窗口并等待合成稳定（复用了现有截图的等待策略，但非 Windows 用短延时）。
fn hide_main_window_and_wait<R: Runtime>(app: &AppHandle<R>) -> Result<MainWindowSnapshot, String> {
    use std::time::{Duration, Instant};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let snapshot = main_window_snapshot(&window)?;

    window.hide().map_err(|e| format!("主窗口隐藏失败：{e}"))?;

    let deadline = Instant::now() + Duration::from_millis(200);
    loop {
        if !window.is_visible().unwrap_or(false) {
            break;
        }
        if Instant::now() >= deadline {
            let _ = window.show();
            return Err("主窗口隐藏超时，未开始截图".to_string());
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    #[cfg(windows)]
    {
        // Windows 上等待桌面合成稳定，避免采集到隐藏主窗口的残留帧。
        std::thread::sleep(Duration::from_millis(250));
    }
    #[cfg(not(windows))]
    {
        std::thread::sleep(Duration::from_millis(16));
    }

    Ok(snapshot)
}

fn main_window_snapshot<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<MainWindowSnapshot, String> {
    let is_visible = window.is_visible().map_err(|e| format!("查询窗口可见性失败：{e}"))?;
    let was_minimized = window.is_minimized().unwrap_or(false);
    let was_focused = window.is_focused().unwrap_or(false);
    Ok(MainWindowSnapshot {
        exists: true,
        was_visible: is_visible,
        was_minimized,
        was_focused,
        outer_x: window.outer_position().ok().map(|p| p.x),
        outer_y: window.outer_position().ok().map(|p| p.y),
        outer_width: window.outer_size().ok().map(|s| s.width),
        outer_height: window.outer_size().ok().map(|s| s.height),
        route_token: None,
        trigger: ScreenshotTriggerSource::Command,
    })
}

fn restore_main_window<R: Runtime>(app: &AppHandle<R>, snapshot: &MainWindowSnapshot) {
    if !snapshot.exists || !snapshot.was_visible {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        if snapshot.was_minimized {
            let _ = window.minimize();
        }
        if snapshot.was_focused {
            let _ = window.set_focus();
        }
    }
}

/// 供滚动截图会话启动时清理 universal 会话（关闭覆盖层）。
///
/// 滚动截图从覆盖层的「长截图」按钮进入：此时 universal 会话仍持有主窗口
/// 快照与覆盖层。滚动会话接管后，必须取走 universal 会话，否则后续
/// `screenshot_universal_start` 会误判「已有会话进行中」。
///
/// 注意：不恢复主窗口——滚动期间主窗口保持隐藏，由 `scroll_capture_stop`
/// 在滚动完成后恢复。
pub fn take_active_session_for_scroll<R: Runtime>(app: &AppHandle<R>) {
    let guard = active_mutex().lock();
    let Ok(mut guard) = guard else { return };
    let ActiveSlot::Ready(session) = std::mem::replace(&mut *guard, ActiveSlot::Idle) else {
        return;
    };
    overlay::close_all_overlay_windows(app);
    drop(session);
}

/// 开始一次全平台截图会话。
///
/// Windows 上建窗会与消息循环冲突，因此必须是 async 命令（wry 的
/// CreateCoreWebView2Environment 需要 pump 消息；async 让命令在 worker
/// 线程运行，由 send_user_message 派发到事件循环）。
#[tauri::command(async)]
#[specta::specta]
pub fn screenshot_universal_start<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StartOverlaySession, AppError> {
    let session_id = format!("us-{}", uuid::Uuid::new_v4());
    {
        let mut guard = active_mutex()
            .lock()
            .map_err(|e| format!("会话锁不可用：{e}"))?;
        if !matches!(*guard, ActiveSlot::Idle) {
            return Err(AppError::Message("已有全平台截图会话进行中".to_string()));
        }
        // 判忙 + 预占位合并进同一次加锁，消除 TOCTOU：采集（秒级）期间会话槽保持
        // Starting，其他并发 start 会被挡下。
        *guard = ActiveSlot::Starting;
    }
    // 若后续任一步骤提前返回，RAII 把 Starting 还原为 Idle。
    let _starting_reservation = StartingReservation;

    // 平台检查：Wayland 不支持；macOS 权限在采集时以错误字符串判定。
    match detect_platform_mode() {
        PlatformMode::WaylandUnsupported => {
            return Err(AppError::Message(
                "当前 Wayland 会话不支持全平台截图，请在 X11 会话下使用".to_string(),
            ));
        }
        PlatformMode::Supported => {}
    }

    let main_snapshot = hide_main_window_and_wait(&app)?;

    // 采集：失败时恢复主窗口。
    let t_capture = std::time::Instant::now();
    let captures: Vec<MonitorCapture> = match capture_desktop() {
        Ok(c) => c,
        Err(e) => {
            restore_main_window(&app, &main_snapshot);
            return Err(AppError::Message(e));
        }
    };
    log::debug!("[universal] 采集耗时 {:?}", t_capture.elapsed());

    // 建覆盖层窗口：失败时恢复主窗口。
    let t_windows = std::time::Instant::now();
    let mut monitors = Vec::with_capacity(captures.len());
    let mut frames = HashMap::with_capacity(captures.len());
    let mut frame_tokens = HashMap::with_capacity(captures.len());

    // 预生成覆盖层 label（固定格式 overlay-<index>），先写入 ACTIVE 会话。
    // 关键：必须在创建窗口前写会话——否则覆盖层 WebView 加载（打包环境
    // 本地文件加载快）可能抢在会话建立前调用 overlay_init，报「没有进行中
    // 的截图会话」。dev 环境加载 localhost 慢，掩盖了该竞态。
    for (idx, m) in captures.iter().enumerate() {
        let label = format!("{}{}", overlay::OVERLAY_LABEL_PREFIX, idx);
        let token = new_frame_token();
        frames.insert(label.clone(), m.clone());
        frame_tokens.insert(token.clone(), label.clone());
        monitors.push(OverlayMonitorInfo {
            monitor_index: idx as u32,
            desktop_rect: m.desktop_rect,
            frame_token: token.clone(),
            frame_url: format!("http://{FRAME_IMAGE_SCHEME}.localhost/{token}"),
            scale_factor: m.scale_factor as f64,
        });
    }

    let mut guard = active_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    *guard = ActiveSlot::Ready(ActiveSession {
        session_id: session_id.clone(),
        frames,
        frame_tokens,
        main_window: main_snapshot.clone(),
    });
    drop(guard);

    // 会话已就绪，再创建覆盖层窗口（label 与预生成一致）。
    for (idx, m) in captures.iter().enumerate() {
        if let Err(e) = overlay::create_overlay_window(
            &app,
            idx as u32,
            m.desktop_rect,
            m.scale_factor as f64,
        ) {
            // 失败：关闭已创建的窗口，清理会话并恢复主窗口。
            for created in 0..idx {
                overlay::close_overlay_window(&app, &format!("{}{}", overlay::OVERLAY_LABEL_PREFIX, created));
            }
            if let Ok(mut g) = active_mutex().lock() {
                *g = ActiveSlot::Idle;
            }
            restore_main_window(&app, &main_snapshot);
            return Err(AppError::Message(e));
        }
    }
    log::debug!("[universal] 建窗耗时 {:?}", t_windows.elapsed());

    Ok(StartOverlaySession { session_id, monitors })
}

/// 按 token 读取采集帧（编码为 PNG 字节）。
#[tauri::command]
#[specta::specta]
pub fn screenshot_universal_read_frame(token: String) -> Result<Vec<u8>, AppError> {
    let guard = active_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    let ActiveSlot::Ready(session) = &*guard else {
        return Err(AppError::Message(
            "没有进行中的全平台截图会话".to_string(),
        ));
    };
    let label = session
        .frame_tokens
        .get(&token)
        .ok_or_else(|| "帧访问令牌无效".to_string())?;
    let m = session.frames.get(label).ok_or_else(|| "采集帧缺失".to_string())?;
    capture::frame_to_png(&m.rgba)
        .map_err(|e| e.to_string())
        .map_err(AppError::Message)
}

/// 覆盖层窗口挂载时查询自己的会话信息。
///
/// 每个覆盖层窗口是独立 WebView，通过窗口 label（`overlay-<index>`）识别
/// 自己的显示器索引，向后端查询对应的采集帧访问 token 与桌面矩形。
#[tauri::command]
#[specta::specta]
pub fn screenshot_universal_overlay_init<R: Runtime>(
    _app: AppHandle<R>,
    webview_window: tauri::WebviewWindow<R>,
) -> Result<OverlayInitInfo, AppError> {
    let label = webview_window.label();
    let index = label
        .strip_prefix(overlay::OVERLAY_LABEL_PREFIX)
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(|| "覆盖层窗口 label 无效".to_string())?;

    let guard = active_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    let ActiveSlot::Ready(session) = &*guard else {
        return Err(AppError::Message(
            "没有进行中的全平台截图会话".to_string(),
        ));
    };
    let m = session
        .frames
        .get(label)
        .ok_or_else(|| "覆盖层窗口不属于当前会话".to_string())?;
    let token = session
        .frame_tokens
        .iter()
        .find(|(_, l)| *l == label)
        .map(|(t, _)| t.clone())
        .ok_or_else(|| "帧访问令牌缺失".to_string())?;

    Ok(OverlayInitInfo {
        session_id: session.session_id.clone(),
        monitor_index: index,
        desktop_rect: m.desktop_rect,
        frame_token: token.clone(),
        frame_url: format!("http://{FRAME_IMAGE_SCHEME}.localhost/{token}"),
        scale_factor: m.scale_factor as f64,
        is_primary: m.is_primary,
        monitor_name: m.name.clone(),
    })
}

/// 覆盖层窗口初始化信息。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInitInfo {
    pub session_id: String,
    pub monitor_index: u32,
    pub desktop_rect: PhysicalDesktopRectI32,
    pub frame_token: String,
    pub frame_url: String,
    pub scale_factor: f64,
    pub is_primary: bool,
    pub monitor_name: String,
}

/// 取消全平台截图会话：关闭覆盖层、恢复主窗口。
#[tauri::command]
#[specta::specta]
pub fn screenshot_universal_cancel<R: Runtime>(
    app: AppHandle<R>,
    session_id: Option<String>,
) -> Result<CancelSessionResult, AppError> {
    let mut guard = active_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    // 先 as_ref() 校验会话 ID，匹配后再 take() 取走。take() 会移除会话，
    // 若先取走再校验，ID 不匹配时会话已丢失、覆盖层卡死。
    let ActiveSlot::Ready(session) = &*guard else {
        return Ok(CancelSessionResult {
            cancelled: false,
            session_id: None,
            generation: None,
        });
    };
    if let Some(sid) = &session_id {
        if &session.session_id != sid {
            return Err(AppError::Message("会话 ID 不匹配".to_string()));
        }
    }
    let session = match std::mem::replace(&mut *guard, ActiveSlot::Idle) {
        ActiveSlot::Ready(session) => session,
        _ => return Err(AppError::Message("会话状态缺失".to_string())),
    };

    overlay::close_all_overlay_windows(&app);
    restore_main_window(&app, &session.main_window);
    Ok(CancelSessionResult {
        cancelled: true,
        session_id: Some(session.session_id),
        generation: None,
    })
}

/// 完成动作。
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum UniversalFinishAction {
    Copy,
    Pin,
    SaveAs,
}

/// 完成一次全平台截图会话。
///
/// 前端已在覆盖层内完成选区与标注，并导出两个 PNG：
/// - `original_png`：未标注的裁剪结果（采集帧按选区裁剪）。
/// - `final_png`：标注后的最终图（前端 canvas 出图）。
///
/// 完成事务是 history-first：先发布历史记录，成功后再执行副作用
/// （复制 / 贴图 / 另存为）。副作用失败保留会话可重试。
#[tauri::command(async)]
#[specta::specta]
pub fn screenshot_universal_finish<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    original_png: Vec<u8>,
    final_png: Vec<u8>,
    action: Option<UniversalFinishAction>,
) -> Result<ConfirmSelectionResult, AppError> {
    use crate::screenshot_shared::history::{
        HistoryImageVariant, HistoryRuntime, PublishHistoryRequest, HistorySource,
    };

    let action = action.unwrap_or(UniversalFinishAction::Copy);

    let (width, height) = decode_png_dimensions(&final_png)?;

    let mut guard = active_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    let ActiveSlot::Ready(session) = &*guard else {
        return Err(AppError::Message(
            "没有进行中的全平台截图会话".to_string(),
        ));
    };
    if session.session_id != session_id {
        return Err(AppError::Message("会话 ID 不匹配".to_string()));
    }

    let artifact_id = format!("universal:{session_id}");

    // history-first：先发布历史，成功后再执行副作用。
    let history = app
        .try_state::<HistoryRuntime>()
        .ok_or_else(|| "截图历史服务不可用".to_string())?;
    let manifest = history.publish(PublishHistoryRequest {
        artifact_id,
        original_png: original_png.clone(),
        final_png: final_png.clone(),
        width,
        height,
        source: HistorySource {
            kind: "universal".to_string(),
            record_id: None,
            variant: None,
        },
    })?;
    let _ = app.emit("screenshot_history_changed", ());

    // 副作用：Copy / Pin / SaveAs。
    match action {
        UniversalFinishAction::Copy => {
            copy_png_to_clipboard(&app, &final_png)?;
        }
        UniversalFinishAction::Pin => {
            let history_state = app.state::<HistoryRuntime>();
            crate::screenshot_shared::pin::pin_create_from_history(
                app.clone(),
                history_state,
                manifest.record_id.clone(),
                HistoryImageVariant::Final,
            )?;
        }
        UniversalFinishAction::SaveAs => {
            save_png_with_dialog(&app, &session_id, &final_png)?;
        }
    }

    // 清理：取走 session、关闭覆盖层、恢复主窗口。
    let session = match std::mem::replace(&mut *guard, ActiveSlot::Idle) {
        ActiveSlot::Ready(session) => session,
        _ => return Err(AppError::Message("会话状态缺失".to_string())),
    };
    overlay::close_all_overlay_windows(&app);
    restore_main_window(&app, &session.main_window);

    Ok(ConfirmSelectionResult { width, height })
}

/// 确认结果。
#[derive(Clone, Debug, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmSelectionResult {
    pub width: u32,
    pub height: u32,
}

fn decode_png_dimensions(png: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(std::io::Cursor::new(png))
        .with_guessed_format()
        .map_err(|e| format!("解析 PNG 格式失败：{e}"))?;
    let dims = reader
        .into_dimensions()
        .map_err(|e| format!("解析 PNG 尺寸失败：{e}"))?;
    Ok((dims.0, dims.1))
}

fn copy_png_to_clipboard<R: Runtime>(_app: &AppHandle<R>, png: &[u8]) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| format!("剪贴板图像解码失败：{e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = rgba.into_raw();
    let mut clipboard = Clipboard::new().map_err(|e| format!("剪贴板不可用：{e}"))?;
    clipboard
        .set_image(ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(data),
        })
        .map_err(|e| format!("写入剪贴板失败：{e}"))
}

fn save_png_with_dialog<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    png: &[u8],
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let selection = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(format!("screenshot-{session_id}.png"))
        .blocking_save_file();
    let Some(selection) = selection else {
        return Ok(()); // 用户取消：不保存，但仍已完成历史发布
    };
    let path = selection
        .into_path()
        .map_err(|e| format!("保存路径无效：{e}"))?;
    crate::screenshot_shared::write_final_png(&path, png)
}
