//! 久坐提醒弹窗窗口（仅 Windows）：创建/关闭，复用主窗口的 WebView2 环境。
//!
//! 原先用独立 `sedentary-webview` 目录 + 常驻预热窗，理由是"首次建窗要初始化全新
//! 环境，同步 build() 会阻塞事件循环导致 IPC 全挂"。探针实测表明：死锁源于同步
//! build 本身（共享环境下同样永久死锁），与数据目录无关。改用主窗口已就绪的环境后
//! 预热失去意义，而建窗仍须经 `run_on_main_thread` 异步投递（见 mod.rs 的触发路径）。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use super::SedentaryState;

/// 弹窗窗口路由（vite 多入口 reminder.html）。
const SEDENTARY_WINDOW_APP_ROUTE: &str = "reminder.html";
/// 弹窗窗口 label。
const SEDENTARY_WINDOW_LABEL: &str = "sedentary-reminder";

/// 创建（或显示已存在）久坐提醒弹窗：透明、置顶、无边框大窗，独立 WebView2 数据目录。
#[cfg(windows)]
pub(super) fn create_reminder_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // 创建前复查：trigger 异步派发到主线程期间开关可能已被关闭，此时不再弹窗。
    if !app.state::<SedentaryState>().enabled.load(Ordering::Relaxed) {
        return Ok(());
    }
    // 窗口已存在（例如上次打开未关闭）：显示并聚焦，而非重复创建。
    if let Some(win) = app.get_webview_window(SEDENTARY_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url = WebviewUrl::App(SEDENTARY_WINDOW_APP_ROUTE.into());

    // 不设 data_directory：复用主窗口已就绪的 WebView2 环境（理由见 pin/window.rs）。
    let result = WebviewWindowBuilder::new(app, SEDENTARY_WINDOW_LABEL, url)
        .title("久坐提醒")
        .inner_size(640.0, 400.0)
        .center()
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .visible(true)
        .build();
    result.map_err(|e| format!("创建久坐提醒窗口失败：{e}"))?;

    Ok(())
}

/// 关闭久坐提醒弹窗（不存在则为空操作）。
#[cfg(windows)]
pub(super) fn close_reminder_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(SEDENTARY_WINDOW_LABEL) {
        let _ = win.close();
    }
}
