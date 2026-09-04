//! 便利贴 / 单便利贴快捷键的注册与同步。

use crate::log_to_test_file;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{
    find_conflicting_shortcut, registered_shortcut_value, set_registered_shortcut_value,
    set_shortcut_error, ShortcutRuntimeState, ShortcutSyncResponse,
};

/// 便利贴快捷键：按下时贴出便利贴（直接调 sticky_create）。
pub const DEFAULT_STICKY_SHORTCUT: &str = "Ctrl+Shift+T";

/// 单便利贴快捷键：按下切换单便利贴开/关（固定 Ctrl+Shift+E，不在设置页暴露）。
pub const DEFAULT_SINGLE_STICKY_SHORTCUT: &str = "Ctrl+Shift+E";

pub fn register_sticky_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if let Err(e) = crate::sticky::sticky_create(
                app.clone(),
                app.state::<crate::sticky::StickyState>(),
                None,
            ) {
                log_to_test_file(&format!("便利贴快捷键触发失败：{e}"));
            }
        })
        .map_err(|error| error.to_string())
}

/// 注册单便利贴快捷键：按下调 `sticky_single_toggle` 切换开/关。
///
/// 幂等：`unregister_all` 重建路径可能已存在同值注册，注册前先 `unregister(shortcut)`
/// （忽略错误），避免「快捷键重复注册」报错。
pub fn register_single_sticky_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    let _ = app.global_shortcut().unregister(shortcut);
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if let Err(e) = crate::sticky::sticky_single_toggle(
                app.clone(),
                app.state::<crate::sticky::StickyState>(),
            ) {
                log_to_test_file(&format!("单便利贴快捷键触发失败：{e}"));
            }
        })
        .map_err(|error| error.to_string())
}

/// `unregister_all` 会连便利贴快捷键一起注销，这里统一补回，
/// 否则改主页/显示/全平台截图快捷键后，便利贴快捷键会静默失效。
pub(crate) fn re_register_sticky_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_state: &tauri::State<'_, ShortcutRuntimeState>,
    command_name: &str,
) {
    if let Some(sticky_shortcut) =
        registered_shortcut_value(&shortcut_state.registered_sticky_shortcut)
    {
        if let Err(error) = register_sticky_shortcut(app, &sticky_shortcut) {
            log_to_test_file(&format!(
                "{} - failed to re-register sticky shortcut {}: {}",
                command_name, sticky_shortcut, error
            ));
        }
    }
    // 单便利贴快捷键（可配置）同样会被 unregister_all 注销，
    // 这里一并补回（覆盖 sync_shortcut_pair / sync_universal_screenshot_shortcut 全部路径）。
    let single_sticky = registered_shortcut_value(&shortcut_state.registered_single_sticky_shortcut)
        .unwrap_or_else(|| DEFAULT_SINGLE_STICKY_SHORTCUT.to_string());
    if let Err(error) = register_single_sticky_shortcut(app, &single_sticky) {
        log_to_test_file(&format!(
            "{} - failed to re-register single sticky shortcut {}: {}",
            command_name, single_sticky, error
        ));
    }
}

/// 同步便利贴快捷键：先做冲突校验，再取消旧的、注册新的（独立管理，不触碰其他快捷键）。
#[tauri::command]
#[specta::specta]
pub fn sync_sticky_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
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

    // 冲突校验（先于任何注册变更）：便利贴键不得与其它全局快捷键相同。
    if let Some(conflict) = find_conflicting_shortcut(&shortcut_state, &normalized, "便利贴") {
        let error = format!("便利贴快捷键不能与{}相同", conflict);
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    // 记录旧值，注册失败时回滚恢复。
    let prev = registered_shortcut_value(&shortcut_state.registered_sticky_shortcut);

    // 取消旧的便利贴快捷键。
    if let Some(prev_sc) = prev.as_deref() {
        let _ = app.global_shortcut().unregister(prev_sc);
    }

    // 注册新的。
    match register_sticky_shortcut(&app, &normalized) {
        Ok(_) => {
            set_registered_shortcut_value(
                &shortcut_state.registered_sticky_shortcut,
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
            // 回滚：注册失败时恢复旧键，保持 OS 注册与运行态一致。
            if let Some(prev_sc) = prev.as_deref() {
                let _ = register_sticky_shortcut(&app, prev_sc);
            }
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

/// 同步单便利贴快捷键：先取消旧的，再注册新的；校验与其他快捷键的冲突。
#[tauri::command]
#[specta::specta]
pub fn sync_single_sticky_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
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
    if let Some(conflict) = find_conflicting_shortcut(&shortcut_state, &normalized, "单便利贴") {
        let error = format!("单便利贴快捷键不能与{}相同", conflict);
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    if let Some(prev) = registered_shortcut_value(&shortcut_state.registered_single_sticky_shortcut) {
        let _ = app.global_shortcut().unregister(prev.as_str());
    }

    match register_single_sticky_shortcut(&app, &normalized) {
        Ok(_) => {
            set_registered_shortcut_value(
                &shortcut_state.registered_single_sticky_shortcut,
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
