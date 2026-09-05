//! 闹钟：模型、命令、轮询检查与弹窗载荷。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::AppError;
use super::alert::{trigger_alert, AlertPayload};
use super::logic::should_ring_alarm;
use super::store::{read_alarms, write_alarms, TimerState};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 闹钟。`repeat_days` 空 = 单次（触发后自动 disabled）；非空 = 按周几重复
/// （0=周日 ..=6=周六），重复闹钟保持 enabled。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    pub label: String,
    /// 小时 0..=23。
    pub hour: u8,
    /// 分钟 0..=59。
    pub minute: u8,
    /// 0..=6 (Sun..Sat)，空 = 单次。
    pub repeat_days: Vec<u8>,
    pub enabled: bool,
}

/// 贪睡中的闹钟：`fire_at` 到点后再弹一次。
pub(crate) struct SnoozedAlarm {
    pub(crate) alarm_id: String,
    pub(crate) fire_at: u64,
}

// ---------------------------------------------------------------------------
// 命令：闹钟
// ---------------------------------------------------------------------------

/// 获取全部闹钟（权威数据来自 store）。
#[tauri::command]
#[specta::specta]
pub fn timer_get_alarms<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<Vec<Alarm>, AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    read_alarms(&app).map_err(AppError::Message)
}

fn validate_time(hour: u8, minute: u8) -> Result<(), String> {
    if hour > 23 {
        return Err(format!("小时超出范围：{hour}"));
    }
    if minute > 59 {
        return Err(format!("分钟超出范围：{minute}"));
    }
    Ok(())
}

fn sanitize_repeat_days(mut days: Vec<u8>) -> Vec<u8> {
    days.retain(|d| *d <= 6);
    days.sort_unstable();
    days.dedup();
    days
}

/// 新增闹钟（默认启用）。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn timer_add_alarm<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    label: String,
    hour: u8,
    minute: u8,
    repeat_days: Vec<u8>,
) -> Result<Alarm, AppError> {
    validate_time(hour, minute)?;
    let alarm = Alarm {
        id: format!("alarm-{}", uuid::Uuid::new_v4()),
        label: label.trim().to_string(),
        hour,
        minute,
        repeat_days: sanitize_repeat_days(repeat_days),
        enabled: true,
    };
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut alarms = read_alarms(&app)?;
    alarms.push(alarm.clone());
    write_alarms(&app, &alarms)?;
    *state.alarms.lock().unwrap() = alarms;
    Ok(alarm)
}

/// 更新闹钟（完整替换；用于编辑与启停开关）。
#[tauri::command]
#[specta::specta]
pub fn timer_update_alarm<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    alarm: Alarm,
) -> Result<(), AppError> {
    validate_time(alarm.hour, alarm.minute)?;
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut alarms = read_alarms(&app)?;
    let id = alarm.id.clone();
    let mut updated = alarm;
    updated.repeat_days = sanitize_repeat_days(updated.repeat_days);
    let disabled = {
        match alarms.iter_mut().find(|a| a.id == id) {
            Some(target) => {
                let disabled = !updated.enabled;
                *target = updated;
                disabled
            }
            None => return Err(AppError::Message("闹钟不存在或已被删除".to_string())),
        }
    };
    write_alarms(&app, &alarms)?;
    *state.alarms.lock().unwrap() = alarms;
    if disabled {
        // 禁用闹钟：取消其挂起的贪睡（贪睡到点不再重弹）。
        state.snoozed_alarms.lock().unwrap().retain(|s| s.alarm_id != id);
    }
    Ok(())
}

/// 删除闹钟（同时清理其贪睡项与弹窗）。
#[tauri::command]
#[specta::specta]
pub fn timer_delete_alarm<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    id: String,
) -> Result<(), AppError> {
    {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "计时 store 锁获取失败".to_string())?;
        let alarms = read_alarms(&app)?;
        let remaining: Vec<Alarm> = alarms.into_iter().filter(|a| a.id != id).collect();
        write_alarms(&app, &remaining)?;
        *state.alarms.lock().unwrap() = remaining;
    }
    // 清理该闹钟的贪睡项与残留载荷。
    state.snoozed_alarms.lock().unwrap().retain(|s| s.alarm_id != id);
    state.alert_payloads.lock().unwrap().remove(&format!("alarm:{id}"));
    let label = format!("timer-alert-alarm-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 轮询检查
// ---------------------------------------------------------------------------

pub(crate) fn check_alarms<R: Runtime>(app: &AppHandle<R>, state: &TimerState, weekday: u8, hour: u8, minute: u8) {
    let ids: Vec<String> = {
        let alarms = state.alarms.lock().unwrap();
        alarms
            .iter()
            .filter(|a| should_ring_alarm(a, weekday, hour, minute))
            .map(|a| a.id.clone())
            .collect()
    };
    for id in ids {
        fire_alarm(app, state, &id);
    }
}

/// 触发一个闹钟：单次闹钟自动 disabled 并持久化，然后写载荷并弹窗。
fn fire_alarm<R: Runtime>(app: &AppHandle<R>, state: &TimerState, alarm_id: &str) {
    let mut payload: Option<AlertPayload> = None;
    {
        let _guard = match state.store_lock.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let mut alarms = match read_alarms(app) {
            Ok(alarms) => alarms,
            // 读失败时绝不下写：否则 unwrap_or_default 的空列表会被持久化，整份闹钟丢失。
            Err(_) => return,
        };
        if let Some(alarm) = alarms.iter_mut().find(|a| a.id == alarm_id) {
            if alarm.repeat_days.is_empty() {
                // 单次闹钟：触发后自动置 disabled。
                alarm.enabled = false;
            }
            payload = Some(alarm_payload(alarm));
        }
        if write_alarms(app, &alarms).is_ok() {
            *state.alarms.lock().unwrap() = alarms;
        }
    }
    if let Some(p) = payload {
        state
            .alert_payloads
            .lock()
            .unwrap()
            .insert(format!("alarm:{alarm_id}"), p);
        trigger_alert(app, "alarm", alarm_id);
    }
}

pub(crate) fn check_snoozed<R: Runtime>(app: &AppHandle<R>, state: &TimerState, now: u64) {
    let due: Vec<String> = {
        let mut snoozed = state.snoozed_alarms.lock().unwrap();
        let due_ids: Vec<String> = snoozed
            .iter()
            .filter(|s| s.fire_at <= now)
            .map(|s| s.alarm_id.clone())
            .collect();
        snoozed.retain(|s| s.fire_at > now);
        due_ids
    };
    for id in due {
        // 载荷仍在 map 中（单次闹钟禁用后仍保留载荷，贪睡可再弹）。
        let exists = state.alert_payloads.lock().unwrap().contains_key(&format!("alarm:{id}"));
        if exists {
            trigger_alert(app, "alarm", &id);
        }
    }
}

// ---------------------------------------------------------------------------
// 弹窗载荷
// ---------------------------------------------------------------------------

fn alarm_payload(alarm: &Alarm) -> AlertPayload {
    AlertPayload {
        kind: "alarm".to_string(),
        title: if alarm.label.trim().is_empty() {
            "闹钟".to_string()
        } else {
            alarm.label.clone()
        },
        message: format!("{:02}:{:02}", alarm.hour, alarm.minute),
        show_snooze: false,
        show_close: true,
        show_skip: false,
        auto_dismiss: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeat_days_sanitized() {
        let days = sanitize_repeat_days(vec![3, 1, 3, 9, 2, 2]);
        assert_eq!(days, vec![1, 2, 3]);
    }
}
