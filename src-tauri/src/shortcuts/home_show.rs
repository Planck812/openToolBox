//! 主页唤起 / 窗口唤起快捷键的注册与同步。

use crate::log_to_test_file;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::rebuild::{
    rebuild_all_shortcuts, RebuildConfig, RebuildError, RebuildStage,
};
use super::{
    current_timestamp_millis, registered_shortcut_value, set_registered_shortcut_value,
    set_shortcut_error, ShortcutRuntimeState, ShortcutSyncResponse, ShortcutTriggeredPayload,
};

/// 注册「窗口唤起」快捷键：按下显示并聚焦快速唤起小窗口（quicklaunch），
/// 不再唤起主窗口。由设置页窗口唤起快捷键（默认 Alt+Space）触发。
pub(crate) fn register_quicklaunch_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
) -> Result<(), String> {
    let shortcut_for_handler = shortcut.to_string();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _sc, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            log_to_test_file(&format!(
                "quicklaunch shortcut PRESSED: {}",
                shortcut_for_handler
            ));
            if let Some(window) = app.get_webview_window("quicklaunch") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("quick_launch_requested", ());
            }
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn register_named_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
    event_name: &'static str,
    log_label: &'static str,
) -> Result<(), String> {
    let shortcut_for_handler = shortcut.to_string();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }

            let triggered_at = current_timestamp_millis();
            log_to_test_file(&format!(
                "{} shortcut triggered: {} ({:?})",
                log_label, shortcut_for_handler, event.state
            ));
            crate::tray::show_main_window(app);

            if let Ok(mut last_triggered_at) =
                app.state::<ShortcutRuntimeState>().last_triggered_at.lock()
            {
                *last_triggered_at = Some(triggered_at);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(
                    event_name,
                    ShortcutTriggeredPayload {
                        shortcut: shortcut_for_handler.clone(),
                        triggered_at,
                    },
                );
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn sync_home_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
    sync_shortcut_pair(app, shortcut_state, shortcut, true)
}

#[tauri::command]
#[specta::specta]
pub fn sync_show_shortcut<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
) -> ShortcutSyncResponse {
    sync_shortcut_pair(app, shortcut_state, shortcut, false)
}

fn sync_shortcut_pair<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcut: String,
    is_home_shortcut: bool,
) -> ShortcutSyncResponse {
    let normalized = shortcut.trim().to_string();
    let command_name = if is_home_shortcut {
        "sync_home_shortcut"
    } else {
        "sync_show_shortcut"
    };
    log_to_test_file(&format!("{} requested: {}", command_name, normalized));

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
    let next_home = if is_home_shortcut {
        Some(normalized.clone())
    } else {
        current_home.clone()
    };
    let next_show = if is_home_shortcut {
        current_show.clone()
    } else {
        Some(normalized.clone())
    };

    if next_home.is_some() && next_home == next_show {
        let error = "主页唤起快捷键和窗口唤起快捷键不能相同".to_string();
        set_shortcut_error(&shortcut_state, Some(error.clone()));
        return ShortcutSyncResponse {
            success: false,
            requested_shortcut: normalized,
            registered_shortcut: None,
            error: Some(error),
        };
    }

    let config = RebuildConfig {
        command_name,
        home: next_home.clone(),
        show: next_show.clone(),
        rollback_home: current_home.clone(),
        rollback_show: current_show.clone(),
        universal: None,
        universal_failure_shortcut: None,
        pin_recovery_fatal: true,
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
                RebuildStage::PinRecovery | RebuildStage::Universal => {}
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

    set_registered_shortcut_value(&shortcut_state.registered_home_shortcut, next_home.clone());
    set_registered_shortcut_value(&shortcut_state.registered_show_shortcut, next_show.clone());
    set_shortcut_error(&shortcut_state, None);

    let registered_shortcut = if is_home_shortcut {
        next_home
    } else {
        next_show
    };
    log_to_test_file(&format!("{} - registered: {}", command_name, normalized));

    ShortcutSyncResponse {
        success: true,
        requested_shortcut: normalized,
        registered_shortcut,
        error: None,
    }
}
