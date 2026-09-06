//! 全平台截图快捷键的注册与同步。

use crate::log_to_test_file;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::rebuild::{
    rebuild_all_shortcuts, RebuildConfig, RebuildError, RebuildStage,
};
use super::{
    registered_shortcut_value, set_registered_shortcut_value, set_shortcut_error,
    ShortcutRuntimeState, ShortcutSyncResponse,
};

/// 全平台截图快捷键的平台默认值（Windows/Linux Ctrl+Shift+D，macOS Cmd+Shift+D）。
///
/// 注意：Ctrl+Shift+A 被系统内另一应用（如 CC Switch）占用会导致
/// RegisterHotKey 返回 ERROR_HOTKEY_ALREADY_REGISTERED，故不使用。
#[cfg(target_os = "macos")]
pub const DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT: &str = "Cmd+Shift+S";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT: &str = "Ctrl+Shift+S";

/// 注册全平台截图快捷键（可配置，由调用方传入当前值）。
///
/// 该快捷键会被 `sync_shortcut_pair` / `sync_screenshot_shortcut` 的
/// `unregister_all` 注销，因此这些全量重建路径必须显式重注册它。
pub fn register_universal_screenshot_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    // macOS 上截图功能已停用（实现存在已知缺陷）。此处直接返回成功而不注册：
    // 快捷键独立于工具注册表，若仍注册，用户按下即会触发那段有问题的代码 ——
    // 光把工具从列表里摘掉挡不住。
    //
    // 在函数入口统一拦截，而非逐个修改调用点：注册路径有初次注册、全量重建、
    // 设置页同步等多处，逐个门禁容易漏。返回 Ok 使上层「同步成功」的逻辑不变，
    // 设置页不会误报失败。
    #[cfg(not(screenshot_supported))]
    {
        let _ = (app, shortcut);
        return Ok(());
    }

    #[cfg(screenshot_supported)]
    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if let Err(e) =
                crate::screenshot_universal::screenshot_universal_start(app_handle.clone())
            {
                log_to_test_file(&format!("全平台截图快捷键触发失败：{e}"));
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn sync_universal_screenshot_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
    // macOS 上截图功能已停用：如实返回「未注册」，而不是让下层空转后报成功。
    // 否则日志会打出「✅ registered」，与实际行为相反，误导后续排查。
    #[cfg(not(screenshot_supported))]
    {
        let _ = (&app, &shortcut_state, &shortcut);
        return ShortcutSyncResponse {
            success: true,
            requested_shortcut: shortcut,
            registered_shortcut: None,
            error: Some("当前平台已停用截图功能".to_string()),
        };
    }

    #[cfg(screenshot_supported)]
    {
    let normalized = shortcut.trim().to_string();
    log_to_test_file(&format!(
        "sync_universal_screenshot_shortcut requested: {}",
        normalized
    ));

    if normalized.is_empty() {
        let error = "快捷键不能为空".to_string();
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    let current_home = registered_shortcut_value(&shortcut_state.registered_home_shortcut);
    let current_show = registered_shortcut_value(&shortcut_state.registered_show_shortcut);
    let current_universal_on_entry =
        registered_shortcut_value(&shortcut_state.registered_universal_screenshot_shortcut);

    // 冲突校验：不得与 home/show 相同。
    if current_home.as_deref() == Some(&normalized) {
        let error = "全平台截图快捷键不能与主页唤起快捷键相同".to_string();
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }
    if current_show.as_deref() == Some(&normalized) {
        let error = "全平台截图快捷键不能与窗口唤起快捷键相同".to_string();
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    let config = RebuildConfig {
        command_name: "sync_universal_screenshot_shortcut",
        home: current_home.clone(),
        show: current_show.clone(),
        rollback_home: current_home.clone(),
        rollback_show: current_show.clone(),
        universal: Some(normalized.clone()),
        universal_failure_shortcut: Some(normalized.clone()),
        pin_recovery_fatal: false,
    };
    match rebuild_all_shortcuts(&app, &shortcut_state, config) {
        Ok(()) => {}
        Err(RebuildError { stage, message }) => {
            match stage {
                RebuildStage::Home => {
                    set_registered_shortcut_value(&shortcut_state.registered_home_shortcut, None);
                }
                RebuildStage::Show => {
                    set_registered_shortcut_value(&shortcut_state.registered_show_shortcut, None);
                }
                RebuildStage::Universal => {
                    set_registered_shortcut_value(
                        &shortcut_state.registered_universal_screenshot_shortcut,
                        current_universal_on_entry.clone(),
                    );
                }
                RebuildStage::PinRecovery => {}
            }
            set_shortcut_error(&shortcut_state, Some(message.clone()));
            return ShortcutSyncResponse {
                success: false,
                requested_shortcut: normalized,
                registered_shortcut: None,
                error: Some(message),
            };
        }
    }

    set_registered_shortcut_value(
        &shortcut_state.registered_universal_screenshot_shortcut,
        Some(normalized.clone()),
    );
    set_shortcut_error(&shortcut_state, None);

    log_to_test_file(&format!(
        "sync_universal_screenshot_shortcut - registered: {}",
        normalized
    ));

    ShortcutSyncResponse {
        success: true,
        requested_shortcut: normalized.clone(),
        registered_shortcut: Some(normalized),
        error: None,
    }
    }
}