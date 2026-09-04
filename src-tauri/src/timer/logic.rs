//! 计时中心纯逻辑（无状态、可单测）+ 时间工具。

use super::alarms::Alarm;
use super::history::HistoryEntry;
use super::pomodoro::{PomodoroConfig, PomodoroState};

/// 闹钟是否应在当前时刻响：enabled 且 HH:MM 匹配；单次（repeat_days 空）按当天，
/// 重复按周几（0=Sun..6=Sat）。
pub(crate) fn should_ring_alarm(alarm: &Alarm, weekday: u8, hour: u8, minute: u8) -> bool {
    if !alarm.enabled || alarm.hour != hour || alarm.minute != minute {
        return false;
    }
    alarm.repeat_days.is_empty() || alarm.repeat_days.contains(&weekday)
}

/// 是否为新的分钟（用于闹钟/整点单分钟去重）：`prev` 与 `current` 不同即为新分钟。
pub(crate) fn is_new_minute(prev: i64, current: i64) -> bool {
    prev != current
}

/// 倒计时的墙钟剩余秒：`remaining_seconds` 是 `start_at` 时刻的锚点值，
/// 减去自 `start_at` 起的 elapsed；`start_at == None`（暂停/未启动）时锚点即权威剩余值。
///
/// 统一运行中（调度线程）与恢复（`load_from_store`）两种口径，避免 tick 计数
/// 与墙钟推算不一致导致的跳变。
pub(crate) fn countdown_remaining(start_at: Option<u64>, remaining_seconds: u64, now: u64) -> u64 {
    match start_at {
        Some(start) => remaining_seconds.saturating_sub(now.saturating_sub(start)),
        None => remaining_seconds,
    }
}

/// 番茄阶段机：当前阶段完成后推进到下一阶段。
///
/// - work 完成 → `in_round`/`work_count` 递增；达到长休间隔 → long_break（本轮清零），
///   否则 short_break。
/// - 任何休息完成 → work。
///
/// 返回下一阶段状态（`running = true`，`phase_start_at` 置 None 由调用方设置）。
pub(crate) fn advance_phase(state: &PomodoroState, config: &PomodoroConfig) -> PomodoroState {
    let mut next = state.clone();
    match state.phase.as_str() {
        "work" => {
            next.in_round += 1;
            next.work_count += 1;
            if next.in_round >= config.interval_for_long_break {
                next.phase = "long_break".to_string();
                next.in_round = 0;
                next.seconds_left = config.long_break_minutes * 60;
            } else {
                next.phase = "short_break".to_string();
                next.seconds_left = config.short_break_minutes * 60;
            }
        }
        _ => {
            next.phase = "work".to_string();
            next.seconds_left = config.work_minutes * 60;
        }
    }
    next.running = true;
    next.awaiting_next = false;
    next.phase_start_at = None;
    next
}

/// 单次番茄检查（纯逻辑，供轮询线程与单测使用）。
///
/// 运行中按秒递减；到点后按阶段类型差异化处理：
/// - **工作完成** → 自动 `advance_phase` 进入休息（短休/长休），`running` 保持 true。
///   此时弹窗显示「正在短休」+ 实时休息倒计时（用户上一消息期望：休息开始时即弹窗显示倒计时）。
/// - **休息完成** → 挂起（`running = false` + `awaiting_next = true`），等用户点弹窗
///   「开始下一个番茄」才经 `advance_phase` 进入工作。
///
/// 其中「`running` 且 `seconds_left == 0`」是重启恢复场景的产物（应用关闭期间当前阶段
/// 已走完，`load_from_store` 按 elapsed 推算剩余为 0）：工作视为自动进休息，休息视为挂起。
/// 返回 `(处理后的状态, 若阶段完成则 Some(完成的阶段名))`。
pub(crate) fn tick_pomodoro(state: &PomodoroState, config: &PomodoroConfig, now: u64) -> (PomodoroState, Option<String>) {
    if !state.running {
        return (state.clone(), None);
    }
    let mut s = state.clone();
    let completed = if s.seconds_left == 0 {
        Some(s.phase.clone())
    } else {
        s.seconds_left -= 1;
        if s.seconds_left == 0 {
            Some(s.phase.clone())
        } else {
            None
        }
    };
    if let Some(phase) = completed.clone() {
        if phase == "work" {
            // 工作完成 → 自动进入休息，弹窗随即显示「正在短休/长休」+ 休息倒计时。
            s = advance_phase(&s, config);
            s.phase_start_at = Some(now);
        } else {
            // 休息完成 → 挂起，等用户点「开始下一个番茄」才进入工作。
            s.running = false;
            s.awaiting_next = true;
            s.phase_start_at = None;
        }
    }
    (s, completed)
}

/// 整点报时判定：开关开启且当前处于整点分钟且距上次报时已跨小时 → 触发。
pub(crate) fn is_chime_time(chime_enabled: bool, last_chime_hour: i64, current_hour: i64, current_minute: u8) -> bool {
    chime_enabled && current_minute == 0 && current_hour != last_chime_hour
}

/// 追加一条历史记录（超长裁剪到最近 500 条）。
pub(crate) fn append_history(mut history: Vec<HistoryEntry>, kind: &str, seconds: u64, now: u64) -> Vec<HistoryEntry> {
    history.push(HistoryEntry {
        kind: kind.to_string(),
        seconds,
        finished_at_epoch_secs: now,
    });
    const MAX_HISTORY: usize = 500;
    if history.len() > MAX_HISTORY {
        let start = history.len() - MAX_HISTORY;
        history.drain(..start);
    }
    history
}

// ---------------------------------------------------------------------------
// 时间工具
// ---------------------------------------------------------------------------

pub(crate) fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 本地时间：(weekday 0=Sun..6=Sat, hour 0..=23, minute 0..=59)。
pub(crate) fn local_time_parts(secs: u64) -> (u8, u8, u8) {
    use chrono::{Datelike, Local, TimeZone, Timelike};
    let dt = Local
        .timestamp_opt(secs as i64, 0)
        .single()
        .unwrap_or(Local::now());
    (
        dt.weekday().num_days_from_sunday() as u8,
        dt.hour() as u8,
        dt.minute() as u8,
    )
}

/// 阶段显示名。
pub(crate) fn phase_label(phase: &str) -> &'static str {
    match phase {
        "work" => "工作",
        "short_break" => "短休",
        "long_break" => "长休",
        _ => "专注",
    }
}

#[cfg(test)]
mod tests {
    use super::super::store::default_pomodoro_config;
    use super::*;

    fn alarm(id: &str, hour: u8, minute: u8, repeat_days: Vec<u8>, enabled: bool) -> Alarm {
        Alarm {
            id: id.to_string(),
            label: String::new(),
            hour,
            minute,
            repeat_days,
            enabled,
        }
    }

    #[test]
    fn one_shot_alarm_rings_on_day() {
        // 单次闹钟：当天任意周几都响。
        let a = alarm("a", 14, 30, vec![], true);
        assert!(should_ring_alarm(&a, 0, 14, 30));
        assert!(should_ring_alarm(&a, 3, 14, 30));
        assert!(should_ring_alarm(&a, 6, 14, 30));
    }

    #[test]
    fn one_shot_alarm_no_ring_wrong_time() {
        let a = alarm("a", 14, 30, vec![], true);
        assert!(!should_ring_alarm(&a, 1, 14, 31));
        assert!(!should_ring_alarm(&a, 1, 15, 30));
    }

    #[test]
    fn repeat_alarm_rings_only_on_selected_weekday() {
        // 每周一(1)、周三(3) 重复。
        let a = alarm("a", 9, 0, vec![1, 3], true);
        assert!(should_ring_alarm(&a, 1, 9, 0));
        assert!(should_ring_alarm(&a, 3, 9, 0));
        assert!(!should_ring_alarm(&a, 2, 9, 0));
        assert!(!should_ring_alarm(&a, 1, 9, 1));
    }

    #[test]
    fn disabled_alarm_never_rings() {
        let a = alarm("a", 14, 30, vec![], false);
        assert!(!should_ring_alarm(&a, 2, 14, 30));
    }

    #[test]
    fn new_minute_detection() {
        assert!(is_new_minute(-1, 100));
        assert!(is_new_minute(99, 100));
        assert!(!is_new_minute(100, 100));
    }

    #[test]
    fn countdown_remaining_uses_wall_clock_from_anchor() {
        // 运行中：anchor=60，start_at=1000，now=1030 → 剩余 30。
        assert_eq!(countdown_remaining(Some(1000), 60, 1030), 30);
        // 到点及超时后不产生负数（饱和到 0）。
        assert_eq!(countdown_remaining(Some(1000), 60, 1060), 0);
        assert_eq!(countdown_remaining(Some(1000), 60, 9999), 0);
    }

    #[test]
    fn countdown_remaining_paused_is_anchor() {
        // 暂停/未启动（start_at=None）：剩余即锚点本身。
        assert_eq!(countdown_remaining(None, 42, 9999), 42);
    }

    #[test]
    fn pomodoro_work_to_short_break() {
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "work".to_string(),
            seconds_left: 0,
            work_count: 0,
            in_round: 1,
            phase_start_at: None,
            awaiting_next: false,
        };
        let next = advance_phase(&state, &config);
        assert_eq!(next.phase, "short_break");
        assert_eq!(next.seconds_left, config.short_break_minutes * 60);
        assert_eq!(next.work_count, 1);
        assert_eq!(next.in_round, 2);
        assert!(next.running);
    }

    #[test]
    fn pomodoro_work_to_long_break_after_interval() {
        let config = PomodoroConfig {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            interval_for_long_break: 4,
        };
        let state = PomodoroState {
            running: true,
            phase: "work".to_string(),
            seconds_left: 0,
            work_count: 3,
            in_round: 3,
            phase_start_at: None,
            awaiting_next: false,
        };
        let next = advance_phase(&state, &config);
        assert_eq!(next.phase, "long_break");
        assert_eq!(next.seconds_left, config.long_break_minutes * 60);
        assert_eq!(next.work_count, 4);
        assert_eq!(next.in_round, 0);
    }

    #[test]
    fn pomodoro_break_to_work() {
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "short_break".to_string(),
            seconds_left: 0,
            work_count: 1,
            in_round: 1,
            phase_start_at: None,
            awaiting_next: false,
        };
        let next = advance_phase(&state, &config);
        assert_eq!(next.phase, "work");
        assert_eq!(next.seconds_left, config.work_minutes * 60);
        assert_eq!(next.work_count, 1);
        assert_eq!(next.in_round, 1);
    }

    #[test]
    fn pomodoro_tick_not_running_is_noop() {
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: false,
            phase: "work".to_string(),
            seconds_left: 1500,
            work_count: 0,
            in_round: 0,
            phase_start_at: None,
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 1_000);
        assert_eq!(next, state);
        assert!(completed.is_none());
    }

    #[test]
    fn pomodoro_tick_decrements_without_completion() {
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "work".to_string(),
            seconds_left: 10,
            work_count: 0,
            in_round: 0,
            phase_start_at: Some(1_000),
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 1_000);
        assert_eq!(next.seconds_left, 9);
        assert!(completed.is_none());
        assert_eq!(next.phase, "work");
        // 未到点不推进阶段，phase_start_at 保持不变。
        assert_eq!(next.phase_start_at, Some(1_000));
    }

    #[test]
    fn pomodoro_tick_completes_by_decrement_to_short_break() {
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "work".to_string(),
            seconds_left: 1,
            work_count: 0,
            in_round: 1,
            phase_start_at: Some(1_000),
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 2_000);
        assert_eq!(completed.as_deref(), Some("work"));
        assert_eq!(next.phase, "short_break");
        assert_eq!(next.seconds_left, config.short_break_minutes * 60);
        assert_eq!(next.work_count, 1);
        assert_eq!(next.in_round, 2);
        assert_eq!(next.phase_start_at, Some(2_000));
        assert!(next.running);
    }

    #[test]
    fn pomodoro_tick_restored_zero_advances_to_long_break() {
        // 恢复场景：应用关闭期间工作阶段已走完，恢复后 seconds_left == 0 且 running == true。
        let config = PomodoroConfig {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            interval_for_long_break: 4,
        };
        let state = PomodoroState {
            running: true,
            phase: "work".to_string(),
            seconds_left: 0,
            work_count: 3,
            in_round: 3,
            phase_start_at: Some(1_000),
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 2_000);
        // 不卡死在 0:00：工作阶段恢复走完 → 自动进入长休，work_count 递增。
        assert_eq!(completed.as_deref(), Some("work"));
        assert_eq!(next.phase, "long_break");
        assert_eq!(next.seconds_left, config.long_break_minutes * 60);
        assert_eq!(next.work_count, 4);
        assert_eq!(next.in_round, 0);
        assert_eq!(next.phase_start_at, Some(2_000));
        assert!(next.running);
    }

    #[test]
    fn pomodoro_tick_restored_zero_break_to_work() {
        // 恢复场景：短休阶段已走完 → 挂起（awaiting_next=true），等用户确认才开始下一个番茄。
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "short_break".to_string(),
            seconds_left: 0,
            work_count: 1,
            in_round: 1,
            phase_start_at: Some(1_000),
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 2_000);
        assert_eq!(completed.as_deref(), Some("short_break"));
        // 挂起：不推进到 work，等待用户点「开始下一个番茄」。
        assert_eq!(next.phase, "short_break");
        assert!(!next.running);
        assert!(next.awaiting_next);
        assert_eq!(next.phase_start_at, None);
    }

    #[test]
    fn pomodoro_tick_break_completes_to_awaiting() {
        // 正常流程：短休运行中走完 → 挂起，等用户确认进入工作。
        let config = default_pomodoro_config();
        let state = PomodoroState {
            running: true,
            phase: "short_break".to_string(),
            seconds_left: 1,
            work_count: 1,
            in_round: 1,
            phase_start_at: Some(1_000),
            awaiting_next: false,
        };
        let (next, completed) = tick_pomodoro(&state, &config, 2_000);
        assert_eq!(completed.as_deref(), Some("short_break"));
        assert!(!next.running);
        assert!(next.awaiting_next);
        assert_eq!(next.phase_start_at, None);
    }

    #[test]
    fn chime_fires_on_hour_boundary() {
        assert!(is_chime_time(true, 100, 101, 0));
        assert!(!is_chime_time(true, 101, 101, 0));
        assert!(!is_chime_time(true, 100, 101, 1));
        assert!(!is_chime_time(false, 100, 101, 0));
        assert!(is_chime_time(true, -1, 101, 0));
    }

    #[test]
    fn history_appends_and_caps() {
        let now = 1_000_000u64;
        let history = append_history(Vec::new(), "countdown", 60, now);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].kind, "countdown");
        assert_eq!(history[0].seconds, 60);
        assert_eq!(history[0].finished_at_epoch_secs, now);

        let mut big = Vec::new();
        for i in 0..600 {
            big.push(HistoryEntry {
                kind: "countdown".to_string(),
                seconds: i,
                finished_at_epoch_secs: i,
            });
        }
        let capped = append_history(big, "pomodoro", 1500, now);
        assert_eq!(capped.len(), 500);
        assert_eq!(capped.last().unwrap().kind, "pomodoro");
        assert_eq!(capped.last().unwrap().seconds, 1500);
    }
}
