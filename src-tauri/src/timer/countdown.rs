//! 倒计时：模型、命令、轮询检查与弹窗载荷。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::AppError;
use super::alert::{trigger_alert, AlertPayload};
use super::logic::{append_history, countdown_remaining, now_epoch_secs};
use super::store::{read_history, write_countdown, write_history, COUNTDOWN_ID, TimerState};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 运行中（或已暂停）的倒计时实例（单实例）。
///
/// `start_at: Some` = 运行中（`remaining_seconds` 是 `start_at` 时刻的锚点值，当前剩余
/// 由 `countdown_remaining` 按墙钟推算，不逐秒写 store）；
/// `start_at: None` = 未启动或已暂停（`remaining_seconds` 为权威剩余值）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Countdown {
    pub id: String,
    pub name: String,
    /// 总时长（秒）。
    pub total_seconds: u64,
    /// 启动/继续时刻（epoch 秒）。运行中为 Some，暂停/未启动为 None。
    pub start_at: Option<u64>,
    /// 剩余秒数：运行中为 `start_at` 时刻的锚点值（当前剩余按墙钟推算）；暂停时为权威值。
    pub remaining_seconds: u64,
}

// ---------------------------------------------------------------------------
// 命令：倒计时
// ---------------------------------------------------------------------------

/// 获取运行中/暂停中的倒计时（无则 None）。
#[tauri::command]
#[specta::specta]
pub fn timer_get_countdown(
    state: State<'_, TimerState>,
) -> Result<Option<Countdown>, AppError> {
    let now = now_epoch_secs();
    Ok(state.countdown.lock().unwrap().clone().map(|mut c| {
        // 运行中按墙钟换算当前剩余，保证前端拿到准确值。
        c.remaining_seconds = countdown_remaining(c.start_at, c.remaining_seconds, now);
        c
    }))
}

/// 启动一个倒计时（替换已存在的运行实例）。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn timer_start_countdown<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    name: String,
    total_seconds: u64,
) -> Result<Countdown, AppError> {
    if total_seconds == 0 {
        return Err(AppError::Message("倒计时时长必须大于 0 秒".to_string()));
    }
    let now = now_epoch_secs();
    let cd = Countdown {
        id: COUNTDOWN_ID.to_string(),
        name: name.trim().to_string(),
        total_seconds,
        start_at: Some(now),
        remaining_seconds: total_seconds,
    };
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    write_countdown(&app, &Some(cd.clone()))?;
    *state.countdown.lock().unwrap() = Some(cd.clone());
    Ok(cd)
}

/// 暂停倒计时：冻结 remaining 并持久化（start_at 置 None）。
#[tauri::command]
#[specta::specta]
pub fn timer_pause_countdown<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut cd = state.countdown.lock().unwrap();
    if let Some(c) = cd.as_mut() {
        if c.start_at.is_some() {
            // 冻结：先把运行中的锚点换算成当前剩余，再清除 start_at 并持久化。
            let now = now_epoch_secs();
            c.remaining_seconds = countdown_remaining(c.start_at, c.remaining_seconds, now);
            c.start_at = None;
            write_countdown(&app, &cd)?;
        }
    }
    Ok(())
}

/// 继续倒计时：start_at 重新置为当前时刻。
#[tauri::command]
#[specta::specta]
pub fn timer_resume_countdown<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let now = now_epoch_secs();
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut cd = state.countdown.lock().unwrap();
    if let Some(c) = cd.as_mut() {
        if c.start_at.is_none() && c.remaining_seconds > 0 {
            c.start_at = Some(now);
            write_countdown(&app, &cd)?;
        }
    }
    Ok(())
}

/// 取消倒计时：移除实例与弹窗。
#[tauri::command]
#[specta::specta]
pub fn timer_cancel_countdown<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "计时 store 锁获取失败".to_string())?;
        write_countdown(&app, &None)?;
        *state.countdown.lock().unwrap() = None;
    }
    // 清理残留弹窗载荷，避免取消后载荷仍在内存中残留。
    state
        .alert_payloads
        .lock()
        .unwrap()
        .remove(&format!("countdown:{COUNTDOWN_ID}"));
    let label = format!("timer-alert-countdown-{COUNTDOWN_ID}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 轮询检查
// ---------------------------------------------------------------------------

pub(crate) fn check_countdown<R: Runtime>(app: &AppHandle<R>, state: &TimerState, now: u64) {
    let (name, total_seconds, finished, started_at) = {
        let cd = state.countdown.lock().unwrap();
        match cd.as_ref() {
            Some(c) if c.start_at.is_some() => {
                // 墙钟推算剩余（与 load_from_store 同口径），运行中不写 store。
                let remaining = countdown_remaining(c.start_at, c.remaining_seconds, now);
                (c.name.clone(), c.total_seconds, remaining == 0, c.start_at)
            }
            _ => (String::new(), 0, false, None),
        }
    };
    if finished {
        // 到点：写历史（尽力而为）、移除实例、弹窗。
        {
            let _guard = match state.store_lock.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            // 竞态防护：递减块释放 countdown 锁后才抢 store_lock，期间可能被
            // timer_start_countdown 写入新倒计时。仅当 state.countdown 仍是到点
            // 那一刻的实例（id + start_at 一致，且按墙钟已到点）才清理，避免误删新倒计时。
            let is_same = state
                .countdown
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|c| {
                    c.id == COUNTDOWN_ID
                        && c.start_at == started_at
                        && countdown_remaining(c.start_at, c.remaining_seconds, now) == 0
                });
            if !is_same {
                return;
            }
            *state.countdown.lock().unwrap() = None;
            let _ = write_countdown(app, &None);
            let history = read_history(app).unwrap_or_default();
            let history = append_history(history, "countdown", total_seconds, now);
            if write_history(app, &history).is_ok() {
                *state.history.lock().unwrap() = history;
            }
        }
        state
            .alert_payloads
            .lock()
            .unwrap()
            .insert(format!("countdown:{COUNTDOWN_ID}"), countdown_payload(&name));
        trigger_alert(app, "countdown", COUNTDOWN_ID);
    }
}

// ---------------------------------------------------------------------------
// 弹窗载荷
// ---------------------------------------------------------------------------

fn countdown_payload(name: &str) -> AlertPayload {
    AlertPayload {
        kind: "countdown".to_string(),
        title: if name.trim().is_empty() {
            "倒计时".to_string()
        } else {
            name.to_string()
        },
        message: "计时结束".to_string(),
        show_snooze: false,
        show_close: true,
        show_skip: false,
        auto_dismiss: false,
    }
}
