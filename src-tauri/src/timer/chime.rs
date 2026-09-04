//! 整点报时：开关命令、轮询检查与弹窗载荷。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Runtime, State};

use crate::error::AppError;
use super::alert::{trigger_alert, AlertPayload};
use super::logic::is_chime_time;
use super::store::{write_chime, TimerState};

// ---------------------------------------------------------------------------
// 命令：整点报时
// ---------------------------------------------------------------------------

/// 获取整点报时开关。
#[tauri::command]
#[specta::specta]
pub fn timer_get_chime(
    state: State<'_, TimerState>,
) -> Result<bool, AppError> {
    Ok(state.chime_enabled.load(Ordering::Relaxed))
}

/// 设置整点报时开关。
#[tauri::command]
#[specta::specta]
pub fn timer_set_chime<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    enabled: bool,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    write_chime(&app, enabled)?;
    state.chime_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

// ---------------------------------------------------------------------------
// 轮询检查
// ---------------------------------------------------------------------------

pub(crate) fn check_chime<R: Runtime>(app: &AppHandle<R>, state: &TimerState, hour: u8, minute: u8, epoch_hour: i64) {
    if !state.chime_enabled.load(Ordering::Relaxed) {
        return;
    }
    let last = state.last_chime_hour.load(Ordering::Relaxed);
    if is_chime_time(true, last, epoch_hour, minute) {
        state.last_chime_hour.store(epoch_hour, Ordering::Relaxed);
        state
            .alert_payloads
            .lock()
            .unwrap()
            .insert("chime:chime".to_string(), chime_payload(hour, minute));
        trigger_alert(app, "chime", "chime");
    }
}

// ---------------------------------------------------------------------------
// 弹窗载荷
// ---------------------------------------------------------------------------

fn chime_payload(hour: u8, minute: u8) -> AlertPayload {
    AlertPayload {
        kind: "chime".to_string(),
        title: "整点报时".to_string(),
        message: format!("现在时间 {:02}:{:02}", hour, minute),
        show_snooze: false,
        show_close: false,
        show_skip: false,
        auto_dismiss: true,
    }
}
