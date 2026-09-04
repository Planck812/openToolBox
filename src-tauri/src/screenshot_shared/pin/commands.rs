//! 全部贴图 IPC 命令与命令辅助函数。
//!
//! 命令经 `mod.rs` re-export（含 Tauri 生成的 `__cmd__<name>` 宏）保持
//! `screenshot_shared::pin::<name>` 路径可解析。托盘菜单辅助
//! （`pin_tray_menu_entries` / `parse_pin_tray_action`）也在此，供 `tray.rs` 使用。

use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::AppError;
use crate::screenshot_shared::history::{HistoryImageVariant, HistoryRuntime};

use super::registry::{PinRegistry, PinState, PinTrayItem};
use super::window::{resize_window_for_state, PinCreateResult};
use super::{clamp_zoom, initial_zoom_percent, validate_pin_id, OPACITY_MAX_PERCENT, OPACITY_MIN_PERCENT};

const PIN_TRAY_RESTORE_PREFIX: &str = "pin:restore:";
const PIN_TRAY_CLOSE_PREFIX: &str = "pin:close:";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PinTrayAction {
    RestoreInteraction { pin_id: String },
    Close { pin_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PinTrayMenuEntry {
    pub ordinal: usize,
    pub restore_action_id: Option<String>,
    pub close_action_id: String,
}

#[tauri::command(async)]
#[specta::specta]
pub fn pin_create_from_history<R: Runtime>(
    app: AppHandle<R>,
    history: State<'_, HistoryRuntime>,
    record_id: String,
    variant: HistoryImageVariant,
) -> Result<PinCreateResult, AppError> {
    log::debug!("[pin] create requested for record {record_id}, variant {variant:?}");
    let image_png = history.read_image_by_record_id(&record_id, variant)?;
    super::window::create_pin_window(&app, image_png).map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn pin_list(registry: State<'_, Arc<PinRegistry>>) -> Result<Vec<PinTrayItem>, AppError> {
    registry.tray_items().map_err(AppError::Message)
}

pub(crate) fn pin_tray_menu_entries(items: &[PinTrayItem]) -> Vec<PinTrayMenuEntry> {
    let mut items = items.to_vec();
    items.sort_by(|left, right| left.pin_id.cmp(&right.pin_id));
    items
        .into_iter()
        .enumerate()
        .map(|(ordinal, item)| PinTrayMenuEntry {
            ordinal: ordinal + 1,
            restore_action_id: item
                .click_through
                .then(|| format!("{PIN_TRAY_RESTORE_PREFIX}{}", item.pin_id)),
            close_action_id: format!("{PIN_TRAY_CLOSE_PREFIX}{}", item.pin_id),
        })
        .collect()
}

pub(crate) fn parse_pin_tray_action(menu_id: &str) -> Option<PinTrayAction> {
    let (prefix, pin_id) = menu_id
        .strip_prefix(PIN_TRAY_RESTORE_PREFIX)
        .map(|id| (PIN_TRAY_RESTORE_PREFIX, id))
        .or_else(|| menu_id.strip_prefix(PIN_TRAY_CLOSE_PREFIX).map(|id| (PIN_TRAY_CLOSE_PREFIX, id)))?;

    if pin_id.is_empty() || pin_id.contains(':') || validate_pin_id(pin_id).is_err() {
        return None;
    }

    match prefix {
        PIN_TRAY_RESTORE_PREFIX => Some(PinTrayAction::RestoreInteraction {
            pin_id: pin_id.to_string(),
        }),
        PIN_TRAY_CLOSE_PREFIX => Some(PinTrayAction::Close {
            pin_id: pin_id.to_string(),
        }),
        _ => None,
    }
}

#[tauri::command]
#[specta::specta]
pub fn pin_get_state(
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    registry.get(&pin_id).map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn pin_read_image(
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    image_token: String,
) -> Result<Vec<u8>, AppError> {
    validate_pin_id(&pin_id)?;
    validate_pin_id(&image_token)?;
    registry.image(&pin_id, &image_token).map_err(AppError::Message)
}

fn apply_state_transaction<R: Runtime, F>(
    app: &AppHandle<R>,
    registry: &PinRegistry,
    pin_id: &str,
    previous: &PinState,
    target: PinState,
    apply: F,
) -> Result<PinState, String>
where
    F: Fn(&AppHandle<R>, &PinState) -> Result<(), String>,
{
    if let Err(error) = apply(app, &target) {
        // A native API can report failure after changing its effect. Restore the
        // prior effect even on the failing call so it cannot diverge from state.
        let _ = apply(app, previous);
        return Err(error);
    }

    match registry.commit_state(pin_id, previous, target) {
        Ok(state) => Ok(state),
        Err(error) => {
            // A close or concurrent command can prevent the commit after the
            // native target succeeded. Best-effort restore the prior effects.
            let _ = apply(app, previous);
            Err(error)
        }
    }
}

fn apply_click_through<R: Runtime>(app: &AppHandle<R>, state: &PinState) -> Result<(), String> {
    let window = app
        .get_webview_window(&state.label)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    window
        .set_ignore_cursor_events(state.click_through)
        .map_err(|error| format!("设置贴图穿透失败：{error}"))
}

fn apply_reset_effects<R: Runtime>(app: &AppHandle<R>, state: &PinState) -> Result<(), String> {
    apply_click_through(app, state)?;
    apply_window_opacity(app, state)?;
    resize_window_for_state(app, state)
}

fn restore_reset_effects<R: Runtime>(app: &AppHandle<R>, state: &PinState) {
    // Do not short-circuit: each operation may have partially applied before
    // its error, and each must be given a chance to return to the old state.
    let _ = resize_window_for_state(app, state);
    let _ = apply_window_opacity(app, state);
    let _ = apply_click_through(app, state);
}

#[tauri::command]
#[specta::specta]
pub fn pin_set_zoom<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    zoom_percent: u16,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        zoom_percent: clamp_zoom(zoom_percent),
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        resize_window_for_state,
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
/// 旋转贴图（0/90/180/270）。CSS transform 视觉旋转，窗口矩形不变。
#[tauri::command]
#[specta::specta]
pub fn pin_set_rotation<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    rotation: u16,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        rotation: (rotation % 360 / 90) * 90,
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        |_app, _state| Ok(()),
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
/// 翻转贴图（水平/垂直）。CSS transform，窗口矩形不变。
#[tauri::command]
#[specta::specta]
pub fn pin_set_flip<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    horizontal: bool,
    vertical: bool,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        flipped_h: horizontal,
        flipped_v: vertical,
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        |_app, _state| Ok(()),
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
/// 贴图分组（0/1/2）。分组后可用 `pin_set_group_visible` 整体显隐。
#[tauri::command]
#[specta::specta]
pub fn pin_set_group<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    group: u8,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        group: group.min(2),
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        |_app, _state| Ok(()),
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
#[tauri::command]
#[specta::specta]
pub fn pin_set_opacity<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    opacity_percent: u8,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        opacity_percent: opacity_percent.clamp(OPACITY_MIN_PERCENT, OPACITY_MAX_PERCENT),
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        apply_window_opacity,
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
#[tauri::command]
#[specta::specta]
pub fn pin_reset<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        zoom_percent: initial_zoom_percent(previous.width, previous.height),
        opacity_percent: OPACITY_MAX_PERCENT,
        click_through: false,
        ..previous.clone()
    };

    if let Err(error) = apply_reset_effects(&app, &target) {
        restore_reset_effects(&app, &previous);
        return Err(AppError::Message(error));
    }
    match registry.commit_state(&pin_id, &previous, target) {
        Ok(state) => {
            crate::refresh_pin_tray(&app);
            Ok(state)
        }
        Err(error) => {
            restore_reset_effects(&app, &previous);
            Err(AppError::Message(error))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn pin_set_click_through<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
    enabled: bool,
) -> Result<PinState, AppError> {
    validate_pin_id(&pin_id)?;
    let previous = registry.get(&pin_id)?;
    let target = PinState {
        click_through: enabled,
        ..previous.clone()
    };
    apply_state_transaction(
        &app,
        &registry,
        &pin_id,
        &previous,
        target,
        apply_click_through,
    )
    .inspect(|_| crate::refresh_pin_tray(&app))
    .map_err(AppError::Message)
}
#[tauri::command]
#[specta::specta]
pub fn pin_enable_all_interaction<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
) -> Result<u32, AppError> {
    let states = registry.snapshot_states()?;
    let mut changed = 0u32;
    let mut failed = Vec::new();

    for previous in states {
        if !previous.click_through {
            continue;
        }
        let target = PinState {
            click_through: false,
            ..previous.clone()
        };
        match apply_state_transaction(
            &app,
            &registry,
            &previous.pin_id,
            &previous,
            target,
            apply_click_through,
        ) {
            Ok(_) => changed += 1,
            Err(error) => failed.push(error),
        }
    }

    if failed.is_empty() {
        crate::refresh_pin_tray(&app);
        Ok(changed)
    } else {
        crate::refresh_pin_tray(&app);
        Err(AppError::Message(format!("恢复部分贴图交互失败：{}", failed.join("；"))))
    }
}

#[tauri::command]
#[specta::specta]
pub fn pin_start_drag<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
) -> Result<(), AppError> {
    validate_pin_id(&pin_id)?;
    let state = registry.get(&pin_id)?;
    let window = app
        .get_webview_window(&state.label)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    window
        .start_dragging()
        .map_err(|error| AppError::Message(format!("拖动贴图失败：{error}")))
}

#[tauri::command]
#[specta::specta]
pub fn pin_close<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
    pin_id: String,
) -> Result<bool, AppError> {
    validate_pin_id(&pin_id)?;
    let state = match registry.get(&pin_id) {
        Ok(state) => state,
        Err(_) => return Ok(false),
    };
    if let Some(window) = app.get_webview_window(&state.label) {
        window
            .destroy()
            .map_err(|error| format!("关闭贴图窗口失败：{error}"))?;
    }
    registry.remove(&pin_id);
    crate::refresh_pin_tray(&app);
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub fn pin_close_all<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, Arc<PinRegistry>>,
) -> Result<u32, AppError> {
    let ids = registry.ids()?;
    let mut closed = 0u32;
    for pin_id in ids {
        let state = registry.get(&pin_id)?;
        if let Some(window) = app.get_webview_window(&state.label) {
            window
                .destroy()
                .map_err(|error| format!("关闭贴图窗口失败：{error}"))?;
        }
        registry.remove(&pin_id);
        closed += 1;
    }
    crate::refresh_pin_tray(&app);
    Ok(closed)
}

#[cfg(windows)]
fn apply_window_opacity<R: Runtime>(app: &AppHandle<R>, state: &PinState) -> Result<(), String> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
        WS_EX_LAYERED,
    };

    let window = app
        .get_webview_window(&state.label)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("获取贴图原生窗口失败：{error}"))?;
    unsafe {
        let current_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, current_style | WS_EX_LAYERED.0 as i32);
    }
    let alpha = ((u16::from(state.opacity_percent) * 255) / 100) as u8;
    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|error| format!("设置贴图透明度失败：{error}"))
}

#[cfg(not(windows))]
fn apply_window_opacity<R: Runtime>(_app: &AppHandle<R>, _state: &PinState) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn tray_menu_entries_are_stable_and_do_not_use_labels() {
        let first_id = Uuid::new_v4().to_string();
        let second_id = Uuid::new_v4().to_string();
        let entries = pin_tray_menu_entries(&[
            PinTrayItem {
                pin_id: second_id.clone(),
                label: "pin-<untrusted label>".to_string(),
                zoom_percent: 100,
                opacity_percent: 100,
                click_through: false,
            },
            PinTrayItem {
                pin_id: first_id.clone(),
                label: "pin-other".to_string(),
                zoom_percent: 100,
                opacity_percent: 100,
                click_through: true,
            },
        ]);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].ordinal, 1);
        assert_eq!(entries[1].ordinal, 2);
        assert!(entries
            .iter()
            .all(|entry| !entry.close_action_id.contains("label")));
        assert!(entries
            .iter()
            .any(|entry| entry.restore_action_id.is_some()));
        assert!(entries
            .iter()
            .any(|entry| entry.close_action_id.ends_with(&first_id)));
        assert!(entries
            .iter()
            .any(|entry| entry.close_action_id.ends_with(&second_id)));
    }

    #[test]
    fn tray_action_parser_accepts_only_valid_uuid_actions() {
        let pin_id = Uuid::new_v4().to_string();
        assert_eq!(
            parse_pin_tray_action(&format!("{PIN_TRAY_RESTORE_PREFIX}{pin_id}")),
            Some(PinTrayAction::RestoreInteraction {
                pin_id: pin_id.clone()
            })
        );
        assert_eq!(
            parse_pin_tray_action(&format!("{PIN_TRAY_CLOSE_PREFIX}{pin_id}")),
            Some(PinTrayAction::Close { pin_id })
        );
        assert_eq!(parse_pin_tray_action("pin:close:not-a-uuid"), None);
        assert_eq!(parse_pin_tray_action("pin:close:"), None);
        assert_eq!(parse_pin_tray_action("close_pins"), None);
        assert_eq!(
            parse_pin_tray_action(&format!("{PIN_TRAY_CLOSE_PREFIX}{}:extra", Uuid::new_v4())),
            None
        );
    }
}
