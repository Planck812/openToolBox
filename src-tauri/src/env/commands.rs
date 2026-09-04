use tauri::State;

use super::{
    normalize_preview_request, unsupported, validate_env_key, ApplyEnvWriteRequest,
    EnvCommandError, EnvPlatformInfo, EnvPreviewState, EnvWritePreview, GetEnvResult,
    ListEnvResult, PreviewEnvDeleteRequest, PreviewEnvWriteRequest, SetEnvResult,
};
#[cfg(target_os = "windows")]
use super::windows;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use super::unix;

#[tauri::command]
#[specta::specta]
pub fn get_env_platform_info() -> Result<EnvPlatformInfo, EnvCommandError> {
    #[cfg(target_os = "windows")]
    return windows::platform_info();

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::platform_info();

    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
#[specta::specta]
pub fn list_env_vars() -> Result<ListEnvResult, EnvCommandError> {
    #[cfg(target_os = "windows")]
    return windows::list();

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::list();

    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
#[specta::specta]
pub fn get_env_var(key: String) -> Result<GetEnvResult, EnvCommandError> {
    let key = validate_env_key(&key)?;

    #[cfg(target_os = "windows")]
    return windows::get(key);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::get(key);

    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
#[specta::specta]
pub fn preview_env_write(
    state: State<'_, EnvPreviewState>,
    request: PreviewEnvWriteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    let request = normalize_preview_request(request)?;

    #[cfg(target_os = "windows")]
    return windows::preview(&state, request);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::preview(&state, request);

    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
#[specta::specta]
pub fn preview_env_delete(
    state: State<'_, EnvPreviewState>,
    request: PreviewEnvDeleteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    let request = PreviewEnvDeleteRequest {
        key: validate_env_key(&request.key)?,
    };

    #[cfg(target_os = "windows")]
    return windows::preview_delete(&state, request);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::preview_delete(&state, request);

    #[allow(unreachable_code)]
    unsupported()
}

#[tauri::command]
#[specta::specta]
pub fn apply_env_write(
    state: State<'_, EnvPreviewState>,
    request: ApplyEnvWriteRequest,
) -> Result<SetEnvResult, EnvCommandError> {
    #[cfg(target_os = "windows")]
    return windows::apply(&state, request);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return unix::apply(&state, request);

    #[allow(unreachable_code)]
    unsupported()
}

/// 删除用于 E2E 引号测试的专用临时变量 `OPEN_TOOLBOX_E2E_QUOTE_TEST`，
/// 并返回 `{ exists: bool }` 表示删除后变量是否仍存在。
///
/// 仅 Debug 模式 + Windows 下编译，由 E2E 测试框架调用。
#[cfg(all(debug_assertions, target_os = "windows"))]
#[tauri::command]
pub fn delete_e2e_quote_test_env_var() -> Result<serde_json::Value, EnvCommandError> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const TEST_KEY: &str = "OPEN_TOOLBOX_E2E_QUOTE_TEST";

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env_key = match hkcu.open_subkey_with_flags(
        "Environment",
        winreg::enums::KEY_SET_VALUE | winreg::enums::KEY_QUERY_VALUE,
    ) {
        Ok(k) => k,
        Err(_) => {
            // 打不开注册表 → 变量不存在
            return Ok(serde_json::json!({ "exists": false }));
        }
    };

    // 删除前检查是否存在
    let existed = env_key.get_raw_value(TEST_KEY).is_ok();

    if existed {
        let _ = env_key.delete_value(TEST_KEY);
    }

    // 删除后确认
    let still_exists = env_key.get_raw_value(TEST_KEY).is_ok();

    Ok(serde_json::json!({ "exists": still_exists }))
}
