//! 工具级拉起快捷键的注册、同步与冲突校验。

use std::collections::HashMap;
use crate::log_to_test_file;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{
    current_timestamp_millis, registered_shortcut_value, registered_tool_shortcut_map,
    ShortcutRuntimeState, ToolShortcutTriggeredPayload, ToolShortcutsSyncResponse,
};

/// 注册单个工具级拉起快捷键：按下时向主窗口 emit `tool_shortcut_triggered{toolId}`。
fn register_tool_shortcut<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut: &str,
    tool_id: String,
) -> Result<(), String> {
    let tool_id_for_handler = tool_id.clone();
    let shortcut_for_handler = shortcut.to_string();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _sc, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            log_to_test_file(&format!(
                "tool shortcut PRESSED: {} -> {}",
                shortcut_for_handler, tool_id_for_handler
            ));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit(
                    "tool_shortcut_triggered",
                    ToolShortcutTriggeredPayload {
                        tool_id: tool_id_for_handler.clone(),
                        shortcut: shortcut_for_handler.clone(),
                        triggered_at: current_timestamp_millis(),
                    },
                );
            }
        })
        .map_err(|error| error.to_string())
}

/// `unregister_all` 重建路径会连工具注册一起注销（如改主页/截图键），
/// 这里从运行时状态补回全部工具快捷键。与 `re_register_sticky_shortcut` 同理。
pub(crate) fn re_register_tool_shortcuts<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    shortcut_state: &tauri::State<'_, ShortcutRuntimeState>,
) {
    let registered = registered_tool_shortcut_map(&shortcut_state.registered_tool_shortcuts);
    for (shortcut, tool_id) in registered {
        if let Err(error) = register_tool_shortcut(app, &shortcut, tool_id) {
            log_to_test_file(&format!(
                "re-register tool shortcut failed {shortcut}: {error}"
            ));
        }
    }
}

/// 纯校验：返回有冲突的 `tool_id -> 原因`；空表即无冲突。仅作内存判断，不动系统注册。
/// `fixed` 为 6 个全局 role 的当前运行值（可能为空）。
pub(crate) fn validate_tool_shortcut_conflicts(
    fixed: &[Option<String>],
    shortcuts: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut errors: HashMap<String, String> = HashMap::new();
    for (tool_id, sc) in shortcuts {
        let sc = sc.trim();
        if sc.is_empty() {
            continue;
        }
        if fixed.iter().flatten().any(|f| f == sc) {
            errors.insert(tool_id.clone(), "与全局快捷键相同".to_string());
        }
    }
    let mut seen: HashMap<&str, &str> = HashMap::new();
    for (tool_id, sc) in shortcuts {
        let sc = sc.trim();
        if sc.is_empty() {
            continue;
        }
        if let Some(existing) = seen.get(sc) {
            if *existing != tool_id.as_str() {
                errors.insert(tool_id.clone(), format!("与其他工具“{existing}”快捷键相同"));
            }
        } else {
            seen.insert(sc, tool_id);
        }
    }
    errors
}

/// 同步工具级拉起快捷键：全量 reconcile（增量增删）+ 冲突校验。
/// 校验先于任何注册变更，冲突时整批拒绝（`success=false` 且不动现有注册）。
#[tauri::command]
#[specta::specta]
pub fn sync_tool_shortcuts<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    shortcut_state: tauri::State<'_, ShortcutRuntimeState>,
    shortcuts: HashMap<String, String>,
) -> ToolShortcutsSyncResponse {
    if !shortcuts.is_empty() {
        log_to_test_file(&format!("sync_tool_shortcuts requested: {:?}", shortcuts));
    }
    // 1. 组装 6 个固定 role 的当前运行值。
    let fixed = vec![
        registered_shortcut_value(&shortcut_state.registered_home_shortcut),
        registered_shortcut_value(&shortcut_state.registered_show_shortcut),
        registered_shortcut_value(&shortcut_state.registered_universal_screenshot_shortcut),
        registered_shortcut_value(&shortcut_state.registered_sticky_shortcut),
        registered_shortcut_value(&shortcut_state.registered_single_sticky_shortcut),
        registered_shortcut_value(&shortcut_state.registered_pin_recovery_shortcut),
    ];
    // 管线注册值并入校验（工具键不得等于管线键）。
    let mut fixed = fixed;
    let pipeline_values: Vec<Option<String>> = registered_tool_shortcut_map(
        &shortcut_state.registered_pipeline_shortcuts,
    )
    .into_iter()
    .map(|(_, v)| Some(v))
    .collect();
    fixed.extend(pipeline_values);

    // 2. 冲突校验（仅收集，不动注册）。
    let errors = validate_tool_shortcut_conflicts(&fixed, &shortcuts);
    if !errors.is_empty() {
        log_to_test_file(&format!("sync_tool_shortcuts - CONFLICT rejected: {:?}", errors));
        return ToolShortcutsSyncResponse {
            success: false,
            error: Some("存在快捷键冲突，请更换组合键".to_string()),
            errors,
        };
    }

    // 3. 增量 reconcile（先注销，再注册）。
    let previous = registered_tool_shortcut_map(&shortcut_state.registered_tool_shortcuts);
    for (old_sc, old_tool) in &previous {
        let kept = shortcuts
            .iter()
            .any(|(tid, nsc)| nsc.trim() == old_sc && tid == old_tool);
        if !kept {
            let _ = app.global_shortcut().unregister(old_sc.as_str());
        }
    }

    let mut registered: HashMap<String, String> = HashMap::new();
    // 本次新增注册成功的键（失败回滚时逐个注销，避免孤儿注册）。
    let mut newly_registered: Vec<String> = Vec::new();
    for (tool_id, sc) in &shortcuts {
        let sc = sc.trim();
        if sc.is_empty() {
            continue;
        }
        registered.insert(sc.to_string(), tool_id.clone());
        let need_register = previous
            .iter()
            .all(|(prev_sc, prev_tool)| prev_sc != sc || prev_tool != tool_id);
        if !need_register {
            continue;
        }
        // 幂等：先注销该串（可能此前属于其他 tool 或为 stale 注册）再注册。
        let _ = app.global_shortcut().unregister(sc);
        if let Err(error) = register_tool_shortcut(&app, sc, tool_id.clone()) {
            log_to_test_file(&format!(
                "sync_tool_shortcuts - FAILED register {sc} -> {tool_id}: {error}"
            ));
            // 回滚：注销本次已注册的键（孤儿），并恢复本批被移除的旧注册，
            // 保持 OS 注册与 registered_tool_shortcuts 旧快照一致。
            for reg_sc in &newly_registered {
                let _ = app.global_shortcut().unregister(reg_sc.as_str());
            }
            for (old_sc, old_tool) in &previous {
                let kept = shortcuts
                    .iter()
                    .any(|(tid, nsc)| nsc.trim() == old_sc && tid == old_tool);
                if !kept {
                    let _ = register_tool_shortcut(&app, old_sc, old_tool.clone());
                }
            }
            return ToolShortcutsSyncResponse {
                success: false,
                error: Some(format!("工具“{tool_id}”快捷键注册失败：{error}")),
                errors,
            };
        }
        newly_registered.push(sc.to_string());
    }

    // 4. 落库。
    if let Ok(mut stored) = shortcut_state.registered_tool_shortcuts.lock() {
        *stored = registered;
    }
    ToolShortcutsSyncResponse {
        success: true,
        error: None,
        errors: HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_tool_shortcut_conflicts;
    use std::collections::HashMap;

    fn fixed_sample() -> Vec<Option<String>> {
        vec![
            Some("Ctrl+Alt+Q".to_string()), // 主页
            Some("Alt+Space".to_string()),  // 窗口
            Some("Ctrl+Shift+S".to_string()), // 全平台截图
            Some("Ctrl+Shift+T".to_string()), // 便利贴
            Some("Ctrl+Shift+E".to_string()), // 单便利贴
            Some("Ctrl+Shift+P".to_string()), // 恢复贴图交互
        ]
    }

    #[test]
    fn empty_map_has_no_conflict() {
        let errors = validate_tool_shortcut_conflicts(&fixed_sample(), &HashMap::new());
        assert!(errors.is_empty());
    }

    #[test]
    fn valid_tool_shortcut_ok() {
        let mut map = HashMap::new();
        map.insert("image-viewer".to_string(), "Ctrl+Alt+1".to_string());
        let errors = validate_tool_shortcut_conflicts(&fixed_sample(), &map);
        assert!(errors.is_empty(), "unexpected conflicts: {errors:?}");
    }

    #[test]
    fn tool_conflicting_with_global_role_rejected() {
        let mut map = HashMap::new();
        map.insert("calculator".to_string(), "Ctrl+Shift+S".to_string()); // 与全平台截图相同
        let errors = validate_tool_shortcut_conflicts(&fixed_sample(), &map);
        assert!(errors.contains_key("calculator"));
    }

    #[test]
    fn two_tools_same_shortcut_flagged_once() {
        let mut map = HashMap::new();
        map.insert("a".to_string(), "Ctrl+Alt+9".to_string());
        map.insert("b".to_string(), "Ctrl+Alt+9".to_string());
        let errors = validate_tool_shortcut_conflicts(&fixed_sample(), &map);
        // 重复键只标记冲突方之一（HashMap 遍历顺序不定，故用 XOR 断言恰一个）。
        assert!(
            errors.contains_key("a") ^ errors.contains_key("b"),
            "expected exactly one of the two tools flagged, got {errors:?}"
        );
    }

    #[test]
    fn empty_shortcut_skipped() {
        let mut map = HashMap::new();
        map.insert("memo".to_string(), "  ".to_string());
        let errors = validate_tool_shortcut_conflicts(&fixed_sample(), &map);
        assert!(errors.is_empty());
    }
}
