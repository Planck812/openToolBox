//! 计时弹窗：载荷模型、读取/动作命令、弹窗窗口创建/关闭，以及主线程触发派发。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::error::AppError;
use super::alarms::SnoozedAlarm;
use super::logic::{advance_phase, now_epoch_secs};
use super::store::{write_pomodoro, SNOOZE_SECONDS, TIMER_WINDOW_APP_ROUTE, TimerState};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 弹窗载荷：弹窗初始化时按 kind/id 读取渲染所需字段。
#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct AlertPayload {
    pub kind: String,
    /// 大标题（闹钟 label / 倒计时名 / 阶段名 / "整点报时"）。
    pub title: String,
    /// 副文案。
    pub message: String,
    /// 是否显示「贪睡」按钮（闹钟）。
    pub show_snooze: bool,
    /// 是否显示「关闭/确定」按钮。
    pub show_close: bool,
    /// 是否显示「跳过」按钮（番茄）。
    pub show_skip: bool,
    /// 整点报时：自动消失，无按钮。
    pub auto_dismiss: bool,
}

// ---------------------------------------------------------------------------
// 命令：弹窗载荷 / 弹窗动作
// ---------------------------------------------------------------------------

/// 弹窗初始化：按 kind/id 读取载荷。
#[tauri::command]
#[specta::specta]
pub fn timer_get_alert(
    state: State<'_, TimerState>,
    kind: String,
    id: String,
) -> Result<AlertPayload, AppError> {
    let key = format!("{kind}:{id}");
    state
        .alert_payloads
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .ok_or_else(|| AppError::Message("弹窗载荷不存在".to_string()))
}

/// 弹窗按钮动作：闹钟 snooze/close、倒计时 dismiss、番茄 dismiss/skip、整点 dismiss。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn timer_alert_action<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    kind: String,
    action: String,
    id: String,
) -> Result<(), AppError> {
    match kind.as_str() {
        "alarm" => match action.as_str() {
            "snooze" => {
                let fire_at = now_epoch_secs() + SNOOZE_SECONDS;
                state
                    .snoozed_alarms
                    .lock()
                    .unwrap()
                    .push(SnoozedAlarm { alarm_id: id.clone(), fire_at });
                close_alert_window(&app, &kind, &id);
            }
            "close" => {
                // 关闭闹钟弹窗：移除残留载荷（snooze 保留以支持 5 分钟后再弹）。
                state.alert_payloads.lock().unwrap().remove(&format!("alarm:{id}"));
                close_alert_window(&app, &kind, &id);
            }
            other => return Err(AppError::Message(format!("未知的闹钟弹窗动作：{other}"))),
        },
        "countdown" => match action.as_str() {
            "dismiss" => {
                // 关闭倒计时弹窗：移除残留载荷。
                state.alert_payloads.lock().unwrap().remove(&format!("countdown:{id}"));
                close_alert_window(&app, &kind, &id)
            }
            other => return Err(AppError::Message(format!("未知的倒计时弹窗动作：{other}"))),
        },
        "pomodoro" => match action.as_str() {
            "dismiss" => {
                // 关闭番茄弹窗：移除残留载荷。
                state.alert_payloads.lock().unwrap().remove(&format!("pomodoro:{id}"));
                close_alert_window(&app, &kind, &id)
            }
            "start_next" => {
                // 休息完成挂起后，用户确认开始下一个番茄：推进到工作阶段并开始计时。
                let now = now_epoch_secs();
                {
                    let _guard = state
                        .store_lock
                        .lock()
                        .map_err(|_| "计时 store 锁获取失败".to_string())?;
                    let config = state.pomodoro_config.lock().unwrap().clone();
                    let pstate = state.pomodoro_state.lock().unwrap().clone();
                    if pstate.awaiting_next {
                        let mut next = advance_phase(&pstate, &config);
                        next.running = true;
                        next.awaiting_next = false;
                        next.phase_start_at = Some(now);
                        *state.pomodoro_state.lock().unwrap() = next.clone();
                        write_pomodoro(&app, &config, &next)?;
                    }
                }
                close_alert_window(&app, &kind, &id);
            }
            "skip" => {
                // 跳过当前阶段并关窗。
                let now = now_epoch_secs();
                {
                    let _guard = state
                        .store_lock
                        .lock()
                        .map_err(|_| "计时 store 锁获取失败".to_string())?;
                    let config = state.pomodoro_config.lock().unwrap().clone();
                    let pstate = state.pomodoro_state.lock().unwrap().clone();
                    if pstate.running || pstate.awaiting_next {
                        let mut next = advance_phase(&pstate, &config);
                        next.running = true;
                        next.awaiting_next = false;
                        next.phase_start_at = Some(now);
                        *state.pomodoro_state.lock().unwrap() = next.clone();
                        write_pomodoro(&app, &config, &next)?;
                    }
                }
                close_alert_window(&app, &kind, &id);
            }
            other => return Err(AppError::Message(format!("未知的番茄弹窗动作：{other}"))),
        },
        "chime" => match action.as_str() {
            "dismiss" => close_alert_window(&app, &kind, &id),
            other => return Err(AppError::Message(format!("未知的整点报时弹窗动作：{other}"))),
        },
        other => return Err(AppError::Message(format!("未知的弹窗类型：{other}"))),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 弹窗窗口
// ---------------------------------------------------------------------------

/// 创建（或显示已存在）计时弹窗：透明、置顶、无边框，复用主窗口 WebView2 环境。
/// label = `timer-alert-{kind}-{id}`，多提醒同时到点用不同 label 并存。
fn create_alert_window<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str) -> Result<(), String> {
    let label = format!("timer-alert-{kind}-{id}");
    // 窗口已存在（例如用户尚未关闭上次弹窗）：显示并聚焦，而非重复创建。
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let url = WebviewUrl::App(TIMER_WINDOW_APP_ROUTE.into());
    let (width, height) = alert_window_size(kind);

    // 不设 data_directory：复用主窗口已就绪的 WebView2 环境（理由见 pin/window.rs）。
    // 原按 `timer-webview/{kind}-{id}` 分目录，每个同时到点的提醒都会多拉起一整套
    // msedgewebview2 进程组。
    WebviewWindowBuilder::new(app, label.as_str(), url)
        .title("计时提醒")
        .inner_size(width, height)
        .center()
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .visible(true)
        .build()
        .map_err(|e| format!("创建计时弹窗失败：{e}"))?;

    Ok(())
}

fn alert_window_size(kind: &str) -> (f64, f64) {
    match kind {
        "chime" => (340.0, 170.0),
        "countdown" => (400.0, 260.0),
        "pomodoro" => (440.0, 300.0),
        _ => (460.0, 320.0),
    }
}

/// 关闭计时弹窗（不存在则为空操作）。
pub(crate) fn close_alert_window<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str) {
    let label = format!("timer-alert-{kind}-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}

// ---------------------------------------------------------------------------
// 触发派发
// ---------------------------------------------------------------------------

/// 触发弹窗：把窗口创建派发到主线程（WebView 必须主线程创建），失败只记日志。
pub(crate) fn trigger_alert<R: Runtime>(app: &AppHandle<R>, kind: &str, id: &str) {
    let app_handle = app.clone();
    let kind = kind.to_string();
    let id = id.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = create_alert_window(&app_handle, &kind, &id) {
            log::error!("[timer] 创建弹窗失败 kind={kind} id={id}: {error}");
        }
    });
}
