//! 开发模式下的优雅退出：注册 Windows 控制台 Ctrl+C / 关闭终端处理器。
//!
//! dev 构建是控制台子系统（`main.rs` 仅在 release 设 `windows_subsystem`），
//! 直接 Ctrl+C 会被默认控制台处理器立即终止进程（`ExitProcess`），不经过
//! Tauri 事件循环，导致托盘图标（`Shell_NotifyIcon`）残留为通知区幽灵图标，
//! 直到鼠标悬停才被 Shell 清理。这里把控制台事件接管过来，改为请求
//! `app.exit(0)` 走 Tauri 优雅退出，让退出路径正常销毁窗口与托盘图标。

use windows::core::BOOL;
use windows::Win32::System::Console::{
    SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_C_EVENT, CTRL_CLOSE_EVENT,
    CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT,
};

/// 控制台控制处理器：对所有「终止类」事件接管，改为优雅退出。
///
/// 返回 TRUE 表示已处理，阻止 Windows 默认的立即终止；返回 FALSE 表示
/// 不处理（未知事件交由后续处理器/默认行为）。
unsafe extern "system" fn console_ctrl_handler(ctrl_type: u32) -> BOOL {
    let handled = matches!(
        ctrl_type,
        CTRL_C_EVENT | CTRL_BREAK_EVENT | CTRL_CLOSE_EVENT | CTRL_LOGOFF_EVENT | CTRL_SHUTDOWN_EVENT
    );

    if handled {
        if let Some(app) = crate::screenshot_shared::app_handle() {
            app.exit(0);
        }
    }

    BOOL::from(handled)
}

/// 安装控制台控制处理器。需在全局 app handle 设置后调用（setup 内）。
pub(crate) fn install_graceful_shutdown() {
    // `SetConsoleCtrlHandler` 只在附加了控制台的进程里生效；dev 构建满足，
    // release（GUI 子系统、无控制台）不会走到这里（调用方已按 debug_assertions 编译）。
    unsafe {
        let result = SetConsoleCtrlHandler(Some(console_ctrl_handler), true);
        if result.is_ok() {
            crate::log_to_test_file("console ctrl handler installed: graceful exit on Ctrl+C");
        } else {
            crate::log_to_test_file("could not install console ctrl handler");
        }
    }
}
