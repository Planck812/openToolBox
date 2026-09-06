//! 恢复全部贴图交互快捷键的注册与同步。

use crate::log_to_test_file;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{
    find_conflicting_shortcut, registered_shortcut_value, set_registered_shortcut_value,
    set_shortcut_error, ShortcutRuntimeState, ShortcutSyncResponse,
};

/// 恢复全部贴图交互快捷键的默认值（可配置，可在设置页修改）。
pub const DEFAULT_PIN_RECOVERY_SHORTCUT: &str = "Ctrl+Shift+P";

pub fn register_pin_recovery_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    // macOS 上截图功能已停用，而贴图（pin）由截图产生，此快捷键无对象可作用，
    // 一并不注册，免得白占一个全局热键。
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
            let registry =
                app_handle.state::<std::sync::Arc<crate::screenshot_shared::pin::PinRegistry>>();
            if let Err(error) =
                crate::screenshot_shared::pin::pin_enable_all_interaction(app_handle.clone(), registry)
            {
                log_to_test_file(&format!("pin recovery shortcut failed: {error}"));
            }
        })
        .map_err(|error| error.to_string())
}

/// 同步恢复全部贴图交互快捷键：先取消旧的，再注册新的；校验与其他快捷键的冲突。
#[tauri::command]
#[specta::specta]
pub fn sync_pin_recovery_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
    // 贴图随截图功能一并停用：如实返回「未注册」，避免日志报成功而与实际相反。
    #[cfg(not(screenshot_supported))]
    {
        let _ = (&app, &shortcut_state, &shortcut);
        return ShortcutSyncResponse {
            success: true,
            requested_shortcut: shortcut,
            registered_shortcut: None,
            error: Some("当前平台已停用截图/贴图功能".to_string()),
        };
    }

    #[cfg(screenshot_supported)]
    {
    let normalized = shortcut.trim().to_string();
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
    if let Some(conflict) = find_conflicting_shortcut(&shortcut_state, &normalized, "恢复全部贴图交互") {
        let error = format!("恢复全部贴图交互快捷键不能与{}相同", conflict);
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    if let Some(prev) = registered_shortcut_value(&shortcut_state.registered_pin_recovery_shortcut) {
        let _ = app.global_shortcut().unregister(prev.as_str());
    }

    match register_pin_recovery_shortcut(&app, &normalized) {
        Ok(_) => {
            set_registered_shortcut_value(
                &shortcut_state.registered_pin_recovery_shortcut,
                Some(normalized.clone()),
            );
            set_shortcut_error(&shortcut_state, None);
            ShortcutSyncResponse {
                success: true,
                requested_shortcut: normalized.clone(),
                registered_shortcut: Some(normalized),
                error: None,
            }
        }
        Err(error) => {
            set_shortcut_error(&shortcut_state, Some(error.clone()));
            ShortcutSyncResponse {
                success: false,
                requested_shortcut: normalized,
                registered_shortcut: None,
                error: Some(error),
            }
        }
    }
    }
}