//! 秒级轮询调度线程：统一驱动闹钟/倒计时/番茄/整点检查。独立线程，不阻塞主进程。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, Runtime};

use super::alarms::{check_alarms, check_snoozed};
use super::chime::check_chime;
use super::countdown::check_countdown;
use super::logic::{is_new_minute, local_time_parts, now_epoch_secs};
use super::pomodoro::check_pomodoro;
use super::store::TimerState;

/// 启动轮询线程：每秒一次调度检查（闹钟/倒计时/番茄/整点）。独立线程，不阻塞主线程。
pub fn spawn_polling_thread(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<TimerState>();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            // 单次 tick 内任意域锁中毒 panic 都不应停掉整个调度线程：捕获并继续下一轮。
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                tick_polling(&app, &state);
            }));
        }
    });
}

/// 应用启动时初始化计时中心：创建状态并从 store 灌入内存镜像，再启动秒级调度线程。
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 计时中心状态：启动时从 store 灌入内存镜像，启动秒级调度线程。
    let timer_state = TimerState::new();
    timer_state.load_from_store(app.handle());
    app.manage(timer_state);
    spawn_polling_thread(app.handle().clone());
    Ok(())
}

/// 单次轮询逻辑（拆出来便于测试/维护）。
fn tick_polling<R: Runtime>(app: &AppHandle<R>, state: &TimerState) {
    let now = now_epoch_secs();
    let now_minutes = now / 60;
    let (weekday, hour, minute) = local_time_parts(now);

    // 1. 闹钟（仅在新分钟的首个 tick 检查，避免同一分钟重复弹）。
    let first_of_minute = is_new_minute(state.last_processed_minute.load(Ordering::Relaxed), now_minutes as i64);
    if first_of_minute {
        state
            .last_processed_minute
            .store(now_minutes as i64, Ordering::Relaxed);
        check_alarms(app, state, weekday, hour, minute);
    }

    // 2. 贪睡的闹钟。
    check_snoozed(app, state, now);

    // 3. 倒计时递减。
    check_countdown(app, state, now);

    // 4. 番茄阶段。
    check_pomodoro(app, state, now);

    // 5. 整点报时。
    check_chime(app, state, hour, minute, (now / 3600) as i64);
}
