//! 番茄钟：模型、命令、轮询检查与弹窗载荷。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime, State};

use crate::error::AppError;
use super::alert::{trigger_alert, AlertPayload};
use super::logic::{advance_phase, append_history, now_epoch_secs, phase_label, tick_pomodoro};
use super::store::{
    read_history, write_history, write_pomodoro, COUNTDOWN_ID, PomodoroPersist, TimerState,
};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 番茄钟配置。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroConfig {
    /// 工作时长（分钟，默认 25）。
    pub work_minutes: u64,
    /// 短休时长（分钟，默认 5）。
    pub short_break_minutes: u64,
    /// 长休时长（分钟，默认 15）。
    pub long_break_minutes: u64,
    /// 每 N 个工作后进长休（默认 4）。
    pub interval_for_long_break: u64,
}

/// 番茄钟运行态。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub running: bool,
    /// "work" | "short_break" | "long_break"。
    pub phase: String,
    /// 当前阶段剩余秒数。
    pub seconds_left: u64,
    /// 累计完成的工作阶段数（专注总次数）。
    pub work_count: u64,
    /// 当前一轮内已完成的工作数（0..=interval_for_long_break）。
    pub in_round: u64,
    /// 当前阶段启动时刻（epoch 秒），运行中为 Some。
    pub phase_start_at: Option<u64>,
    /// 阶段是否已完成并等待用户确认开始下一阶段（到点后挂起，点「开始下一个」才推进）。
    #[serde(default)]
    pub awaiting_next: bool,
}

/// 番茄阶段完成事件（弹窗载荷来源）。
struct PomodoroEvent {
    completed_phase: String,
    next_phase: String,
}

// ---------------------------------------------------------------------------
// 命令：番茄钟
// ---------------------------------------------------------------------------

/// 获取番茄钟配置与运行态。
#[tauri::command]
#[specta::specta]
pub fn timer_get_pomodoro(
    state: State<'_, TimerState>,
) -> Result<PomodoroPersist, AppError> {
    Ok(PomodoroPersist {
        config: state.pomodoro_config.lock().unwrap().clone(),
        state: state.pomodoro_state.lock().unwrap().clone(),
    })
}

/// 更新番茄钟参数（非运行时生效；运行时只改配置不打断当前阶段）。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn timer_set_pomodoro_config<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    work_minutes: u64,
    short_break_minutes: u64,
    long_break_minutes: u64,
    interval_for_long_break: u64,
) -> Result<(), AppError> {
    let config = PomodoroConfig {
        work_minutes: work_minutes.clamp(1, 180),
        short_break_minutes: short_break_minutes.clamp(1, 120),
        long_break_minutes: long_break_minutes.clamp(1, 180),
        interval_for_long_break: interval_for_long_break.clamp(2, 12),
    };
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut pstate = state.pomodoro_state.lock().unwrap().clone();
    if !pstate.running && pstate.phase == "work" {
        // 未运行时改配置：重置当前工作阶段时长。
        pstate.seconds_left = config.work_minutes * 60;
    }
    // 先写 store 成功后再更新内存镜像：其余写路径都是「store 写成功后才更新内存」，
    // 此处保持同序，避免 store 写失败时内存与持久化状态分叉。
    write_pomodoro(&app, &config, &pstate).map_err(AppError::Message)?;
    *state.pomodoro_config.lock().unwrap() = config;
    *state.pomodoro_state.lock().unwrap() = pstate;
    Ok(())
}

/// 开始（或继续）番茄钟：未运行时从当前阶段剩余时长继续；休息完成挂起时推进到工作。
#[tauri::command]
#[specta::specta]
pub fn timer_start_pomodoro<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let now = now_epoch_secs();
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let config = state.pomodoro_config.lock().unwrap().clone();
    let mut pstate = state.pomodoro_state.lock().unwrap().clone();
    if pstate.awaiting_next {
        // 休息完成挂起：点「开始」= 开始下一个番茄（进入工作阶段并计时）。
        let mut next = advance_phase(&pstate, &config);
        next.running = true;
        next.awaiting_next = false;
        next.phase_start_at = Some(now);
        *state.pomodoro_state.lock().unwrap() = next.clone();
        write_pomodoro(&app, &config, &next)?;
    } else if !pstate.running {
        pstate.running = true;
        pstate.phase_start_at = Some(now);
        if pstate.seconds_left == 0 {
            pstate.seconds_left = config.work_minutes * 60;
        }
        *state.pomodoro_state.lock().unwrap() = pstate.clone();
        write_pomodoro(&app, &config, &pstate)?;
    }
    Ok(())
}

/// 暂停番茄钟（冻结当前阶段剩余时长）。
#[tauri::command]
#[specta::specta]
pub fn timer_pause_pomodoro<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut pstate = state.pomodoro_state.lock().unwrap().clone();
    if pstate.running {
        pstate.running = false;
        pstate.phase_start_at = None;
        *state.pomodoro_state.lock().unwrap() = pstate.clone();
        write_pomodoro(&app, &state.pomodoro_config.lock().unwrap(), &pstate)?;
    }
    Ok(())
}

/// 跳过当前阶段：立即推进到下一阶段（不记历史）。
#[tauri::command]
#[specta::specta]
pub fn timer_skip_phase<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let now = now_epoch_secs();
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let config = state.pomodoro_config.lock().unwrap().clone();
    let pstate = state.pomodoro_state.lock().unwrap().clone();
    if !pstate.running && !pstate.awaiting_next {
        return Ok(());
    }
    let mut next = advance_phase(&pstate, &config);
    next.running = true;
    next.awaiting_next = false;
    next.phase_start_at = Some(now);
    *state.pomodoro_state.lock().unwrap() = next.clone();
    write_pomodoro(&app, &config, &next).map_err(AppError::Message)
}

/// 重置本轮：回到工作阶段、暂停态，保留累计工作次数。
#[tauri::command]
#[specta::specta]
pub fn timer_reset_pomodoro<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let config = state.pomodoro_config.lock().unwrap().clone();
    let work_count = state.pomodoro_state.lock().unwrap().work_count;
    let fresh = PomodoroState {
        running: false,
        phase: "work".to_string(),
        seconds_left: config.work_minutes * 60,
        work_count,
        in_round: 0,
        phase_start_at: None,
        awaiting_next: false,
    };
    *state.pomodoro_state.lock().unwrap() = fresh.clone();
    write_pomodoro(&app, &config, &fresh).map_err(AppError::Message)
}

// ---------------------------------------------------------------------------
// 轮询检查
// ---------------------------------------------------------------------------

pub(crate) fn check_pomodoro<R: Runtime>(app: &AppHandle<R>, state: &TimerState, now: u64) {
    let mut event: Option<PomodoroEvent> = None;
    {
        let _guard = match state.store_lock.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let config = state.pomodoro_config.lock().unwrap().clone();
        let pstate = state.pomodoro_state.lock().unwrap().clone();
        let (next, completed_phase) = tick_pomodoro(&pstate, &config, now);
        match completed_phase {
            Some(completed_phase) => {
                event = Some(PomodoroEvent {
                    completed_phase: completed_phase.clone(),
                    next_phase: next.phase.clone(),
                });
                // 工作阶段自然完成：写历史。
                if completed_phase == "work" {
                    let work_seconds = config.work_minutes * 60;
                    let history = read_history(app).unwrap_or_default();
                    let history = append_history(history, "pomodoro", work_seconds, now);
                    if write_history(app, &history).is_ok() {
                        *state.history.lock().unwrap() = history;
                    }
                }
                // 挂起态（running=false, awaiting_next=true）持久化，等用户确认开始下一阶段。
                *state.pomodoro_state.lock().unwrap() = next.clone();
                let _ = write_pomodoro(app, &config, &next);
            }
            None => {
                // 运行中未到点：写回递减后的状态（未运行时 next == pstate，跳过写回）。
                if pstate.running {
                    *state.pomodoro_state.lock().unwrap() = next;
                }
            }
        }
    }
    if let Some(evt) = event {
        state
            .alert_payloads
            .lock()
            .unwrap()
            .insert(
                format!("pomodoro:{COUNTDOWN_ID}"),
                pomodoro_payload(&evt.completed_phase, &evt.next_phase),
            );
        trigger_alert(app, "pomodoro", COUNTDOWN_ID);
    }
}

// ---------------------------------------------------------------------------
// 弹窗载荷
// ---------------------------------------------------------------------------

fn pomodoro_payload(completed_phase: &str, next_phase: &str) -> AlertPayload {
    // 工作完成 → 已自动进入休息（running），弹窗显示「正在短休/长休」，前端实时渲染休息倒计时；
    // 休息完成 → 已挂起（awaiting_next），弹窗显示「短休结束」，前端显示「开始下一个番茄」按钮。
    // 前端据轮询 timer_get_pomodoro 的 state.awaitingNext 决定渲染哪种状态。
    let title = if completed_phase == "work" {
        format!("正在{}", phase_label(next_phase))
    } else {
        format!("{}结束", phase_label(completed_phase))
    };
    AlertPayload {
        kind: "pomodoro".to_string(),
        title,
        message: String::new(),
        show_snooze: false,
        show_close: true,
        show_skip: true,
        auto_dismiss: false,
    }
}
