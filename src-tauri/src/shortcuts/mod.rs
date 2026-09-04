//! 全局快捷键注册与同步（主页唤起 / 窗口唤起 / 全平台截图 / 便利贴）。

pub mod home_show;
pub mod pin_recovery;
pub mod pipeline;
pub mod rebuild;
pub mod screenshot;
pub mod sticky;
pub mod tool;

use std::collections::HashMap;
use std::sync::Mutex;

use specta::Type;
use tauri::Manager;

pub use pin_recovery::{register_pin_recovery_shortcut, DEFAULT_PIN_RECOVERY_SHORTCUT};
pub use screenshot::{
    register_universal_screenshot_shortcut, DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT,
};
pub use sticky::{
    register_single_sticky_shortcut, register_sticky_shortcut, DEFAULT_SINGLE_STICKY_SHORTCUT,
    DEFAULT_STICKY_SHORTCUT,
};

#[derive(Default)]
pub struct ShortcutRuntimeState {
    pub(crate) registered_home_shortcut: Mutex<Option<String>>,
    pub(crate) registered_show_shortcut: Mutex<Option<String>>,
    pub(crate) registered_universal_screenshot_shortcut: Mutex<Option<String>>,
    pub(crate) registered_sticky_shortcut: Mutex<Option<String>>,
    pub(crate) registered_single_sticky_shortcut: Mutex<Option<String>>,
    pub(crate) registered_pin_recovery_shortcut: Mutex<Option<String>>,
    /// 工具级拉起快捷键：shortcut -> tool_id。
    pub(crate) registered_tool_shortcuts: Mutex<HashMap<String, String>>,
    /// 文本管线拉起快捷键：shortcut -> target（target=`preset:<op>` 或已存管线名）。
    pub(crate) registered_pipeline_shortcuts: Mutex<HashMap<String, String>>,
    pub(crate) last_registration_error: Mutex<Option<String>>,
    pub(crate) last_triggered_at: Mutex<Option<u128>>,
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSyncResponse {
    success: bool,
    requested_shortcut: String,
    registered_shortcut: Option<String>,
    error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutTriggeredPayload {
    shortcut: String,
    triggered_at: u128,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolShortcutTriggeredPayload {
    tool_id: String,
    shortcut: String,
    triggered_at: u128,
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolShortcutsSyncResponse {
    success: bool,
    error: Option<String>,
    errors: HashMap<String, String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineShortcutTriggeredPayload {
    target: String,
    shortcut: String,
    triggered_at: u128,
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineShortcutsSyncResponse {
    success: bool,
    error: Option<String>,
    errors: HashMap<String, String>,
}

/// 当前时间戳（毫秒），用于快捷键触发事件记录。
pub(crate) fn current_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub(crate) fn registered_shortcut_value(field: &Mutex<Option<String>>) -> Option<String> {
    field.lock().ok().and_then(|value| value.clone())
}

pub fn set_registered_shortcut_value(field: &Mutex<Option<String>>, value: Option<String>) {
    if let Ok(mut registered_shortcut) = field.lock() {
        *registered_shortcut = value;
    }
}

pub(crate) fn set_shortcut_error(shortcut_state: &ShortcutRuntimeState, value: Option<String>) {
    if let Ok(mut last_error) = shortcut_state.last_registration_error.lock() {
        *last_error = value;
    }
}

/// 检查候选快捷键是否已被其他已注册快捷键占用（排除 `excluded_label` 自身）。
/// 用于单便利贴 / 恢复全部贴图交互变更时的冲突校验，避免重复注册。
/// 返回与之冲突的快捷键中文标签；无冲突返回 None。
pub(crate) fn find_conflicting_shortcut(
    state: &ShortcutRuntimeState,
    candidate: &str,
    excluded_label: &str,
) -> Option<&'static str> {
    let checks = vec![
        ("主页唤起", registered_shortcut_value(&state.registered_home_shortcut)),
        ("窗口唤起", registered_shortcut_value(&state.registered_show_shortcut)),
        ("全平台截图", registered_shortcut_value(&state.registered_universal_screenshot_shortcut)),
        ("便利贴", registered_shortcut_value(&state.registered_sticky_shortcut)),
        ("单便利贴", registered_shortcut_value(&state.registered_single_sticky_shortcut)),
        ("恢复全部贴图交互", registered_shortcut_value(&state.registered_pin_recovery_shortcut)),
    ];
    for (label, value) in checks {
        if label == excluded_label || value.as_deref() != Some(candidate) {
            continue;
        }
        return Some(label);
    }
    None
}

/// 工具/管线共享的注册值快照：`shortcut -> value` 转成 `(value, shortcut)` 列表。
pub(crate) fn registered_tool_shortcut_map(
    field: &Mutex<HashMap<String, String>>,
) -> Vec<(String, String)> {
    field
        .lock()
        .ok()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// 应用启动时初始化全局快捷键：注册运行状态，并按默认值注册系统级快捷键
/// （贴图恢复 / 全平台截图 / 便利贴 / 单便利贴；配置值由 App.vue 启动时 sync）。
///
/// 单个快捷键注册失败（如组合键被其他程序占用 → ERROR_HOTKEY_ALREADY_REGISTERED）
/// 只降级跳过该键并置运行态为 None，绝不中止应用启动。
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    app.manage(ShortcutRuntimeState::default());
    // 恢复全部贴图交互快捷键：可用值由 App.vue 启动时 sync；这里写默认值并注册。
    set_registered_shortcut_value(
        &app.state::<ShortcutRuntimeState>().registered_pin_recovery_shortcut,
        Some(DEFAULT_PIN_RECOVERY_SHORTCUT.to_string()),
    );
    if let Err(error) =
        register_pin_recovery_shortcut(app.handle(), DEFAULT_PIN_RECOVERY_SHORTCUT)
    {
        log::error!("[shortcuts] 注册贴图恢复快捷键失败，已跳过：{error}");
        set_registered_shortcut_value(
            &app.state::<ShortcutRuntimeState>().registered_pin_recovery_shortcut,
            None,
        );
    }
    // 全平台截图快捷键：setup 用默认值注册（配置值由 App.vue 启动时 sync）。
    set_registered_shortcut_value(
        &app.state::<ShortcutRuntimeState>().registered_universal_screenshot_shortcut,
        Some(DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT.to_string()),
    );
    if let Err(error) =
        register_universal_screenshot_shortcut(app.handle(), DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT)
    {
        log::error!("[shortcuts] 注册全平台截图快捷键失败，已跳过：{error}");
        set_registered_shortcut_value(
            &app.state::<ShortcutRuntimeState>().registered_universal_screenshot_shortcut,
            None,
        );
    }
    // 便利贴快捷键：默认 Ctrl+Shift+N（设置页可配置，配置值后续 sync）。
    set_registered_shortcut_value(
        &app.state::<ShortcutRuntimeState>().registered_sticky_shortcut,
        Some(DEFAULT_STICKY_SHORTCUT.to_string()),
    );
    if let Err(error) = register_sticky_shortcut(app.handle(), DEFAULT_STICKY_SHORTCUT) {
        log::error!("[shortcuts] 注册便利贴快捷键失败，已跳过：{error}");
        set_registered_shortcut_value(
            &app.state::<ShortcutRuntimeState>().registered_sticky_shortcut,
            None,
        );
    }
    // 单便利贴快捷键：按下切换单便利贴开/关。可用值由 App.vue 启动时 sync；这里写默认值并注册。
    set_registered_shortcut_value(
        &app.state::<ShortcutRuntimeState>().registered_single_sticky_shortcut,
        Some(DEFAULT_SINGLE_STICKY_SHORTCUT.to_string()),
    );
    if let Err(error) =
        register_single_sticky_shortcut(app.handle(), DEFAULT_SINGLE_STICKY_SHORTCUT)
    {
        log::error!("[shortcuts] 注册单便利贴快捷键失败，已跳过：{error}");
        set_registered_shortcut_value(
            &app.state::<ShortcutRuntimeState>().registered_single_sticky_shortcut,
            None,
        );
    }
    Ok(())
}
