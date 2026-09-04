//! 计时中心 store 层：常量、`TimerState` 运行态、默认值，以及全部对
//! `timer.json` 的「读-改-写」（经 `store_lock` 串行化，防止并发覆盖）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::alarms::{Alarm, SnoozedAlarm};
use super::alert::AlertPayload;
use super::countdown::Countdown;
use super::history::HistoryEntry;
use super::logic::now_epoch_secs;
use super::pomodoro::{PomodoroConfig, PomodoroState};
use super::presets::CountdownPreset;

/// 弹窗窗口路由（vite 多入口 timer.html）。
pub(crate) const TIMER_WINDOW_APP_ROUTE: &str = "timer.html";
/// store 文件名。
const TIMER_STORE_FILE: &str = "timer.json";
/// 闹钟列表 store key。
const TIMER_KEY_ALARMS: &str = "timer:alarms";
/// 运行中倒计时 store key。
const TIMER_KEY_COUNTDOWN: &str = "timer:countdown";
/// 番茄钟配置 + 运行态 store key。
const TIMER_KEY_POMODORO: &str = "timer:pomodoro";
/// 倒计时预设 store key。
const TIMER_KEY_PRESETS: &str = "timer:presets";
/// 整点报时开关 store key。
const TIMER_KEY_CHIME: &str = "timer:chime";
/// 历史统计 store key。
const TIMER_KEY_HISTORY: &str = "timer:history";

/// 贪睡时长（秒）：闹钟到点后点「贪睡」= 5 分钟后再响。
pub(crate) const SNOOZE_SECONDS: u64 = 300;

/// 倒计时实例固定 id（单实例）。
pub(crate) const COUNTDOWN_ID: &str = "countdown";

// ---------------------------------------------------------------------------
// TimerState
// ---------------------------------------------------------------------------

/// 计时中心运行状态。
pub struct TimerState {
    /// 闹钟列表（内存镜像，权威在 store）。
    pub(crate) alarms: Mutex<Vec<Alarm>>,
    /// 运行中/暂停中的倒计时（内存镜像，权威在 store）。
    pub(crate) countdown: Mutex<Option<Countdown>>,
    /// 番茄钟配置（内存镜像）。
    pub(crate) pomodoro_config: Mutex<PomodoroConfig>,
    /// 番茄钟运行态（内存镜像）。
    pub(crate) pomodoro_state: Mutex<PomodoroState>,
    /// 倒计时预设（内存镜像）。
    pub(crate) presets: Mutex<Vec<CountdownPreset>>,
    /// 整点报时开关（内存镜像）。
    pub(crate) chime_enabled: AtomicBool,
    /// 历史统计（内存镜像）。
    pub(crate) history: Mutex<Vec<HistoryEntry>>,
    /// 上次处理的分钟（epoch 分钟），-1 = 未处理过。用于闹钟单分钟去重。
    pub(crate) last_processed_minute: AtomicI64,
    /// 上次整点报时的 epoch 小时，-1 = 从未报时。
    pub(crate) last_chime_hour: AtomicI64,
    /// 贪睡中的闹钟列表。
    pub(crate) snoozed_alarms: Mutex<Vec<SnoozedAlarm>>,
    /// 弹窗载荷（key = "{kind}:{id}"），弹窗初始化读取。
    pub(crate) alert_payloads: Mutex<HashMap<String, AlertPayload>>,
    /// 串行化所有 store「读-改-写」，防并发覆盖。
    pub(crate) store_lock: Mutex<()>,
}

impl TimerState {
    pub fn new() -> Self {
        Self {
            alarms: Mutex::new(Vec::new()),
            countdown: Mutex::new(None),
            pomodoro_config: Mutex::new(default_pomodoro_config()),
            pomodoro_state: Mutex::new(default_pomodoro_state()),
            presets: Mutex::new(default_presets()),
            chime_enabled: AtomicBool::new(false),
            history: Mutex::new(Vec::new()),
            last_processed_minute: AtomicI64::new(-1),
            last_chime_hour: AtomicI64::new(-1),
            snoozed_alarms: Mutex::new(Vec::new()),
            alert_payloads: Mutex::new(HashMap::new()),
            store_lock: Mutex::new(()),
        }
    }

    /// 启动时从 store 加载全部配置/状态到内存。读取失败回退默认值，不阻断启动。
    pub fn load_from_store<R: Runtime>(&self, app: &AppHandle<R>) {
        let _guard = match self.store_lock.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let now = now_epoch_secs();

        if let Ok(v) = read_alarms(app) {
            *self.alarms.lock().unwrap() = v;
        }
        if let Ok(cd) = read_countdown(app) {
            // 恢复：running 态的 remaining_seconds 是 start_at 时刻的锚点，运行剩余
            // 由 countdown_remaining 按墙钟推算（与调度线程同口径），此处保持锚点不变。
            *self.countdown.lock().unwrap() = cd;
        }
        if let Ok(p) = read_pomodoro(app) {
            let mut st = p.state;
            if st.running {
                if let Some(start) = st.phase_start_at {
                    st.seconds_left = st.seconds_left.saturating_sub(now.saturating_sub(start));
                }
            }
            *self.pomodoro_config.lock().unwrap() = p.config;
            *self.pomodoro_state.lock().unwrap() = st;
        }
        if let Ok(v) = read_presets(app) {
            *self.presets.lock().unwrap() = v;
        }
        if let Ok(v) = read_chime(app) {
            self.chime_enabled.store(v, Ordering::Relaxed);
        }
        if let Ok(v) = read_history(app) {
            *self.history.lock().unwrap() = v;
        }
    }
}

// ---------------------------------------------------------------------------
// 默认值
// ---------------------------------------------------------------------------

pub(crate) fn default_pomodoro_config() -> PomodoroConfig {
    PomodoroConfig {
        work_minutes: 25,
        short_break_minutes: 5,
        long_break_minutes: 15,
        interval_for_long_break: 4,
    }
}

fn default_pomodoro_state() -> PomodoroState {
    PomodoroState {
        running: false,
        phase: "work".to_string(),
        seconds_left: 25 * 60,
        work_count: 0,
        in_round: 0,
        phase_start_at: None,
        awaiting_next: false,
    }
}

fn default_presets() -> Vec<CountdownPreset> {
    vec![
        CountdownPreset { id: "preset-1m".to_string(), seconds: 60, name: "1 分钟".to_string() },
        CountdownPreset { id: "preset-5m".to_string(), seconds: 300, name: "5 分钟".to_string() },
        CountdownPreset { id: "preset-10m".to_string(), seconds: 600, name: "10 分钟".to_string() },
        CountdownPreset { id: "preset-15m".to_string(), seconds: 900, name: "15 分钟".to_string() },
        CountdownPreset { id: "preset-25m".to_string(), seconds: 1500, name: "25 分钟".to_string() },
        CountdownPreset { id: "preset-30m".to_string(), seconds: 1800, name: "30 分钟".to_string() },
        CountdownPreset { id: "preset-45m".to_string(), seconds: 2700, name: "45 分钟".to_string() },
        CountdownPreset { id: "preset-60m".to_string(), seconds: 3600, name: "60 分钟".to_string() },
    ]
}

// ---------------------------------------------------------------------------
// store 读写（调用方须持有 store_lock 时写）
// ---------------------------------------------------------------------------

/// 番茄钟持久化体（配置 + 运行态一起存）。
#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroPersist {
    pub config: PomodoroConfig,
    pub state: PomodoroState,
}

pub(crate) fn read_alarms<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Alarm>, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_ALARMS) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析闹钟列表失败：{e}")),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn write_alarms<R: Runtime>(app: &AppHandle<R>, alarms: &[Alarm]) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(
        TIMER_KEY_ALARMS,
        serde_json::to_value(alarms).map_err(|e| format!("序列化闹钟列表失败：{e}"))?,
    );
    store.save().map_err(|e| format!("保存闹钟列表失败：{e}"))
}

pub(crate) fn read_countdown<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Countdown>, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_COUNTDOWN) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析倒计时失败：{e}")),
        None => Ok(None),
    }
}

pub(crate) fn write_countdown<R: Runtime>(app: &AppHandle<R>, cd: &Option<Countdown>) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(
        TIMER_KEY_COUNTDOWN,
        serde_json::to_value(cd).map_err(|e| format!("序列化倒计时失败：{e}"))?,
    );
    store.save().map_err(|e| format!("保存倒计时失败：{e}"))
}

pub(crate) fn read_pomodoro<R: Runtime>(app: &AppHandle<R>) -> Result<PomodoroPersist, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_POMODORO) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析番茄钟失败：{e}")),
        None => Ok(PomodoroPersist {
            config: default_pomodoro_config(),
            state: default_pomodoro_state(),
        }),
    }
}

pub(crate) fn write_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    config: &PomodoroConfig,
    state: &PomodoroState,
) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(
        TIMER_KEY_POMODORO,
        serde_json::to_value(PomodoroPersist {
            config: config.clone(),
            state: state.clone(),
        })
        .map_err(|e| format!("序列化番茄钟失败：{e}"))?,
    );
    store.save().map_err(|e| format!("保存番茄钟失败：{e}"))
}

pub(crate) fn read_presets<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<CountdownPreset>, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_PRESETS) {
        // 用户尚未写过多项（或清空过）：返回内置预设。
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析预设失败：{e}")),
        None => Ok(default_presets()),
    }
}

pub(crate) fn write_presets<R: Runtime>(app: &AppHandle<R>, presets: &[CountdownPreset]) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(
        TIMER_KEY_PRESETS,
        serde_json::to_value(presets).map_err(|e| format!("序列化预设失败：{e}"))?,
    );
    store.save().map_err(|e| format!("保存预设失败：{e}"))
}

pub(crate) fn read_chime<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_CHIME) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析整点报时失败：{e}")),
        None => Ok(false),
    }
}

pub(crate) fn write_chime<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(TIMER_KEY_CHIME, serde_json::json!(enabled));
    store.save().map_err(|e| format!("保存整点报时失败：{e}"))
}

pub(crate) fn read_history<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<HistoryEntry>, String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    match store.get(TIMER_KEY_HISTORY) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("解析历史统计失败：{e}")),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn write_history<R: Runtime>(app: &AppHandle<R>, history: &[HistoryEntry]) -> Result<(), String> {
    let store = app
        .store(TIMER_STORE_FILE)
        .map_err(|e| format!("打开计时 store 失败：{e}"))?;
    store.set(
        TIMER_KEY_HISTORY,
        serde_json::to_value(history).map_err(|e| format!("序列化历史统计失败：{e}"))?,
    );
    store.save().map_err(|e| format!("保存历史统计失败：{e}"))
}
