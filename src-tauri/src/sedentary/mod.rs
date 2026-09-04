//! 久坐提醒工具模块。
//!
//! 后台常驻服务：秒级轮询系统最后输入时间（Windows `GetLastInputInfo`），累计连续
//! 操作时长；达到间隔阈值后弹出透明置顶无边框大窗提醒用户起身活动。macOS/Linux
//! 不实现空闲检测（方案 A），命令返回 `supported: false`，托盘不显示开关。
//!
//! 并发与一致性：`SedentaryState` 用原子量/锁保证轮询线程与 IPC 命令并发安全；
//! 所有对 store 的「读-改-写」经 `store_lock` 串行化（照 sticky 的 store_lock 模式），
//! 防止并发下配置互相覆盖。配置读写失败一律回退默认值，不阻断启动。
//!
//! 结构：`config`（配置默认值/store 读写/屏蔽时段）、`video`（提醒视频）、
//! `window`（弹窗窗口）拆为子模块；本模块保留运行状态、初始化、命令 handler 与
//! 空闲检测轮询，并经 `pub use` 维持原有对外 API。

mod config;
mod video;
// 弹窗窗口仅 Windows 有意义（WebView2 数据目录/透明置顶大窗），且全部函数均已按
// `#[cfg(windows)]` 编译；模块整体门禁避免非 Windows 目标残留未用 import/常量告警。
#[cfg(windows)]
mod window;

pub use config::{QuietPeriod, SedentaryConfig};
// 命令跨模块 re-export 时，`generate_handler!` 按定义模块生成 `__cmd__<name>`
// 宏路径，因此命令宏与命令函数必须一并 re-export，lib.rs 的 `sedentary::*` 路径才可解析。
#[cfg(windows)]
#[allow(unused_imports)]
pub use video::{
    ensure_reminder_video, sedentary_reset_user_video, sedentary_set_user_video,
    __cmd__sedentary_reset_user_video, __cmd__sedentary_set_user_video,
    __specta__fn__sedentary_reset_user_video, __specta__fn__sedentary_set_user_video,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::AppError;

/// 久坐提醒运行状态。
pub struct SedentaryState {
    /// 总开关（内存镜像，持久化在 store）。
    enabled: AtomicBool,
    /// 当前连续久坐秒数。
    sitting_seconds: AtomicU64,
    /// 间隔时长（秒，内存镜像）。
    remind_seconds: AtomicU64,
    /// 闲置重置阈值（秒，内存镜像）。
    idle_reset_seconds: AtomicU64,
    /// 提醒文案（内存镜像）。
    message: Mutex<String>,
    /// 上次提醒触发时刻（完整间隔冷却用）。
    last_remind_at: Mutex<Option<Instant>>,
    /// 上次点「稍后」的时刻（snooze 短冷却起点）；None = 未 snooze。
    last_snooze_at: Mutex<Option<Instant>>,
    /// 屏蔽时段列表（内存镜像，持久化在 store；tick 与 get_state 都读，用 Mutex）。
    quiet_periods: Mutex<Vec<QuietPeriod>>,
    /// 当前是否处于屏蔽时段（内存镜像，轮询 tick 每秒刷新）。
    quiet_active: AtomicBool,
    /// 距屏蔽结束剩余秒数（非屏蔽中为 0，内存镜像）。
    quiet_remaining_seconds: AtomicU64,
    /// 串行化所有 store「读-改-写」，防并发覆盖。
    store_lock: Mutex<()>,
}

impl SedentaryState {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(config::DEFAULT_ENABLED),
            sitting_seconds: AtomicU64::new(0),
            remind_seconds: AtomicU64::new(config::DEFAULT_REMIND_MINUTES * 60),
            idle_reset_seconds: AtomicU64::new(config::DEFAULT_IDLE_RESET_MINUTES * 60),
            message: Mutex::new(config::DEFAULT_MESSAGE.to_string()),
            last_remind_at: Mutex::new(None),
            last_snooze_at: Mutex::new(None),
            quiet_periods: Mutex::new(Vec::new()),
            quiet_active: AtomicBool::new(false),
            quiet_remaining_seconds: AtomicU64::new(0),
            store_lock: Mutex::new(()),
        }
    }

    /// 当前是否开启（内存镜像）。
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 启动时从 store 加载持久化配置到内存。读取失败回退默认值，不阻断启动。
    pub fn load_from_store<R: Runtime>(&self, app: &AppHandle<R>) {
        let _guard = match self.store_lock.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match config::read_config(app) {
            Ok(config) => self.apply_config(&config),
            Err(error) => {
                log::warn!("[sedentary] 读取配置失败，回退默认值：{error}");
                self.apply_config(&config::default_config());
            }
        }
    }

    /// 把配置应用到内存状态（供轮询线程快速读取，与 store 保持一致）。
    fn apply_config(&self, config: &SedentaryConfig) {
        self.enabled.store(config.enabled, Ordering::Relaxed);
        self.remind_seconds
            .store(config.remind_minutes * 60, Ordering::Relaxed);
        self.idle_reset_seconds
            .store(config.idle_reset_minutes * 60, Ordering::Relaxed);
        if let Ok(mut message) = self.message.lock() {
            *message = config.message.clone();
        }
        if let Ok(mut periods) = self.quiet_periods.lock() {
            *periods = config.quiet_periods.clone();
        }
    }
}

/// 应用启动时初始化久坐提醒：创建状态并从 store 灌入配置镜像，Windows 上先
/// 确保提醒视频就位（复制失败回退无视频模式），再启动空闲检测轮询线程，并
/// 后台预热独立 WebView2 环境（否则首次同步建窗会阻塞主线程事件循环，导致
/// IPC 全挂——真机复现）。预热异步执行，不阻塞应用启动。
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 久坐提醒状态：启动时从 store 灌入配置镜像，Windows 上先确保提醒视频
    // 就位（复制失败回退无视频模式），再启动空闲检测轮询线程。
    let sedentary_state = SedentaryState::new();
    sedentary_state.load_from_store(app.handle());
    app.manage(sedentary_state);
    #[cfg(windows)]
    let _ = video::ensure_reminder_video(app.handle());
    #[cfg(windows)]
    spawn_polling_thread(app.handle().clone());
    Ok(())
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

/// `sedentary_get_config` 返回体。
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SedentaryGetConfigResponse {
    enabled: bool,
    remind_minutes: u64,
    idle_reset_minutes: u64,
    message: String,
    /// 视频播放开关（弹窗据此决定是否进入视频阶段）。
    video_enabled: bool,
    /// 提醒视频绝对路径；视频缺失/复制失败时为空串（无视频模式）。
    video_path: String,
    /// 当前平台是否支持空闲检测（Windows 为 true）。
    supported: bool,
    /// 屏蔽时段列表（空 = 不屏蔽）。
    quiet_periods: Vec<QuietPeriod>,
}

/// 获取配置（工具页/弹窗初始化）。读取 store 权威数据，失败回退默认值。
#[tauri::command]
#[specta::specta]
pub fn sedentary_get_config<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SedentaryState>,
) -> Result<SedentaryGetConfigResponse, AppError> {
    let config = {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "久坐提醒 store 锁获取失败".to_string())?;
        config::read_config(&app).unwrap_or_else(|error| {
            log::warn!("[sedentary] 读取配置失败，回退默认值：{error}");
            config::default_config()
        })
    };
    Ok(SedentaryGetConfigResponse {
        supported: cfg!(windows),
        enabled: config.enabled,
        remind_minutes: config.remind_minutes,
        idle_reset_minutes: config.idle_reset_minutes,
        message: config.message,
        video_enabled: config.video_enabled,
        quiet_periods: config.quiet_periods,
        // 仅 Windows 填充视频路径（顺带确保视频就位）；其余平台恒为空串。
        video_path: {
            #[cfg(windows)]
            {
                video::ensure_reminder_video(&app).map_or_else(String::new, |p| {
                    p.to_string_lossy().into_owned()
                })
            }
            #[cfg(not(windows))]
            {
                String::new()
            }
        },
    })
}

/// 更新配置并持久化；`remindMinutes`/`idleResetMinutes` 变更时重置当前计时。
// 可选入参均映射 invoke 载荷字段（含屏蔽时段），数量超过 clippy 默认阈值，显式放行。
// 仅 Windows：空闲检测/弹窗为 Windows 专属，前端以 `supported: false` 禁用交互
// （tray 的 sedentary_enabled 菜单项同样已按 `#[cfg(windows)]` 门禁）。
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn sedentary_set_config<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SedentaryState>,
    enabled: Option<bool>,
    remind_minutes: Option<u64>,
    idle_reset_minutes: Option<u64>,
    message: Option<String>,
    video_enabled: Option<bool>,
    quiet_periods: Option<Vec<QuietPeriod>>,
) -> Result<(), AppError> {
    // 整个「读-改-写」持锁串行化，避免并发下配置互相覆盖。
    let reset_timer = {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "久坐提醒 store 锁获取失败".to_string())?;
        let mut current = config::read_config(&app).unwrap_or_else(|error| {
            log::warn!("[sedentary] 读取配置失败，回退默认值：{error}");
            config::default_config()
        });
        let mut reset_timer = false;

        if let Some(value) = enabled {
            current.enabled = value;
        }
        if let Some(value) = remind_minutes {
            // 间隔时长限定 1~120 分钟（PRD REQ-12）。
            let clamped = value.clamp(*config::REMIND_MINUTES_RANGE.start(), *config::REMIND_MINUTES_RANGE.end());
            if clamped != current.remind_minutes {
                current.remind_minutes = clamped;
                reset_timer = true;
            }
        }
        if let Some(value) = idle_reset_minutes {
            // 闲置阈值至少 1 分钟，避免为 0 导致秒秒重置。
            let clamped = value.max(1);
            if clamped != current.idle_reset_minutes {
                current.idle_reset_minutes = clamped;
                reset_timer = true;
            }
        }
        if let Some(value) = message {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                current.message = trimmed.to_string();
            }
        }
        if let Some(value) = video_enabled {
            current.video_enabled = value;
        }
        if let Some(value) = quiet_periods {
            // 校验失败直接 Err 返回，不落盘（前端已拦截，后端兜底）。
            config::validate_quiet_periods(&value)?;
            current.quiet_periods = value;
        }

        config::write_config(&app, &current)?;
        // 在锁内更新内存态，保证与 store 一致。
        state.apply_config(&current);
        reset_timer
    };

    if reset_timer {
        state.sitting_seconds.store(0, Ordering::Relaxed);
    }
    if enabled == Some(false) {
        // 通过配置关掉开关：行为与 toggle 一致——计时归零、清屏蔽镜像并关掉已开弹窗。
        state.sitting_seconds.store(0, Ordering::Relaxed);
        state.quiet_active.store(false, Ordering::Relaxed);
        state.quiet_remaining_seconds.store(0, Ordering::Relaxed);
        window::close_reminder_window(&app);
    }
    Ok(())
}

/// `sedentary_get_state` 返回体。
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SedentaryGetStateResponse {
    enabled: bool,
    sitting_seconds: u64,
    remind_seconds: u64,
    /// 当前是否处于屏蔽时段。
    quiet_active: bool,
    /// 距屏蔽结束剩余秒数（非屏蔽中为 0）。
    quiet_remaining_seconds: u64,
}

/// 获取实时状态（工具页轮询）。
#[tauri::command]
#[specta::specta]
pub fn sedentary_get_state(
    state: State<'_, SedentaryState>,
) -> Result<SedentaryGetStateResponse, AppError> {
    Ok(SedentaryGetStateResponse {
        enabled: state.enabled.load(Ordering::Relaxed),
        sitting_seconds: state.sitting_seconds.load(Ordering::Relaxed),
        remind_seconds: state.remind_seconds.load(Ordering::Relaxed),
        quiet_active: state.quiet_active.load(Ordering::Relaxed),
        quiet_remaining_seconds: state.quiet_remaining_seconds.load(Ordering::Relaxed),
    })
}

/// 弹窗按钮动作：`got_up` = 已起身（重置计时并关窗）；`snooze` = 稍后（关窗，
/// 5 分钟后再次提醒，计时持续累计）。
/// 仅 Windows：动作作用于久坐提醒弹窗，该弹窗仅在 Windows 存在。
#[cfg(windows)]
#[tauri::command]
#[specta::specta]
pub fn sedentary_remind_action<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SedentaryState>,
    action: String,
) -> Result<(), AppError> {
    match action.as_str() {
        "got_up" => {
            state.sitting_seconds.store(0, Ordering::Relaxed);
            // 清掉 snooze 冷却，保持状态干净（清零已阻止触发，此处为语义兜底）。
            if let Ok(mut snooze) = state.last_snooze_at.lock() {
                *snooze = None;
            }
            window::close_reminder_window(&app);
        }
        "snooze" => {
            // 记录 snooze 冷却起点：5 分钟后（snooze 冷却已过）再弹。
            if let Ok(mut snooze) = state.last_snooze_at.lock() {
                *snooze = Some(Instant::now());
            }
            window::close_reminder_window(&app);
        }
        other => return Err(AppError::Message(format!("未知的久坐提醒操作：{other}"))),
    }
    Ok(())
}

/// 总开关（托盘/工具页）。关闭时计时归零并关掉已开弹窗。
/// 仅 Windows：开关与空闲检测轮询/弹窗绑定，非 Windows 前端以 `supported: false` 禁用。
#[cfg(windows)]
#[tauri::command]
#[specta::specta]
pub fn sedentary_toggle<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SedentaryState>,
    enabled: bool,
) -> Result<(), AppError> {
    {
        let _guard = state
            .store_lock
            .lock()
            .map_err(|_| "久坐提醒 store 锁获取失败".to_string())?;
        let mut config = config::read_config(&app).unwrap_or_else(|error| {
            log::warn!("[sedentary] 读取配置失败，回退默认值：{error}");
            config::default_config()
        });
        config.enabled = enabled;
        config::write_config(&app, &config)?;
        state.apply_config(&config);
    }
    if !enabled {
        state.sitting_seconds.store(0, Ordering::Relaxed);
        // 同步清掉屏蔽镜像：关闭后一切停止，状态显示「已停止」而非残留的「屏蔽中」。
        state.quiet_active.store(false, Ordering::Relaxed);
        state.quiet_remaining_seconds.store(0, Ordering::Relaxed);
        window::close_reminder_window(&app);
    }
    Ok(())
}

/// 预览提醒弹窗：直接弹出与真实提醒完全一致的窗口，便于验收效果。
///
/// 仅预览用途：不记录 `last_remind_at`、不消耗冷却期，也不影响真实触发逻辑
/// （真实提醒仍由轮询线程的 `trigger_reminder` 驱动）。
#[cfg(windows)]
#[tauri::command]
#[specta::specta]
pub fn sedentary_preview<R: Runtime>(app: AppHandle<R>) -> Result<(), AppError> {
    // 预览不改变开关状态；开关关闭时直接返回明确错误，避免命中
    // `create_reminder_window` 内部「开关已关则静默 Ok(())」的复查守卫
    // （该守卫仅为真实触发的异步派发防竞态），造成前端「点了没反应」。
    if !app.state::<SedentaryState>().is_enabled() {
        return Err(AppError::Message("久坐提醒已关闭，请先开启".to_string()));
    }
    // 关键：命令跑在主线程，主线程直接调 run_on_main_thread 会同步执行闭包
    // （build() 照样阻塞事件循环 → 死锁）。必须先 spawn 后台线程，再在后台
    // 线程里 run_on_main_thread 异步投递——命令立即返回，build() 在事件循环
    // 空闲时执行（照 trigger_reminder 从轮询线程投递的模式，真机验证正常）。
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let app_handle = app_handle.clone();
        let inner_handle = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            if let Err(error) = window::create_reminder_window(&inner_handle) {
                log::error!("[sedentary] 创建提醒窗口失败：{error}");
            }
        });
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// 空闲检测轮询（仅 Windows）
// ---------------------------------------------------------------------------

/// 触发判定（纯逻辑，便于测试）：久坐达到阈值且任一冷却期已过 → 触发。
///
/// 两种冷却并存，任一满足即触发：
/// - **完整间隔冷却**（`last_remind_elapsed`，弹窗出现即记录）：兜底节奏。防止
///   「从未 snooze、完整间隔未到」时提前弹窗（`None` = 从未弹过 → 首次到阈值即弹）。
/// - **snooze 短冷却**（`last_snooze_elapsed`，点「稍后」时记录）：点「稍后」后
///   5 分钟（`DEFAULT_SNOOZE_SECONDS`）再催。`None` = 未 snooze，不参与命中
///   （等价原行为）。
#[cfg_attr(not(windows), allow(dead_code))]
fn should_trigger(
    sitting_seconds: u64,
    remind_seconds: u64,
    last_remind_elapsed: Option<Duration>,
    last_snooze_elapsed: Option<Duration>,
) -> bool {
    if remind_seconds == 0 || sitting_seconds < remind_seconds {
        return false;
    }
    let remind_ready = match last_remind_elapsed {
        None => true,
        Some(elapsed) => elapsed >= Duration::from_secs(remind_seconds),
    };
    let snooze_ready = match last_snooze_elapsed {
        None => false, // 未点过「稍后」：不参与短冷却触发
        Some(elapsed) => elapsed >= Duration::from_secs(config::DEFAULT_SNOOZE_SECONDS),
    };
    remind_ready || snooze_ready
}

/// 触发提醒：记录冷却时刻，并把窗口创建派发到主线程（WebView 必须主线程创建）。
#[cfg(windows)]
fn trigger_reminder<R: Runtime>(app: &AppHandle<R>, state: &SedentaryState) {
    if let Ok(mut last) = state.last_remind_at.lock() {
        *last = Some(Instant::now());
    }
    // 闭包需持有独立 AppHandle；run_on_main_thread 借用 &app 本身。
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = window::create_reminder_window(&app_handle) {
            // 弹窗创建失败只记日志，不崩溃主程序（design：运行/回滚考虑）。
            log::error!("[sedentary] 创建提醒窗口失败：{error}");
            // 回退冷却（置空），让下一 tick 重试，避免冷却期被白白消耗。
            if let Ok(mut last) = app_handle.state::<SedentaryState>().last_remind_at.lock() {
                *last = None;
            }
        }
    });
}

/// 启动轮询线程：每秒一次空闲检测 + 久坐累计 + 触发判定。独立线程，不阻塞 Tauri 主线程。
#[cfg(windows)]
pub fn spawn_polling_thread(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<SedentaryState>();
        let state_ref: &SedentaryState = &state;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick_polling(&app, state_ref);
        }
    });
}

/// 单次轮询逻辑（拆出来便于测试/维护）。
#[cfg(windows)]
fn tick_polling<R: Runtime>(app: &AppHandle<R>, state: &SedentaryState) {
    if !state.enabled.load(Ordering::Relaxed) {
        // 关闭状态：计时归零，等待重新开启。
        state.sitting_seconds.store(0, Ordering::Relaxed);
        return;
    }
    // 刷新屏蔽状态镜像（enabled 打开时才刷，关闭时无意义）。
    // 命中屏蔽：不检测、不提醒、计时清零并关掉已开弹窗；退出屏蔽：自动恢复累计。
    let now_minutes = {
        use chrono::Timelike;
        let now = chrono::Local::now();
        now.hour() * 60 + now.minute()
    };
    let quiet_remaining = {
        let periods = state
            .quiet_periods
            .lock()
            .ok()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        config::quiet_period_remaining_seconds(&periods, now_minutes)
    };
    match quiet_remaining {
        Some(secs) => {
            state.quiet_active.store(true, Ordering::Relaxed);
            state
                .quiet_remaining_seconds
                .store(secs, Ordering::Relaxed);
            state.sitting_seconds.store(0, Ordering::Relaxed);
            window::close_reminder_window(app);
            return;
        }
        None => {
            state.quiet_active.store(false, Ordering::Relaxed);
            state.quiet_remaining_seconds.store(0, Ordering::Relaxed);
        }
    }
    let idle_reset_seconds = state.idle_reset_seconds.load(Ordering::Relaxed);
    match get_idle_millis() {
        Some(idle_ms) if idle_ms < idle_reset_seconds * 1000 => {
            // 用户活跃（未超过闲置阈值）：继续累计久坐。
            state.sitting_seconds.fetch_add(1, Ordering::Relaxed);
        }
        _ => {
            // 闲置超过阈值或检测失败：视为起身离开，计时归零。
            state.sitting_seconds.store(0, Ordering::Relaxed);
        }
    }
    let sitting_seconds = state.sitting_seconds.load(Ordering::Relaxed);
    let remind_seconds = state.remind_seconds.load(Ordering::Relaxed);
    let last_elapsed = state
        .last_remind_at
        .lock()
        .ok()
        .and_then(|last| last.map(|t| t.elapsed()));
    let last_snooze_elapsed = state
        .last_snooze_at
        .lock()
        .ok()
        .and_then(|snooze| snooze.map(|t| t.elapsed()));
    if should_trigger(
        sitting_seconds,
        remind_seconds,
        last_elapsed,
        last_snooze_elapsed,
    ) {
        trigger_reminder(app, state);
    }
}

/// 获取系统闲置毫秒数：`GetLastInputInfo` 的最后输入 tick 与当前 tick 的差。
///
/// `dwTime` 是 32 位 tick（自系统启动 ms，49.7 天回绕），用 `wrapping_sub` 处理回绕。
#[cfg(windows)]
fn get_idle_millis() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    unsafe {
        let mut last = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            ..Default::default()
        };
        // windows crate 0.61 中 GetLastInputInfo 返回 BOOL（非 Result），失败返回 false。
        if !GetLastInputInfo(&mut last).as_bool() {
            return None;
        }
        let now_tick = GetTickCount();
        Some(now_tick.wrapping_sub(last.dwTime) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trigger_when_reaches_threshold_no_prior_remind() {
        assert!(should_trigger(60, 60, None, None));
        assert!(should_trigger(61, 60, None, None));
    }

    #[test]
    fn no_trigger_below_threshold() {
        assert!(!should_trigger(59, 60, None, None));
    }

    #[test]
    fn no_trigger_during_cooldown() {
        // 完整间隔冷却未过（距上次提醒 59s < 60s），且从未 snooze：不弹。
        assert!(!should_trigger(61, 60, Some(Duration::from_secs(59)), None));
    }

    #[test]
    fn trigger_after_cooldown() {
        // 完整间隔冷却已过（距上次提醒 >= 60s），从未 snooze：再弹（原行为回归）。
        assert!(should_trigger(61, 60, Some(Duration::from_secs(60)), None));
        assert!(should_trigger(61, 60, Some(Duration::from_secs(61)), None));
    }

    #[test]
    fn no_trigger_when_remind_zero() {
        assert!(!should_trigger(0, 0, None, None));
    }

    // ---------------------------------------------------------------------
    // snooze 短冷却（点「稍后」后 5 分钟再催）
    // ---------------------------------------------------------------------

    #[test]
    fn no_trigger_when_snooze_cooldown_active() {
        // snooze 冷却未到（<300s）且完整间隔冷却也未到：不弹。
        assert!(!should_trigger(
            61,
            60,
            Some(Duration::from_secs(59)),
            Some(Duration::from_secs(299))
        ));
    }

    #[test]
    fn trigger_when_snooze_cooldown_elapsed() {
        // snooze 冷却已到（>=300s）即使完整间隔冷却未到：弹（核心新行为：5 分钟后再催）。
        assert!(should_trigger(
            61,
            60,
            Some(Duration::from_secs(59)),
            Some(Duration::from_secs(300))
        ));
        assert!(should_trigger(
            61,
            60,
            Some(Duration::from_secs(0)),
            Some(Duration::from_secs(301))
        ));
    }

    #[test]
    fn no_trigger_below_threshold_with_snooze_elapsed() {
        // 低于阈值即使 snooze 冷却已到：不弹（闲置清零兜底）。
        assert!(!should_trigger(
            59,
            60,
            None,
            Some(Duration::from_secs(300))
        ));
    }

    #[test]
    fn no_trigger_when_remind_zero_with_snooze_elapsed() {
        // remind_seconds == 0 即使 snooze 冷却已到：不弹。
        assert!(!should_trigger(0, 0, None, Some(Duration::from_secs(300))));
    }
}
