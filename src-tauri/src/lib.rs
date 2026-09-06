// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod element_detect;
mod env;
mod macos_overlay;
pub mod error;
mod ocr;
mod pwdbox;
mod screenshot_shared;
mod screenshot_universal;
mod sedentary;
mod sticky;
mod shortcuts;
mod timer;
mod toast;
mod tray;
#[cfg(all(debug_assertions, windows))]
mod console_shutdown;

use tauri::Manager;

// 命令按模块分组注册（P3-c）。
//
// 验证结论：
// 1) Tauri 2（本仓库锁定 tauri 2.10.3）的 `Builder::invoke_handler` 每次调用都会覆盖
//    先前注册的 handler（`self.invoke_handler = Box::new(invoke_handler)`，见
//    tauri-2.10.3/src/app.rs:1526-1532），不支持多次 `.invoke_handler(...)` 合并；
// 2) `tauri::generate_handler!` 是过程宏，其实参中的宏调用不会被编译器预先展开
//    （过程宏接收原始 token 流），因此也不能把 `*_commands!()` 直接嵌套进
//    `generate_handler![...]`。
// 因此这里采用「单个 generate_handler + 按模块 concat 的辅助宏」的累加器续传模式：
// 每个模块宏接收 `($builder, [已累积命令 token])`，把本模块命令以 `path,` 形式追加后
// 传给下一个模块宏；最后一个模块宏把纯命令 token 流包进
// `$builder.invoke_handler(tauri::generate_handler![...])` 一次性输出。
//
// 每个模块宏体内保留命令原样的 `#[cfg(windows)]` 条件；命令名/参数/逻辑均未改动，
// 仅做结构整理。可选的 debug 命令 `env::delete_e2e_quote_test_env_var` 由
// `attach_invoke_handler!` 传入，在 env 模块处注入。
macro_rules! shortcuts_commands {
    ($builder:expr, [$($cmd:tt)*] $(, $debug_command:path)?) => {
        env_commands!($builder, [$($cmd)*
            shortcuts::home_show::sync_home_shortcut,
            shortcuts::home_show::sync_show_shortcut,
            shortcuts::screenshot::sync_universal_screenshot_shortcut,
            shortcuts::sticky::sync_sticky_shortcut,
            shortcuts::sticky::sync_single_sticky_shortcut,
            shortcuts::pin_recovery::sync_pin_recovery_shortcut,
            shortcuts::tool::sync_tool_shortcuts,
            shortcuts::pipeline::sync_pipeline_shortcuts,
        ] $(, $debug_command)?)
    };
}

macro_rules! env_commands {
    ($builder:expr, [$($cmd:tt)*] $(, $debug_command:path)?) => {
        screenshot_shared_commands!($builder, [$($cmd)*
            env::get_env_platform_info,
            env::list_env_vars,
            env::get_env_var,
            env::preview_env_write,
            env::preview_env_delete,
            env::apply_env_write,
            $($debug_command,)?
        ])
    };
}

macro_rules! screenshot_shared_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        screenshot_universal_commands!($builder, [$($cmd)*
            screenshot_shared::history::history_get_quota_settings,
            screenshot_shared::history::history_set_quota_settings,
            screenshot_shared::history::history_list_records,
            screenshot_shared::history::grants::history_get_record,
            screenshot_shared::history::grants::history_read_image_token,
            screenshot_shared::history::thumbnail::history_read_thumbnail,
            screenshot_shared::history::save_as::history_save_as,
            screenshot_shared::history::history_create_copy_from_record,
            screenshot_shared::history::history_delete_record,
            screenshot_shared::history::history_undo_delete,
            screenshot_shared::history::history_clear_all,
            screenshot_shared::history::history_reveal_record,
            screenshot_shared::pin::pin_create_from_history,
            screenshot_shared::pin::pin_list,
            screenshot_shared::pin::pin_get_state,
            screenshot_shared::pin::pin_read_image,
            screenshot_shared::pin::pin_set_zoom,
            screenshot_shared::pin::pin_set_opacity,
            screenshot_shared::pin::pin_reset,
            screenshot_shared::pin::pin_set_click_through,
            screenshot_shared::pin::pin_enable_all_interaction,
            screenshot_shared::pin::pin_start_drag,
            screenshot_shared::pin::pin_close,
            screenshot_shared::pin::pin_close_all,
            screenshot_shared::pin::pin_set_rotation,
            screenshot_shared::pin::pin_set_flip,
            screenshot_shared::pin::pin_set_group,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_start,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_next,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_stop,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_finish,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_publish,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_has_result,
            #[cfg(windows)]
            screenshot_shared::scroll_session::scroll_capture_cancel,
        ])
    };
}

macro_rules! screenshot_universal_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        ocr_commands!($builder, [$($cmd)*
            screenshot_universal::screenshot_universal_start,
            screenshot_universal::screenshot_universal_read_frame,
            screenshot_universal::screenshot_universal_cancel,
            screenshot_universal::screenshot_universal_finish,
            screenshot_universal::screenshot_universal_overlay_init,
        ])
    };
}

macro_rules! ocr_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        element_detect_commands!($builder, [$($cmd)*
            ocr::ocr_recognize_png,
        ])
    };
}

macro_rules! element_detect_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        sticky_commands!($builder, [$($cmd)*
            #[cfg(windows)]
            element_detect::element_from_point,
        ])
    };
}

macro_rules! sticky_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        sedentary_commands!($builder, [$($cmd)*
            sticky::sticky_create,
            sticky::sticky_list,
            sticky::sticky_update,
            sticky::sticky_delete,
            sticky::sticky_show_group,
            sticky::sticky_hide_all,
            sticky::sticky_single_toggle,
            sticky::sticky_single_status,
        ])
    };
}

macro_rules! sedentary_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        timer_commands!($builder, [$($cmd)*
            sedentary::sedentary_get_config,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_set_config,
            sedentary::sedentary_get_state,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_remind_action,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_toggle,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_preview,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_set_user_video,
            #[cfg(sedentary_supported)]
            sedentary::sedentary_reset_user_video,
        ])
    };
}

macro_rules! timer_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        pwdbox_commands!($builder, [$($cmd)*
            timer::alarms::timer_get_alarms,
            timer::alarms::timer_add_alarm,
            timer::alarms::timer_update_alarm,
            timer::alarms::timer_delete_alarm,
            timer::countdown::timer_get_countdown,
            timer::countdown::timer_start_countdown,
            timer::countdown::timer_pause_countdown,
            timer::countdown::timer_resume_countdown,
            timer::countdown::timer_cancel_countdown,
            timer::pomodoro::timer_get_pomodoro,
            timer::pomodoro::timer_set_pomodoro_config,
            timer::pomodoro::timer_start_pomodoro,
            timer::pomodoro::timer_pause_pomodoro,
            timer::pomodoro::timer_skip_phase,
            timer::pomodoro::timer_reset_pomodoro,
            timer::presets::timer_get_presets,
            timer::presets::timer_add_preset,
            timer::presets::timer_remove_preset,
            timer::chime::timer_get_chime,
            timer::chime::timer_set_chime,
            timer::history::timer_get_history,
            timer::history::timer_clear_history,
            timer::alert::timer_get_alert,
            timer::alert::timer_alert_action,
        ])
    };
}

macro_rules! pwdbox_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        toast_commands!($builder, [$($cmd)*
            pwdbox::pwdbox_load,
            pwdbox::pwdbox_save,
            pwdbox::pwdbox_authenticate,
            pwdbox::pwdbox_auth_check,
            pwdbox::pwdbox_auth_lock,
            pwdbox::curl_storage_load,
            pwdbox::curl_storage_save,
        ])
    };
}

macro_rules! toast_commands {
    ($builder:expr, [$($cmd:tt)*]) => {
        $builder.invoke_handler(tauri::generate_handler![
            $($cmd)*
            toast::toast_show,
            toast::toast_get,
        ])
    };
}

macro_rules! attach_invoke_handler {
    ($builder:expr $(, $debug_command:path)?) => {
        shortcuts_commands!($builder, [] $(, $debug_command)?)
    };
}

// ---------------------------------------------------------------------------
// tauri-specta 全量类型导出（见 .trellis/tasks/08-12-arch-opt2）
//
// 仅用于类型导出：把所有 `#[tauri::command]` 注册进 specta `Builder` 并导出
// `src/lib/ipc/bindings.ts`。运行时分发仍走上方 `attach_invoke_handler!` 的
// `generate_handler!`——`collect_commands!` 内部也会包一层 `generate_handler!`，
// 但此处不调用 `builder.invoke_handler()`，不会安装第二个 handler，也不与现有
// handler 冲突（同名命令仅被同一 handler 分发一次）。
//
// `collect_commands!` 是 macro_rules，其内部 `collect_functions!` 无法匹配
// `#[cfg(...)]` 属性，因此不能在列表项上直接加 cfg（仅 Windows 的滚动截图/
// 久坐视频命令在非 Windows 平台不存在）。按平台复制列表：
// - Windows：全量命令（含仅 Windows 的滚动截图/久坐视频命令）；
// - 非 Windows：仅全平台命令（不含仅 Windows 命令）。
//
// `env::delete_e2e_quote_test_env_var`（返回 `serde_json::Value`）不收集：specta
// 2.0.0-rc.25 的 `serde_json` feature 在导出该类型时运行时栈溢出（Value 的
// Map/Vec 内联无限递归），且该命令是 debug-only E2E 助手，前端不调用。
// ---------------------------------------------------------------------------

/// 非 Windows：仅全平台命令（不含仅 Windows 的滚动截图/久坐视频命令）。
#[cfg(not(target_os = "windows"))]
macro_rules! specta_commands {
    () => {
        tauri_specta::collect_commands![
            env::get_env_platform_info,
            env::list_env_vars,
            env::get_env_var,
            env::preview_env_write,
            env::preview_env_delete,
            env::apply_env_write,
            // 说明：`env::delete_e2e_quote_test_env_var`（返回 serde_json::Value）不收集——
            // specta 2.0.0-rc.25 的 `serde_json` feature 在导出该类型时运行时栈溢出
            // （Value 的 Map/Vec 内联无限递归），且该命令是 debug-only E2E 助手，前端不用。
            element_detect::element_from_point,
            ocr::ocr_recognize_png,
            pwdbox::pwdbox_load::<tauri::Wry>,
            pwdbox::pwdbox_save::<tauri::Wry>,
            pwdbox::pwdbox_authenticate::<tauri::Wry>,
            pwdbox::pwdbox_auth_check,
            pwdbox::pwdbox_auth_lock,
            pwdbox::curl_storage_load::<tauri::Wry>,
            pwdbox::curl_storage_save::<tauri::Wry>,
            screenshot_shared::history::history_get_quota_settings,
            screenshot_shared::history::history_set_quota_settings,
            screenshot_shared::history::history_list_records,
            screenshot_shared::history::grants::history_get_record,
            screenshot_shared::history::grants::history_read_image_token,
            screenshot_shared::history::thumbnail::history_read_thumbnail,
            screenshot_shared::history::save_as::history_save_as::<tauri::Wry>,
            screenshot_shared::history::history_create_copy_from_record,
            screenshot_shared::history::history_delete_record,
            screenshot_shared::history::history_undo_delete,
            screenshot_shared::history::history_clear_all,
            screenshot_shared::history::history_reveal_record::<tauri::Wry>,
            screenshot_shared::pin::pin_create_from_history::<tauri::Wry>,
            screenshot_shared::pin::pin_list,
            screenshot_shared::pin::pin_get_state,
            screenshot_shared::pin::pin_read_image,
            screenshot_shared::pin::pin_set_zoom::<tauri::Wry>,
            screenshot_shared::pin::pin_set_rotation::<tauri::Wry>,
            screenshot_shared::pin::pin_set_flip::<tauri::Wry>,
            screenshot_shared::pin::pin_set_group::<tauri::Wry>,
            screenshot_shared::pin::pin_set_opacity::<tauri::Wry>,
            screenshot_shared::pin::pin_reset::<tauri::Wry>,
            screenshot_shared::pin::pin_set_click_through::<tauri::Wry>,
            screenshot_shared::pin::pin_enable_all_interaction::<tauri::Wry>,
            screenshot_shared::pin::pin_start_drag::<tauri::Wry>,
            screenshot_shared::pin::pin_close::<tauri::Wry>,
            screenshot_shared::pin::pin_close_all::<tauri::Wry>,
            screenshot_universal::screenshot_universal_start::<tauri::Wry>,
            screenshot_universal::screenshot_universal_read_frame,
            screenshot_universal::screenshot_universal_cancel::<tauri::Wry>,
            screenshot_universal::screenshot_universal_finish::<tauri::Wry>,
            screenshot_universal::screenshot_universal_overlay_init::<tauri::Wry>,
            sedentary::sedentary_get_config::<tauri::Wry>,
            sedentary::sedentary_get_state,
            sticky::sticky_create::<tauri::Wry>,
            sticky::sticky_list::<tauri::Wry>,
            sticky::sticky_update::<tauri::Wry>,
            sticky::sticky_delete::<tauri::Wry>,
            sticky::sticky_show_group::<tauri::Wry>,
            sticky::sticky_hide_all::<tauri::Wry>,
            sticky::sticky_single_toggle::<tauri::Wry>,
            sticky::sticky_single_status::<tauri::Wry>,
            shortcuts::home_show::sync_home_shortcut::<tauri::Wry>,
            shortcuts::home_show::sync_show_shortcut::<tauri::Wry>,
            shortcuts::screenshot::sync_universal_screenshot_shortcut::<tauri::Wry>,
            shortcuts::sticky::sync_sticky_shortcut::<tauri::Wry>,
            shortcuts::sticky::sync_single_sticky_shortcut::<tauri::Wry>,
            shortcuts::pin_recovery::sync_pin_recovery_shortcut::<tauri::Wry>,
            shortcuts::tool::sync_tool_shortcuts::<tauri::Wry>,
            shortcuts::pipeline::sync_pipeline_shortcuts::<tauri::Wry>,
            timer::alarms::timer_get_alarms::<tauri::Wry>,
            timer::alarms::timer_add_alarm::<tauri::Wry>,
            timer::alarms::timer_update_alarm::<tauri::Wry>,
            timer::alarms::timer_delete_alarm::<tauri::Wry>,
            timer::countdown::timer_get_countdown,
            timer::countdown::timer_start_countdown::<tauri::Wry>,
            timer::countdown::timer_pause_countdown::<tauri::Wry>,
            timer::countdown::timer_resume_countdown::<tauri::Wry>,
            timer::countdown::timer_cancel_countdown::<tauri::Wry>,
            timer::pomodoro::timer_get_pomodoro,
            timer::pomodoro::timer_set_pomodoro_config::<tauri::Wry>,
            timer::pomodoro::timer_start_pomodoro::<tauri::Wry>,
            timer::pomodoro::timer_pause_pomodoro::<tauri::Wry>,
            timer::pomodoro::timer_skip_phase::<tauri::Wry>,
            timer::pomodoro::timer_reset_pomodoro::<tauri::Wry>,
            timer::presets::timer_get_presets::<tauri::Wry>,
            timer::presets::timer_add_preset::<tauri::Wry>,
            timer::presets::timer_remove_preset::<tauri::Wry>,
            timer::chime::timer_get_chime,
            timer::chime::timer_set_chime::<tauri::Wry>,
            timer::history::timer_get_history,
            timer::history::timer_clear_history::<tauri::Wry>,
            timer::alert::timer_get_alert,
            timer::alert::timer_alert_action::<tauri::Wry>,
            toast::toast_show::<tauri::Wry>,
            toast::toast_get,
        ]
    };
}

/// Windows：全量命令（含仅 Windows 的滚动截图/久坐视频命令；不含 debug 专用 E2E 命令）。
#[cfg(target_os = "windows")]
macro_rules! specta_commands {
    () => {
        tauri_specta::collect_commands![
            env::get_env_platform_info,
            env::list_env_vars,
            env::get_env_var,
            env::preview_env_write,
            env::preview_env_delete,
            env::apply_env_write,
            // 说明：`env::delete_e2e_quote_test_env_var`（返回 serde_json::Value）不收集——
            // specta 2.0.0-rc.25 的 `serde_json` feature 在导出该类型时运行时栈溢出
            // （Value 的 Map/Vec 内联无限递归），且该命令是 debug-only E2E 助手，前端不用。
            element_detect::element_from_point,
            ocr::ocr_recognize_png,
            pwdbox::pwdbox_load::<tauri::Wry>,
            pwdbox::pwdbox_save::<tauri::Wry>,
            pwdbox::pwdbox_authenticate::<tauri::Wry>,
            pwdbox::pwdbox_auth_check,
            pwdbox::pwdbox_auth_lock,
            pwdbox::curl_storage_load::<tauri::Wry>,
            pwdbox::curl_storage_save::<tauri::Wry>,
            screenshot_shared::history::history_get_quota_settings,
            screenshot_shared::history::history_set_quota_settings,
            screenshot_shared::history::history_list_records,
            screenshot_shared::history::grants::history_get_record,
            screenshot_shared::history::grants::history_read_image_token,
            screenshot_shared::history::thumbnail::history_read_thumbnail,
            screenshot_shared::history::save_as::history_save_as::<tauri::Wry>,
            screenshot_shared::history::history_create_copy_from_record,
            screenshot_shared::history::history_delete_record,
            screenshot_shared::history::history_undo_delete,
            screenshot_shared::history::history_clear_all,
            screenshot_shared::history::history_reveal_record::<tauri::Wry>,
            screenshot_shared::pin::pin_create_from_history::<tauri::Wry>,
            screenshot_shared::pin::pin_list,
            screenshot_shared::pin::pin_get_state,
            screenshot_shared::pin::pin_read_image,
            screenshot_shared::pin::pin_set_zoom::<tauri::Wry>,
            screenshot_shared::pin::pin_set_rotation::<tauri::Wry>,
            screenshot_shared::pin::pin_set_flip::<tauri::Wry>,
            screenshot_shared::pin::pin_set_group::<tauri::Wry>,
            screenshot_shared::pin::pin_set_opacity::<tauri::Wry>,
            screenshot_shared::pin::pin_reset::<tauri::Wry>,
            screenshot_shared::pin::pin_set_click_through::<tauri::Wry>,
            screenshot_shared::pin::pin_enable_all_interaction::<tauri::Wry>,
            screenshot_shared::pin::pin_start_drag::<tauri::Wry>,
            screenshot_shared::pin::pin_close::<tauri::Wry>,
            screenshot_shared::pin::pin_close_all::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_start::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_next::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_stop::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_finish::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_publish::<tauri::Wry>,
            screenshot_shared::scroll_session::scroll_capture_has_result,
            screenshot_shared::scroll_session::scroll_capture_cancel::<tauri::Wry>,
            screenshot_universal::screenshot_universal_start::<tauri::Wry>,
            screenshot_universal::screenshot_universal_read_frame,
            screenshot_universal::screenshot_universal_cancel::<tauri::Wry>,
            screenshot_universal::screenshot_universal_finish::<tauri::Wry>,
            screenshot_universal::screenshot_universal_overlay_init::<tauri::Wry>,
            sedentary::sedentary_get_config::<tauri::Wry>,
            sedentary::sedentary_set_config::<tauri::Wry>,
            sedentary::sedentary_get_state,
            sedentary::sedentary_remind_action::<tauri::Wry>,
            sedentary::sedentary_toggle::<tauri::Wry>,
            sedentary::sedentary_preview::<tauri::Wry>,
            sedentary::sedentary_set_user_video::<tauri::Wry>,
            sedentary::sedentary_reset_user_video::<tauri::Wry>,
            sticky::sticky_create::<tauri::Wry>,
            sticky::sticky_list::<tauri::Wry>,
            sticky::sticky_update::<tauri::Wry>,
            sticky::sticky_delete::<tauri::Wry>,
            sticky::sticky_show_group::<tauri::Wry>,
            sticky::sticky_hide_all::<tauri::Wry>,
            sticky::sticky_single_toggle::<tauri::Wry>,
            sticky::sticky_single_status::<tauri::Wry>,
            shortcuts::home_show::sync_home_shortcut::<tauri::Wry>,
            shortcuts::home_show::sync_show_shortcut::<tauri::Wry>,
            shortcuts::screenshot::sync_universal_screenshot_shortcut::<tauri::Wry>,
            shortcuts::sticky::sync_sticky_shortcut::<tauri::Wry>,
            shortcuts::sticky::sync_single_sticky_shortcut::<tauri::Wry>,
            shortcuts::pin_recovery::sync_pin_recovery_shortcut::<tauri::Wry>,
            shortcuts::tool::sync_tool_shortcuts::<tauri::Wry>,
            shortcuts::pipeline::sync_pipeline_shortcuts::<tauri::Wry>,
            timer::alarms::timer_get_alarms::<tauri::Wry>,
            timer::alarms::timer_add_alarm::<tauri::Wry>,
            timer::alarms::timer_update_alarm::<tauri::Wry>,
            timer::alarms::timer_delete_alarm::<tauri::Wry>,
            timer::countdown::timer_get_countdown,
            timer::countdown::timer_start_countdown::<tauri::Wry>,
            timer::countdown::timer_pause_countdown::<tauri::Wry>,
            timer::countdown::timer_resume_countdown::<tauri::Wry>,
            timer::countdown::timer_cancel_countdown::<tauri::Wry>,
            timer::pomodoro::timer_get_pomodoro,
            timer::pomodoro::timer_set_pomodoro_config::<tauri::Wry>,
            timer::pomodoro::timer_start_pomodoro::<tauri::Wry>,
            timer::pomodoro::timer_pause_pomodoro::<tauri::Wry>,
            timer::pomodoro::timer_skip_phase::<tauri::Wry>,
            timer::pomodoro::timer_reset_pomodoro::<tauri::Wry>,
            timer::presets::timer_get_presets::<tauri::Wry>,
            timer::presets::timer_add_preset::<tauri::Wry>,
            timer::presets::timer_remove_preset::<tauri::Wry>,
            timer::chime::timer_get_chime,
            timer::chime::timer_set_chime::<tauri::Wry>,
            timer::history::timer_get_history,
            timer::history::timer_clear_history::<tauri::Wry>,
            timer::alert::timer_get_alert,
            timer::alert::timer_alert_action::<tauri::Wry>,
            toast::toast_show::<tauri::Wry>,
            toast::toast_get,
        ]
    };
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    // `dangerously_cast_bigints_to_number`：仓库大量 DTO 用 u64/usize（JSON 传输为
    // number），specta-typescript 默认禁止 BigInt 类型导出以免精度丢失；前端类型本就
    // 按 number 声明（见手写 `src/lib/ipc/*.ts`），故显式放行保持一致。
    tauri_specta::Builder::<tauri::Wry>::new()
        .dangerously_cast_bigints_to_number()
        .commands(specta_commands!())
}

/// 导出 TS 绑定到前端 `src/lib/ipc/bindings.ts`（路径以 CARGO_MANIFEST_DIR 为基准，避免依赖 CWD）。
///
/// 调用场景：
/// - 应用 `setup`（debug 构建）自动导出；
/// - `tests/specta_bindings.rs` 集成测试可手动刷新（该测试目标经 build.rs 嵌入
///   comctl32 v6 manifest，能链接 tauri 运行时并启动）。
pub fn export_specta_bindings() -> Result<(), Box<dyn std::error::Error>> {
    let out_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/ipc/bindings.ts");
    specta_builder().export(specta_typescript::Typescript::default(), out_path)?;
    Ok(())
}


#[cfg(debug_assertions)]
pub(crate) fn log_to_test_file(message: &str) {
    println!("[Rust] {}", message);
}

#[cfg(not(debug_assertions))]
pub(crate) fn log_to_test_file(_message: &str) {}

pub(crate) use tray::refresh_pin_tray;

/// 主窗口尺寸自适应：把配置里的默认尺寸夹到当前显示器工作区以内，并居中。
///
/// 背景：`tauri.conf.json` 只能写死一个默认尺寸（1600x800）。在小屏设备上
/// （如 13" MacBook 缩放后逻辑分辨率仅 1470x956）该尺寸超出屏幕宽度，窗口
/// 左右两侧会被裁掉且无法通过拖动完全看到，首次启动体验直接不可用。
///
/// 这里在 setup 阶段按真实工作区（`work_area()` 已扣除菜单栏 / Dock / 任务栏）
/// 重新计算：宽高各留 `SCREEN_MARGIN_RATIO` 的边距上限，超出才收缩，小屏收缩、
/// 大屏保持配置值不变；随后居中。多显示器 / 缩放比例变化均由工作区数据覆盖。
///
/// 失败（读不到显示器）时静默跳过，沿用配置尺寸，不阻断启动。
fn fit_main_window_to_screen(app: &tauri::App) {
    /// 窗口最多占用工作区的比例，留出边距避免贴边。
    const SCREEN_MARGIN_RATIO: f64 = 0.9;
    /// 收缩下限（逻辑像素）：低于此值布局会破形，宁可让窗口贴边也不再缩。
    const MIN_W: f64 = 900.0;
    const MIN_H: f64 = 600.0;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // current_monitor 在窗口尚未显示时可能为 None，回退到主显示器。
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return;
    };

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    // work_area 是物理像素，窗口尺寸用逻辑像素，需按缩放比换算。
    let avail_w = work_area.size.width as f64 / scale;
    let avail_h = work_area.size.height as f64 / scale;

    let Ok(current) = window.outer_size() else {
        return;
    };
    let cur_w = current.width as f64 / scale;
    let cur_h = current.height as f64 / scale;

    let target_w = cur_w.min(avail_w * SCREEN_MARGIN_RATIO).max(MIN_W.min(avail_w));
    let target_h = cur_h.min(avail_h * SCREEN_MARGIN_RATIO).max(MIN_H.min(avail_h));

    // 只在确实需要收缩时才改尺寸，避免大屏上无谓的 resize。
    let shrink = target_w < cur_w - 1.0 || target_h < cur_h - 1.0;
    if shrink {
        let _ = window.set_size(tauri::LogicalSize::new(target_w, target_h));
    }

    // 这里不能用 `window.center()`：macOS 上 `set_size` 是异步派发到主队列执行的
    // （tao `set_content_size_async`），`center()` 紧接着执行时读到的仍是收缩「前」
    // 的旧尺寸，会把窗口按 1600 宽居中（x 为负），随后尺寸才缩小 —— 结果窗口整体
    // 偏左、左侧超出屏幕。改为用「目标尺寸」自行计算居中位置并显式设置，
    // 结果不依赖 set_size 何时真正生效。
    let work_x = work_area.position.x as f64 / scale;
    let work_y = work_area.position.y as f64 / scale;
    let pos_x = work_x + (avail_w - target_w).max(0.0) / 2.0;
    let pos_y = work_y + (avail_h - target_h).max(0.0) / 2.0;
    let _ = window.set_position(tauri::LogicalPosition::new(pos_x, pos_y));

    // 显示器相关的几何计算跨设备差异大（缩放比 / 多屏 / Dock 位置），
    // 留一条日志便于排查「窗口尺寸不对」类问题。
    log::info!(
        "[window-fit] 工作区 {:.0}x{:.0} @({:.0},{:.0}) scale {:.2}，窗口 {:.0}x{:.0} -> {:.0}x{:.0}{}，定位 ({:.0},{:.0})",
        avail_w,
        avail_h,
        work_x,
        work_y,
        scale,
        cur_w,
        cur_h,
        target_w,
        target_h,
        if shrink { "，已收缩" } else { "，无需收缩" },
        pos_x,
        pos_y
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = crate::screenshot_universal::register_frame_image_protocol(
        crate::screenshot_shared::pin::register_image_protocol(tauri::Builder::default()),
    );
    // 滚动截图会话（`scroll-image://` 协议）仅 Windows 实现，见
    // `screenshot_shared/mod.rs` 的 `#[cfg(windows)] pub mod scroll_session;`。
    #[cfg(windows)]
    let builder = crate::screenshot_shared::scroll_session::register_scroll_image_protocol(builder);
    let builder = builder
    // Initialize plugins
        // 日志：stdout + LogDir 下的 open-toolbox.log，5MB 大小轮转。
        // 依据 tauri-plugin-log 2.8：Builder::max_file_size(u128) 设置轮转上限；
        // targets([...]) 替换默认 targets（默认是 Stdout + LogDir{file_name: None}），
        // 改为显式命名文件避免默认时间戳文件与命名文件并存。
        .plugin(
            tauri_plugin_log::Builder::default()
                .max_file_size(5 * 1024 * 1024)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("open-toolbox.log".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log_to_test_file("Single instance prevented duplicate launch");
            crate::tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            crate::screenshot_shared::set_app_handle(app.handle().clone());
            fit_main_window_to_screen(app);
            // dev 构建（控制台子系统）按 Ctrl+C 时默认会硬杀进程，残留托盘幽灵图标；
            // 安装控制台处理器改为优雅退出，让托盘图标在退出路径上被销毁。
            #[cfg(all(debug_assertions, windows))]
            console_shutdown::install_graceful_shutdown();
            crate::screenshot_shared::history::initialize(app)?;
            app.manage(crate::screenshot_shared::pin::initialize(app.handle()));
            // OCR 引擎状态：引擎实例首次识别时初始化并缓存；tessdata 目录动态解析。
            app.manage(crate::ocr::OcrState::new());
            // 便利贴状态。
            app.manage(crate::sticky::StickyState::new());
            crate::sedentary::initialize(app)?;
            crate::timer::initialize(app)?;
            crate::toast::initialize(app)?;
            crate::shortcuts::initialize(app)?;
            crate::env::initialize(app)?;
            crate::tray::create_quicklaunch_window(app)?;
            #[cfg(debug_assertions)]
            if let Err(e) = export_specta_bindings() {
                log::error!("[specta] 导出 TS 绑定失败: {e}");
            }
            log_to_test_file("Global shortcut registration managed by Rust sync interface");
            Ok(crate::tray::setup_tray(app)?)
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Only the main window hides to tray. Pin windows are destroyed.
                    if window.label() == "main" {
                        let _ = window.hide();
                        api.prevent_close();
                    } else if window.label().starts_with("pin-") {
                        crate::screenshot_shared::pin::cleanup_window_label(window.label());
                    } else {
                        // 悬浮面板（快捷唤起 / 久坐提醒）在 macOS 上被改类成了 NSPanel
                        // 子类，销毁前必须还原原类，否则 webview 注销 KVO 观察者时崩溃。
                        // 未改类过的窗口为空操作，故可无差别调用。
                        crate::macos_overlay::restore_window_class(window);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    crate::screenshot_shared::pin::cleanup_window_label(window.label());
                }
                _ => {}
            }
        });

    #[cfg(all(debug_assertions, target_os = "windows"))]
    let builder = attach_invoke_handler!(builder, env::delete_e2e_quote_test_env_var);

    #[cfg(not(all(debug_assertions, target_os = "windows")))]
    let builder = attach_invoke_handler!(builder);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS：主窗口关闭后是隐藏到托盘（见上面的 CloseRequested 分支），此时点击
        // Dock 图标不会自动重建窗口，AppKit 只派发 applicationShouldHandleReopen。
        // 不处理该事件的话，用户点 Dock 图标毫无反应（应用已激活、菜单栏已切换，
        // 但窗口始终不出现）。这里复用托盘的唤起逻辑，与托盘点击行为保持一致。
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = _event
        {
            if !has_visible_windows {
                crate::tray::show_main_window(_app_handle);
            }
        }
    });
}
