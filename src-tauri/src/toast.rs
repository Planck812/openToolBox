//! 独立置顶 toast 小窗：屏幕右下角提示，1.5 秒后自动隐藏。
//!
//! 主窗口执行完后台任务后调用 `toast_show` 命令；后端创建/复用 label = "toast"
//! 的透明置顶无边框小窗，定位到主显示器右下角。内容送达前端两条路径：
//! - 首次建窗：webview 加载需要时间，事件可能早于监听，由组件 `toast_get` 读取载荷兜底；
//! - 窗口复用：`toast_show` 事件推送到已运行的前端更新显示。
//!
//! 防死锁关键（真机踩坑 + 探针实测）：
//! `toast_show` 命令跑在主线程，同步 `build()` 会阻塞事件循环 → 所有 IPC 挂起、
//! 主窗口按钮失效。探针实测：**无论共享还是独立 WebView2 环境，同步 build 都永久
//! 死锁**（只能杀进程），所以死锁与数据目录无关，异步投递才是解法。必须先 spawn
//! 后台线程、再在后台线程里 `run_on_main_thread` 投递——直接 `run_on_main_thread`
//! 会同步执行闭包，build() 照样阻塞。这段绕行不可省。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::error::AppError;
use specta::Type;

const TOAST_LABEL: &str = "toast";
const TOAST_WIDTH: f64 = 340.0;
const TOAST_HEIGHT: f64 = 56.0;
const TOAST_DURATION_MS: u64 = 1500;
// 屏幕边距：水平 24px；垂直 44px（= 24 + 20，用户反馈默认 24 时偏下，整体上移 20px）。
const SCREEN_MARGIN_X: i32 = 24;
const SCREEN_MARGIN_Y: i32 = 44;

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToastPayload {
    pub message: String,
    pub is_error: bool,
}

pub struct ToastState {
    payload: Mutex<Option<ToastPayload>>,
    /// 显示代次：每次 `toast_show` 递增，隐藏任务仅在其代次仍为最新时才隐藏，
    /// 避免连续 toast 时旧的隐藏线程截短后一条。
    hide_generation: AtomicU64,
}

impl Default for ToastState {
    fn default() -> Self {
        Self {
            payload: Mutex::new(None),
            hide_generation: AtomicU64::new(0),
        }
    }
}

/// 应用启动时初始化 toast：注册状态。
///
/// 原先还会预热独立 WebView2 环境；改用主窗口环境后无需预热（环境已就绪），
/// 常驻的预热窗及其整套 msedgewebview2 进程一并去掉。
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 右下角 toast 提示窗状态。
    app.manage(ToastState::default());
    Ok(())
}

/// 前端通知显示一条 toast：存载荷、创建/复用并显示小窗，1.5s 后自动隐藏。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn toast_show<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ToastState>,
    message: String,
    is_error: bool,
) -> Result<(), AppError> {
    *state.payload.lock().unwrap() = Some(ToastPayload { message, is_error });
    // 递增显示代次：旧隐藏线程醒来后据此判断自己已过期。
    state.hide_generation.fetch_add(1, Ordering::SeqCst);
    // 命令跑在主线程：直接 run_on_main_thread 会同步执行闭包（build() 阻塞事件循环 → 死锁）。
    // 先 spawn 后台线程，再在后台线程里 run_on_main_thread 异步投递，命令立即返回。
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let inner = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if let Err(error) = show_toast_window(&inner) {
                log::error!("[toast] 显示失败: {error}");
            }
        });
    });
    Ok(())
}

/// ToastRoot 组件挂载时读取当前载荷（首次建窗兜底）。
#[tauri::command]
#[specta::specta]
pub fn toast_get(state: State<'_, ToastState>) -> Option<ToastPayload> {
    state.payload.lock().unwrap().clone()
}

// ---------------------------------------------------------------------------
// 显示逻辑
// ---------------------------------------------------------------------------

/// 创建（或复用）toast 窗，定位右下角后显示并安排自动隐藏。
fn show_toast_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = if let Some(win) = app.get_webview_window(TOAST_LABEL) {
        win
    } else {
        // 不设 data_directory：复用主窗口已就绪的 WebView2 环境（理由见 pin/window.rs）。
        let win = WebviewWindowBuilder::new(app, TOAST_LABEL, WebviewUrl::App("index.html".into()))
            .title("提示")
            .inner_size(TOAST_WIDTH, TOAST_HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|e| format!("创建 toast 窗口失败：{e}"))?;
        win
    };

    position_bottom_right(&window, app)?;
    let _ = window.show();
    // 复用窗口时靠事件推送最新载荷；首建时组件会 invoke toast_get 兜底。
    if let Some(payload) = current_payload(app) {
        let _ = window.emit("toast_show", payload);
    }
    let generation = app.state::<ToastState>().hide_generation.load(Ordering::SeqCst);
    schedule_hide(app, generation);
    Ok(())
}

fn current_payload<R: Runtime>(app: &AppHandle<R>) -> Option<ToastPayload> {
    app.state::<ToastState>().payload.lock().unwrap().clone()
}

/// 定位到主显示器右下角（四周留 24px 边距）。
fn position_bottom_right<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    app: &AppHandle<R>,
) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("读取主显示器失败：{e}"))?
        .ok_or_else(|| "未找到主显示器".to_string())?;
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let win_size = window
        .outer_size()
        .map_err(|e| format!("读取窗口尺寸失败：{e}"))?;
    let x = m_pos.x + m_size.width as i32 - win_size.width as i32 - SCREEN_MARGIN_X;
    let y = m_pos.y + m_size.height as i32 - win_size.height as i32 - SCREEN_MARGIN_Y;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| format!("定位 toast 窗口失败：{e}"))
}

/// 延迟隐藏 toast 窗（窗口方法线程安全，可从工作线程直接调用）。
///
/// `generation` 为本条 toast 的显示代次；睡眠结束后仅当代次仍为最新时才隐藏，
/// 避免连续 `toast_show` 时较早的隐藏任务把后一条 toast 提前隐藏。
fn schedule_hide<R: Runtime>(app: &AppHandle<R>, generation: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(TOAST_DURATION_MS));
        if app.state::<ToastState>().hide_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Some(window) = app.get_webview_window(TOAST_LABEL) {
            let _ = window.hide();
        }
    });
}
