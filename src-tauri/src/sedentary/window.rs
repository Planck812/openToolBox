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
#[cfg(sedentary_supported)]
pub(super) fn create_reminder_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // 创建前复查：trigger 异步派发到主线程期间开关可能已被关闭，此时不再弹窗。
    if !app.state::<SedentaryState>().enabled.load(Ordering::Relaxed) {
        return Ok(());
    }
    // 窗口已存在（例如上次打开未关闭）：显示并聚焦，而非重复创建。
    if let Some(win) = app.get_webview_window(SEDENTARY_WINDOW_LABEL) {
        let _ = win.show();
        // 同新建路径：不用 set_focus，避免激活应用把用户从全屏里拽走。
        crate::macos_overlay::focus_panel_without_activating(&win);
        log::info!("[sedentary] 复用已存在的提醒窗口并显示");
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
        // 跟随当前桌面空间显示。macOS 上 `always_on_top` 只把窗口抬到
        // `NSFloatingWindowLevel`，窗口仍归属应用自己的 Space —— 用户切到别的
        // Space 或全屏应用时根本看不到提醒（实测：需手动切回本应用才看见）。
        // 该项设置 `NSWindowCollectionBehavior::CanJoinAllSpaces`，让窗口出现在
        // 当前所在的 Space 上。提醒的价值就在于「打断」，看不到即失效。
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(true)
        // 先隐藏建窗，改类完成后再显示。macOS 上把一个**已显示**的窗口改类并改写
        // styleMask 会触发 AppKit 重建 NSThemeFrame，实测窗口会就此不再显示（提醒
        // 完全不出现、且无任何报错）。快捷唤起面板一直正常，正是因为它建窗时隐藏、
        // 改类后才 show —— 这里对齐同一顺序。
        .visible(false)
        .build();
    let window = result.map_err(|e| format!("创建久坐提醒窗口失败：{e}"))?;

    // 跨 Space 悬浮：`visible_on_all_workspaces` 只覆盖普通 Space，全屏应用的
    // Space 还需要 FullScreenAuxiliary（tao 未暴露，见 macos_overlay 模块）。
    // 提醒的价值在于「打断」，用户正全屏工作时看不到即等于失效。
    crate::macos_overlay::make_window_float_across_spaces(&window);

    // 改类完成后再显示。这里刻意**不用** `set_focus()`：它会激活整个应用，导致
    // 提醒关闭后 macOS 退回本应用主窗口、把用户从全屏应用里拽走。面板凭
    // NonactivatingPanel + 高层级 + CanJoinAllSpaces 已能出现在用户当前所在处，
    // 无需夺走应用级焦点。
    let _ = window.show();
    crate::macos_overlay::focus_panel_without_activating(&window);
    log::info!("[sedentary] 提醒窗口已创建并显示");

    Ok(())
}

/// 关闭久坐提醒弹窗（不存在则为空操作）。
#[cfg(sedentary_supported)]
pub(super) fn close_reminder_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(SEDENTARY_WINDOW_LABEL) {
        // 必须先还原窗口原类再关闭：建窗时把 NSWindow 改类成了 NSPanel 子类，
        // 这会覆盖 WebKit 注册 KVO 时植入的 `NSKVONotifying_*` 类；不还原就关闭，
        // webview 随窗口销毁注销观察者时会因找不到 KVO 登记而抛异常并 SIGABRT
        // （实测崩溃栈：removeFromSuperview → stopObserving → removeObserver）。
        crate::macos_overlay::restore_window_class(&win);
        let _ = win.close();
    }
}
