//! 计时中心工具模块（闹钟 / 倒计时 / 番茄钟 / 整点报时 / 历史统计）。
//!
//! 后台常驻服务：秒级轮询调度线程统一驱动闹钟命中、倒计时递减、番茄阶段机与
//! 整点报时；到点后经 `run_on_main_thread` 创建透明置顶无边框弹窗
//! （`timer.html` 多入口），弹窗按钮通过 `timer_alert_action` 回写状态。
//!
//! 并发与一致性（照 sedentary）：`TimerState` 用原子量 + Mutex 镜像内存态，
//! 所有对 store（`timer.json`）的「读-改-写」经 `store_lock` 串行化，防止并发
//! 覆盖。倒计时运行态**不逐秒写 store**：启动/继续时持久化 `start_at + remaining`
//! 锚点，运行中与恢复时统一按 `countdown_remaining` 墙钟推算剩余，不逐秒递减。
//!
//! 弹窗创建失败只记日志、不崩溃主程序；轮询线程为独立线程，panic 不影响主进程。
//!
//! 结构：`store.rs` 常量与 store 读写，`logic.rs` 纯逻辑，`alarms.rs`/`countdown.rs`/
//! `pomodoro.rs`/`presets.rs`/`history.rs`/`chime.rs` 各功能域，`alert.rs` 弹窗，
//! `scheduler.rs` 轮询调度。`lib.rs` 直接引用各子模块实际路径。

pub mod alarms;
pub mod alert;
pub mod chime;
pub mod countdown;
pub mod history;
pub mod logic;
pub mod pomodoro;
pub mod presets;
pub mod scheduler;
pub mod store;

// 外部（lib.rs）直接引用的符号：setup 用 `crate::timer::initialize`；命令经
// `attach_invoke_handler!` 引用各子模块实际路径（如 `timer::alarms::timer_add_alarm`）。
pub use scheduler::initialize;
