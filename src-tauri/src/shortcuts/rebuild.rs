//! 全量重建：`unregister_all` + 全量重注册，失败时回滚进入前状态。
//!
//! 被 `home_show` / `screenshot` 的 sync 调用，统一承载：
//! unregister_all → 补回便利贴/工具/管线 → 重注册主页/窗口/贴图恢复/全平台截图，
//! 任一失败触发 `restore_previous_shortcuts` 回滚。

use crate::log_to_test_file;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use super::home_show::{register_named_shortcut, register_quicklaunch_shortcut};
use super::pin_recovery::{register_pin_recovery_shortcut, DEFAULT_PIN_RECOVERY_SHORTCUT};
use super::pipeline::re_register_pipeline_shortcuts;
use super::screenshot::{
    register_universal_screenshot_shortcut, DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT,
};
use super::sticky::re_register_sticky_shortcut;
use super::tool::re_register_tool_shortcuts;
use super::{registered_shortcut_value, ShortcutRuntimeState};

/// 重建失败发生的阶段，调用方据此做各自的状态回写。
pub(crate) enum RebuildStage {
    Home,
    Show,
    PinRecovery,
    Universal,
}

/// 重建失败信息：阶段 + 注册层返回的错误文案。
pub(crate) struct RebuildError {
    pub(crate) stage: RebuildStage,
    pub(crate) message: String,
}

/// `rebuild_all_shortcuts` 的入参集合。
pub(crate) struct RebuildConfig {
    /// 日志里使用的命令名（如 `sync_home_shortcut`）。
    pub(crate) command_name: &'static str,
    /// 本次要注册为主页唤起快捷键的值（None 表示不注册）。
    pub(crate) home: Option<String>,
    /// 本次要注册为窗口唤起快捷键的值（None 表示不注册）。
    pub(crate) show: Option<String>,
    /// 回滚时用于恢复的进入前主页唤起值。
    pub(crate) rollback_home: Option<String>,
    /// 回滚时用于恢复的进入前窗口唤起值。
    pub(crate) rollback_show: Option<String>,
    /// 本次要注册的全平台截图快捷键（None 取当前注册值或默认值）。
    pub(crate) universal: Option<String>,
    /// 全平台截图注册失败日志是否带快捷键值（两处调用方日志文案不同）。
    pub(crate) universal_failure_shortcut: Option<String>,
    /// pin recovery 注册失败是否致命（true 时回滚并返回错误，false 仅记日志继续）。
    pub(crate) pin_recovery_fatal: bool,
}

/// Best-effort restore of home/show shortcuts after a registration failure.
/// This is a rollback only; individual failures are logged but not propagated.
fn restore_previous_shortcuts<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_state: &ShortcutRuntimeState,
    home: &Option<String>,
    show: &Option<String>,
) {
    if let Some(ref h) = home {
        if let Err(e) = register_named_shortcut(app, h, "global_shortcut_triggered", "Home") {
            log_to_test_file(&format!(
                "rollback - failed to restore home shortcut {h}: {e}"
            ));
        }
    }
    if let Some(ref s) = show {
        if let Err(e) = register_quicklaunch_shortcut(app, s) {
            log_to_test_file(&format!(
                "rollback - failed to restore show shortcut {s}: {e}"
            ));
        }
    }
    let pin_recovery = registered_shortcut_value(&shortcut_state.registered_pin_recovery_shortcut)
        .unwrap_or_else(|| DEFAULT_PIN_RECOVERY_SHORTCUT.to_string());
    if let Err(error) = register_pin_recovery_shortcut(app, &pin_recovery) {
        log_to_test_file(&format!(
            "rollback - failed to restore pin recovery shortcut: {error}"
        ));
    }
    let universal = registered_shortcut_value(
        &shortcut_state.registered_universal_screenshot_shortcut,
    );
    if let Err(error) =
        register_universal_screenshot_shortcut(app, universal.as_deref().unwrap_or(DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT))
    {
        log_to_test_file(&format!(
            "rollback - failed to restore universal screenshot shortcut: {error}"
        ));
    }
}

/// 统一承载 `unregister_all` + 全量重注册 + 回滚。
///
/// 顺序与历史行为一致：unregister_all → 补回便利贴/工具/管线 →
/// 主页（可选）→ 窗口（可选）→ 贴图恢复 → 全平台截图。
/// 失败时在内部完成回滚并返回 `RebuildError`（阶段 + 错误文案），
/// 调用方按阶段做各自的状态回写后返回失败响应。
pub(crate) fn rebuild_all_shortcuts<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_state: &tauri::State<'_, ShortcutRuntimeState>,
    config: RebuildConfig,
) -> Result<(), RebuildError> {
    let RebuildConfig {
        command_name,
        home,
        show,
        rollback_home,
        rollback_show,
        universal,
        universal_failure_shortcut,
        pin_recovery_fatal,
    } = config;

    match app.global_shortcut().unregister_all() {
        Ok(_) => log_to_test_file(&format!("{} - unregister_all done", command_name)),
        Err(error) => log_to_test_file(&format!(
            "{} - unregister_all failed: {}",
            command_name, error
        )),
    }

    // unregister_all 会连便利贴快捷键一起注销，这里统一补回，
    // 否则改主页/显示快捷键后便利贴快捷键会静默失效。
    re_register_sticky_shortcut(app, shortcut_state, command_name);
    re_register_tool_shortcuts(app, shortcut_state);
    re_register_pipeline_shortcuts(app, shortcut_state);

    if let Some(home) = home.as_deref() {
        if let Err(error) =
            register_named_shortcut(app, home, "global_shortcut_triggered", "Home")
        {
            log_to_test_file(&format!(
                "{} - failed to register home shortcut {}: {}",
                command_name, home, error
            ));
            restore_previous_shortcuts(app, shortcut_state, &rollback_home, &rollback_show);
            return Err(RebuildError {
                stage: RebuildStage::Home,
                message: error,
            });
        }
    }

    if let Some(show) = show.as_deref() {
        if let Err(error) = register_quicklaunch_shortcut(app, show) {
            log_to_test_file(&format!(
                "{} - failed to register show shortcut {}: {}",
                command_name, show, error
            ));
            restore_previous_shortcuts(app, shortcut_state, &rollback_home, &rollback_show);
            return Err(RebuildError {
                stage: RebuildStage::Show,
                message: error,
            });
        }
    }

    let pin_recovery = registered_shortcut_value(&shortcut_state.registered_pin_recovery_shortcut)
        .unwrap_or_else(|| DEFAULT_PIN_RECOVERY_SHORTCUT.to_string());
    if let Err(error) = register_pin_recovery_shortcut(app, &pin_recovery) {
        let error_msg = error.to_string();
        log_to_test_file(&format!(
            "{} - failed to register pin recovery shortcut: {}",
            command_name, error_msg
        ));
        if pin_recovery_fatal {
            restore_previous_shortcuts(app, shortcut_state, &rollback_home, &rollback_show);
            return Err(RebuildError {
                stage: RebuildStage::PinRecovery,
                message: error_msg,
            });
        }
    }

    let universal_value = universal
        .or_else(|| {
            registered_shortcut_value(&shortcut_state.registered_universal_screenshot_shortcut)
        })
        .unwrap_or_else(|| DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT.to_string());
    if let Err(error) = register_universal_screenshot_shortcut(app, &universal_value) {
        let error_msg = error.to_string();
        let message = match universal_failure_shortcut.as_deref() {
            Some(sc) => format!(
                "{} - failed to register universal shortcut {}: {}",
                command_name, sc, error_msg
            ),
            None => format!(
                "{} - failed to register universal screenshot shortcut: {}",
                command_name, error_msg
            ),
        };
        log_to_test_file(&message);
        restore_previous_shortcuts(app, shortcut_state, &rollback_home, &rollback_show);
        return Err(RebuildError {
            stage: RebuildStage::Universal,
            message: error_msg,
        });
    }

    Ok(())
}
