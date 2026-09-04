//! 文本管线拉起快捷键的注册、同步与冲突校验。

use std::collections::HashMap;
use crate::log_to_test_file;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::tool::validate_tool_shortcut_conflicts;
use super::{
    current_timestamp_millis, registered_shortcut_value, registered_tool_shortcut_map,
    PipelineShortcutTriggeredPayload, PipelineShortcutsSyncResponse, ShortcutRuntimeState,
};

/// 注册单个文本管线拉起快捷键：按下向主窗口 emit `pipeline_shortcut_triggered{target}`。
fn register_pipeline_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
    target: String,
) -> Result<(), String> {
    let target_for_handler = target.clone();
    let shortcut_for_handler = shortcut.to_string();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _sc, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            log_to_test_file(&format!(
                "pipeline shortcut PRESSED: {} -> {}",
                shortcut_for_handler, target_for_handler
            ));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(
                    "pipeline_shortcut_triggered",
                    PipelineShortcutTriggeredPayload {
                        target: target_for_handler.clone(),
                        shortcut: shortcut_for_handler.clone(),
                        triggered_at: current_timestamp_millis(),
                    },
                );
            }
        })
        .map_err(|error| error.to_string())
}

/// `unregister_all` 重建路径补回管线注册。与 `re_register_tool_shortcuts` 同理。
pub(crate) fn re_register_pipeline_shortcuts<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_state: &tauri::State<'_, ShortcutRuntimeState>,
) {
    let registered = registered_tool_shortcut_map(&shortcut_state.registered_pipeline_shortcuts);
    for (shortcut, target) in registered {
        if let Err(error) = register_pipeline_shortcut(app, &shortcut, target) {
            log_to_test_file(&format!(
                "re-register pipeline shortcut failed {shortcut}: {error}"
            ));
        }
    }
}

/// 同步文本管线拉起快捷键：镜像 `sync_tool_shortcuts`（增量 reconcile + 交叉冲突校验，
/// 管线键不得等于 6 个全局 role 或任一书签工具键）。
#[tauri::command]
#[specta::specta]
pub fn sync_pipeline_shortcuts<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcuts: HashMap<String, String>,
) -> PipelineShortcutsSyncResponse {
    if !shortcuts.is_empty() {
        log_to_test_file(&format!(
            "sync_pipeline_shortcuts requested: {:?}",
            shortcuts
        ));
    }
    let fixed = vec![
        registered_shortcut_value(&shortcut_state.registered_home_shortcut),
        registered_shortcut_value(&shortcut_state.registered_show_shortcut),
        registered_shortcut_value(&shortcut_state.registered_universal_screenshot_shortcut),
        registered_shortcut_value(&shortcut_state.registered_sticky_shortcut),
        registered_shortcut_value(&shortcut_state.registered_single_sticky_shortcut),
        registered_shortcut_value(&shortcut_state.registered_pin_recovery_shortcut),
    ];
    let tool_values: Vec<Option<String>> = registered_tool_shortcut_map(
        &shortcut_state.registered_tool_shortcuts,
    )
    .into_iter()
    .map(|(_, v)| Some(v))
    .collect();
    let all_fixed = [fixed, tool_values].concat();

    let errors = validate_tool_shortcut_conflicts(&all_fixed, &shortcuts);
    if !errors.is_empty() {
        log_to_test_file(&format!(
            "sync_pipeline_shortcuts - CONFLICT rejected: {:?}",
            errors
        ));
        return PipelineShortcutsSyncResponse {
            success: false,
            error: Some("存在快捷键冲突，请更换组合键".to_string()),
            errors,
        };
    }

    let previous = registered_tool_shortcut_map(&shortcut_state.registered_pipeline_shortcuts);
    for (old_sc, old_target) in &previous {
        let kept = shortcuts
            .iter()
            .any(|(target, nsc)| nsc.trim() == old_sc && target == old_target);
        if !kept {
            let _ = app.global_shortcut().unregister(old_sc.as_str());
        }
    }

    let mut registered: HashMap<String, String> = HashMap::new();
    // 本次新增注册成功的键（失败回滚时逐个注销，避免孤儿注册）。
    let mut newly_registered: Vec<String> = Vec::new();
    for (target, sc) in &shortcuts {
        let sc = sc.trim();
        if sc.is_empty() {
            continue;
        }
        registered.insert(sc.to_string(), target.clone());
        let need_register = previous
            .iter()
            .all(|(prev_sc, prev_target)| prev_sc != sc || prev_target != target);
        if !need_register {
            continue;
        }
        let _ = app.global_shortcut().unregister(sc);
        if let Err(error) = register_pipeline_shortcut(&app, sc, target.clone()) {
            log_to_test_file(&format!(
                "sync_pipeline_shortcuts - FAILED register {sc} -> {target}: {error}"
            ));
            // 回滚：注销本次已注册的键（孤儿），并恢复本批被移除的旧注册，
            // 保持 OS 注册与 registered_pipeline_shortcuts 旧快照一致。
            for reg_sc in &newly_registered {
                let _ = app.global_shortcut().unregister(reg_sc.as_str());
            }
            for (old_sc, old_target) in &previous {
                let kept = shortcuts
                    .iter()
                    .any(|(tgt, nsc)| nsc.trim() == old_sc && tgt == old_target);
                if !kept {
                    let _ = register_pipeline_shortcut(&app, old_sc, old_target.clone());
                }
            }
            return PipelineShortcutsSyncResponse {
                success: false,
                error: Some(format!("管线“{target}”快捷键注册失败：{error}")),
                errors,
            };
        }
        newly_registered.push(sc.to_string());
    }

    if let Ok(mut stored) = shortcut_state.registered_pipeline_shortcuts.lock() {
        *stored = registered;
    }
    PipelineShortcutsSyncResponse {
        success: true,
        error: None,
        errors: HashMap::new(),
    }
}

#[cfg(test)]
mod pipeline_tests {
    use super::validate_tool_shortcut_conflicts;
    use std::collections::HashMap;

    #[test]
    fn pipeline_conflicts_with_tool_value_when_in_fixed() {
        // fixed 含一张工具注册值（如 image-viewer -> Ctrl+Alt+1）
        let fixed = vec![Some("Ctrl+Alt+1".to_string()), None, None];
        let mut map = HashMap::new();
        map.insert("preset:url_decode".to_string(), "Ctrl+Alt+1".to_string());
        let errors = validate_tool_shortcut_conflicts(&fixed, &map);
        assert!(errors.contains_key("preset:url_decode"));
    }

    #[test]
    fn pipeline_dup_within_map_flagged_once() {
        let mut map = HashMap::new();
        map.insert("preset:url_decode".to_string(), "Ctrl+Shift+1".to_string());
        map.insert("我的清洗".to_string(), "Ctrl+Shift+1".to_string());
        let errors = validate_tool_shortcut_conflicts(&[], &map);
        assert!(
            errors.contains_key("preset:url_decode") ^ errors.contains_key("我的清洗"),
            "exactly one should be flagged: {errors:?}"
        );
    }
}
