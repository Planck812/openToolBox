//! 环境变量管理工具模块（拆分子模块后的聚合入口）。
//!
//! 数据模型集中在 `models`，平台实现按 `windows` / `unix` 拆分为独立文件，
//! Tauri 命令 handler 集中在 `commands`。本模块负责声明子模块、`pub use`
//! re-export 对外符号，并保留跨模块共享的小型辅助函数与启动初始化钩子。

mod commands;
mod models;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod unix;

#[cfg(test)]
mod tests;

pub use models::{
    ENV_PREVIEW_TTL, ApplyEnvWriteRequest, EnvCommandError, EnvPlatformInfo, EnvPreviewState,
    EnvTargetInfo, EnvTargetPreview, EnvVariable, EnvWritePreview, GetEnvResult, ListEnvResult,
    PreviewEnvDeleteRequest, PreviewEnvWriteRequest, SetEnvResult,
};
pub(crate) use models::{PendingOperation, PendingPreview, PendingTargetWrite};

// 命令跨模块 re-export 时，`generate_handler!` 按定义模块（commands）解析 `__cmd__<name>`
// 宏路径，因此命令宏与命令函数必须一并 re-export，lib.rs 的 `env::<cmd>` 路径才可解析。
#[allow(unused_imports)]
pub use commands::{
    apply_env_write, get_env_platform_info, get_env_var, list_env_vars, preview_env_delete,
    preview_env_write,
};
#[allow(unused_imports)]
pub use commands::{
    __cmd__apply_env_write, __cmd__get_env_platform_info, __cmd__get_env_var,
    __cmd__list_env_vars, __cmd__preview_env_delete, __cmd__preview_env_write,
    __specta__fn__apply_env_write, __specta__fn__get_env_platform_info,
    __specta__fn__get_env_var, __specta__fn__list_env_vars, __specta__fn__preview_env_delete,
    __specta__fn__preview_env_write,
};
#[cfg(all(debug_assertions, target_os = "windows"))]
#[allow(unused_imports)]
pub use commands::{delete_e2e_quote_test_env_var, __cmd__delete_e2e_quote_test_env_var};

pub(crate) fn validate_env_key(key: &str) -> Result<String, EnvCommandError> {
    let key = key.trim();
    let mut chars = key.chars();
    let valid_first = chars
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic());
    let valid_rest = chars.all(|character| character == '_' || character.is_ascii_alphanumeric());

    if !valid_first || !valid_rest {
        return Err(EnvCommandError {
            code: "invalid_key".into(),
            message: "KEY 无效：需符合 [A-Za-z_][A-Za-z0-9_]*".into(),
        });
    }

    Ok(key.to_string())
}

fn normalize_preview_request(
    mut request: PreviewEnvWriteRequest,
) -> Result<PreviewEnvWriteRequest, EnvCommandError> {
    request.key = validate_env_key(&request.key)?;
    Ok(request)
}

fn unsupported<T>() -> Result<T, EnvCommandError> {
    Err(EnvCommandError::unsupported_platform())
}

use tauri::Manager;

/// 应用启动时初始化环境变量预览状态。
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    app.manage(EnvPreviewState::default());
    Ok(())
}
