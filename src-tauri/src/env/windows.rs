use std::borrow::Cow;
use std::time::SystemTime;

use sha2::{Digest, Sha256};
use uuid::Uuid;
use winreg::enums::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_EXPAND_SZ,
    REG_SZ,
};
use winreg::types::FromRegValue;
use winreg::{RegKey, RegValue};

use super::*;

const USER_ENV_PATH: &str = "Environment";
const SYSTEM_ENV_PATH: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
const USER_TARGET_ID: &str = "user";
const USER_TARGET_LABEL: &str = r"HKCU\Environment";

fn command_error(code: &str, message: impl Into<String>) -> EnvCommandError {
    EnvCommandError {
        code: code.into(),
        message: message.into(),
    }
}

fn registry_error(action: &str, error: std::io::Error) -> EnvCommandError {
    command_error("registry_error", format!("{action}失败：{error}"))
}

fn open_user_read() -> Result<Option<RegKey>, EnvCommandError> {
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(USER_ENV_PATH, KEY_QUERY_VALUE)
    {
        Ok(key) => Ok(Some(key)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(registry_error("读取用户环境变量", error)),
    }
}

fn open_user_write() -> Result<RegKey, EnvCommandError> {
    let root = RegKey::predef(HKEY_CURRENT_USER);
    match root.open_subkey_with_flags(USER_ENV_PATH, KEY_QUERY_VALUE | KEY_SET_VALUE) {
        Ok(key) => Ok(key),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => root
            .create_subkey(USER_ENV_PATH)
            .map(|(key, _)| key)
            .map_err(|error| registry_error("创建用户环境变量注册表项", error)),
        Err(error) => Err(registry_error("打开用户环境变量注册表项", error)),
    }
}

fn raw_string(value: &RegValue<'_>) -> Option<(String, &'static str)> {
    let value_type = match value.vtype {
        REG_SZ => "REG_SZ",
        REG_EXPAND_SZ => "REG_EXPAND_SZ",
        _ => return None,
    };
    let value = String::from_reg_value(value).ok()?;
    Some((value, value_type))
}

fn variable(
    key: String,
    value: &RegValue<'_>,
    scope: &str,
    source_label: &str,
    writable: bool,
) -> Option<EnvVariable> {
    let (value, value_type) = raw_string(value)?;
    Some(EnvVariable {
        key,
        value,
        value_type: value_type.into(),
        scope: scope.into(),
        source_label: source_label.into(),
        writable,
    })
}

fn enumerate(
    key: &RegKey,
    scope: &str,
    source_label: &str,
    writable: bool,
) -> Result<Vec<EnvVariable>, EnvCommandError> {
    let mut variables = Vec::new();
    for item in key.enum_values() {
        let (name, value) = item.map_err(|error| registry_error("枚举环境变量", error))?;
        if let Some(variable) = variable(name, &value, scope, source_label, writable) {
            variables.push(variable);
        }
    }
    Ok(variables)
}

fn hash_raw(value: Option<&RegValue<'_>>) -> String {
    let mut hasher = Sha256::new();
    match value {
        Some(value) => {
            hasher.update(b"present\0");
            hasher.update(format!("{:?}\0", value.vtype).as_bytes());
            hasher.update(value.bytes.as_ref());
        }
        None => hasher.update(b"absent\0"),
    }
    format!("{:x}", hasher.finalize())
}

fn encode_string(value: &str, value_type: &str) -> RegValue<'static> {
    let bytes: Vec<u8> = value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    RegValue {
        bytes: Cow::Owned(bytes),
        vtype: if value_type == "REG_EXPAND_SZ" {
            REG_EXPAND_SZ
        } else {
            REG_SZ
        },
    }
}

/// 判断值是否含 `%VAR%` 形式的展开引用（用于把 REG_SZ 提升为 REG_EXPAND_SZ）。
fn contains_env_ref(value: &str) -> bool {
    let bytes = value.as_bytes();
    let Some(first) = bytes.iter().position(|&b| b == b'%') else {
        return false;
    };
    bytes[first + 1..].contains(&b'%')
}

fn read_raw(
    key: &RegKey,
    name: &str,
    label: &str,
) -> Result<Option<RegValue<'static>>, EnvCommandError> {
    match key.get_raw_value(name) {
        Ok(value) => Ok(Some(RegValue {
            bytes: Cow::Owned(value.bytes.into_owned()),
            vtype: value.vtype,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(registry_error(&format!("读取{label}环境变量"), error)),
    }
}

fn purge_expired_previews(state: &EnvPreviewState) -> Result<(), EnvCommandError> {
    let now = SystemTime::now();
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| command_error("preview_unavailable", "环境变量预览服务不可用"))?;
    previews.retain(|_, preview| {
        now.duration_since(preview.created_at)
            .is_ok_and(|age| age <= ENV_PREVIEW_TTL)
    });
    Ok(())
}

fn broadcast_environment_change() {
    use ::windows::core::w;
    use ::windows::Win32::Foundation::{LPARAM, WPARAM};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(w!("Environment").0 as isize),
            SMTO_ABORTIFHUNG,
            250,
            None,
        );
    }
}

fn broadcast_environment_change_in_background() {
    // HWND_BROADCAST 的超时会按顶层窗口分别计算，不能阻塞当前 IPC 请求。
    let _ = std::thread::Builder::new()
        .name("environment-change-broadcast".into())
        .spawn(broadcast_environment_change);
}

pub(super) fn platform_info() -> Result<EnvPlatformInfo, EnvCommandError> {
    Ok(EnvPlatformInfo {
        platform: "windows".into(),
        supports_direct_write: true,
        available_targets: vec![EnvTargetInfo {
            id: USER_TARGET_ID.into(),
            path: USER_TARGET_LABEL.into(),
            exists: open_user_read()?.is_some(),
            recommended: true,
        }],
    })
}

pub(super) fn list() -> Result<ListEnvResult, EnvCommandError> {
    let mut variables = match open_user_read()? {
        Some(user_key) => enumerate(&user_key, "user", "用户", true)?,
        None => Vec::new(),
    };

    // 系统键读取失败时降级为只返回用户变量（不因系统键不可用而全有全无）。
    let mut warnings = Vec::new();
    match RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(SYSTEM_ENV_PATH, KEY_QUERY_VALUE)
    {
        Ok(system_key) => match enumerate(&system_key, "system", "系统", false) {
            Ok(system_variables) => variables.extend(system_variables),
            Err(error) => warnings.push(format!("系统环境变量读取失败，已忽略：{error}")),
        },
        Err(error) => warnings.push(format!("系统环境变量读取失败，已忽略：{error}")),
    }
    variables.sort_by(|left, right| {
        left.key
            .to_ascii_lowercase()
            .cmp(&right.key.to_ascii_lowercase())
            .then_with(|| left.scope.cmp(&right.scope))
    });

    Ok(ListEnvResult {
        ok: true,
        message: format!("已读取 {} 个环境变量", variables.len()),
        variables,
        warnings,
    })
}

pub(super) fn get(key: String) -> Result<GetEnvResult, EnvCommandError> {
    // 与 list() 一致：先读用户作用域，未命中回退系统作用域（系统值只读）。
    let user_raw = match open_user_read()? {
        Some(user_key) => read_raw(&user_key, &key, "用户")?,
        None => None,
    };
    if let Some(raw) = user_raw {
        let variable = variable(key.clone(), &raw, "user", "用户", true);
        let value = variable.as_ref().map(|item| item.value.clone());
        return Ok(GetEnvResult {
            ok: true,
            message: "已读取当前用户值".into(),
            value,
            variable,
        });
    }

    let system_raw = match RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(SYSTEM_ENV_PATH, KEY_QUERY_VALUE)
    {
        Ok(system_key) => read_raw(&system_key, &key, "系统")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(registry_error("读取系统环境变量", error)),
    };
    let variable =
        system_raw
            .as_ref()
            .and_then(|value| variable(key.clone(), value, "system", "系统", false));
    let value = variable.as_ref().map(|item| item.value.clone());
    Ok(GetEnvResult {
        ok: true,
        message: if value.is_some() {
            "已读取系统值".into()
        } else {
            "当前用户与系统均未设置该变量".into()
        },
        value,
        variable,
    })
}

pub(super) fn preview(
    state: &EnvPreviewState,
    request: PreviewEnvWriteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    if request.value.contains('\0') {
        return Err(command_error(
            "invalid_value",
            "环境变量值不能包含 NUL 字符",
        ));
    }
    if !request.targets.is_empty()
        && request
            .targets
            .iter()
            .any(|target| target != USER_TARGET_ID)
    {
        return Err(command_error(
            "invalid_target",
            "Windows 仅支持写入用户环境变量",
        ));
    }
    purge_expired_previews(state)?;

    let user_key = open_user_write()?;
    let original = read_raw(&user_key, &request.key, "用户")?;
    let original_type = original
        .as_ref()
        .and_then(raw_string)
        .map(|(_, value_type)| value_type)
        .unwrap_or("REG_SZ");
    let updated = encode_string(&request.value, original_type);
    let action = if original.is_some() { "replace" } else { "add" };
    let before_lines = original
        .as_ref()
        .and_then(raw_string)
        .map(|(value, _)| vec![format!("{}={value}", request.key)])
        .unwrap_or_default();
    let after_lines = vec![format!("{}={}", request.key, request.value)];
    let original_hash = hash_raw(original.as_ref());
    let preview_id = Uuid::new_v4().to_string();

    let pending = PendingPreview {
        key: request.key.clone(),
        value: request.value.clone(),
        operation: PendingOperation::Write,
        targets: vec![PendingTargetWrite {
            id: USER_TARGET_ID.into(),
            path: USER_TARGET_LABEL.into(),
            original_hash: original_hash.clone(),
            original_content: original
                .as_ref()
                .map_or_else(Vec::new, |value| value.bytes.to_vec()),
            updated_content: updated.bytes.to_vec(),
            existed: original.is_some(),
        }],
        created_at: SystemTime::now(),
    };
    state
        .previews
        .lock()
        .map_err(|_| command_error("preview_unavailable", "环境变量预览服务不可用"))?
        .insert(preview_id.clone(), pending);

    Ok(EnvWritePreview {
        preview_id,
        requires_confirmation: false,
        targets: vec![EnvTargetPreview {
            id: USER_TARGET_ID.into(),
            path: USER_TARGET_LABEL.into(),
            exists: original.is_some(),
            action: action.into(),
            before_lines: before_lines.clone(),
            after_lines: after_lines.clone(),
            diff: format!(
                "- {}\n+ {}",
                before_lines
                    .first()
                    .map(String::as_str)
                    .unwrap_or("<未设置>"),
                after_lines[0]
            ),
            hash: original_hash,
            warnings: Vec::new(),
        }],
        warnings: vec!["新启动的进程才会读取到新值，当前应用不会自动继承。".into()],
    })
}

pub(super) fn preview_delete(
    state: &EnvPreviewState,
    request: PreviewEnvDeleteRequest,
) -> Result<EnvWritePreview, EnvCommandError> {
    purge_expired_previews(state)?;
    let user_key = open_user_read()?
        .ok_or_else(|| command_error("variable_missing", "用户环境中不存在该变量，无法删除"))?;
    let original = read_raw(&user_key, &request.key, "用户")?
        .ok_or_else(|| command_error("variable_missing", "用户环境中不存在该变量，无法删除"))?;
    let (value, _) = raw_string(&original)
        .ok_or_else(|| command_error("unsupported_value_type", "该变量类型不支持删除"))?;
    let before_line = format!("{}={value}", request.key);
    let original_hash = hash_raw(Some(&original));
    let preview_id = Uuid::new_v4().to_string();

    state
        .previews
        .lock()
        .map_err(|_| command_error("preview_unavailable", "环境变量预览服务不可用"))?
        .insert(
            preview_id.clone(),
            PendingPreview {
                key: request.key.clone(),
                value: String::new(),
                operation: PendingOperation::Delete,
                targets: vec![PendingTargetWrite {
                    id: USER_TARGET_ID.into(),
                    path: USER_TARGET_LABEL.into(),
                    original_hash: original_hash.clone(),
                    original_content: original.bytes.to_vec(),
                    updated_content: Vec::new(),
                    existed: true,
                }],
                created_at: SystemTime::now(),
            },
        );

    Ok(EnvWritePreview {
        preview_id,
        requires_confirmation: true,
        targets: vec![EnvTargetPreview {
            id: USER_TARGET_ID.into(),
            path: USER_TARGET_LABEL.into(),
            exists: true,
            action: "delete".into(),
            before_lines: vec![before_line.clone()],
            after_lines: Vec::new(),
            diff: format!("- {before_line}"),
            hash: original_hash,
            warnings: vec!["删除后只能通过重新写入恢复，请确认变量名和值。".into()],
        }],
        warnings: vec!["删除用户环境变量不会影响同名系统环境变量。".into()],
    })
}

pub(super) fn apply(
    state: &EnvPreviewState,
    request: ApplyEnvWriteRequest,
) -> Result<SetEnvResult, EnvCommandError> {
    // 先取预览但不移除：写入失败时保留预览，避免 preview_id 被烧毁。
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| command_error("preview_unavailable", "环境变量预览服务不可用"))?;
    let pending = previews
        .get(&request.preview_id)
        .ok_or_else(|| command_error("preview_stale", "预览不存在或已失效，请重新生成"))?;
    if SystemTime::now()
        .duration_since(pending.created_at)
        .map_or(true, |age| age > ENV_PREVIEW_TTL)
    {
        return Err(command_error("preview_stale", "预览已过期，请重新生成"));
    }

    let target = pending
        .targets
        .first()
        .ok_or_else(|| command_error("preview_invalid", "预览没有可写目标"))?;
    let user_key = open_user_write()?;
    let current = read_raw(&user_key, &pending.key, "用户")?;
    if hash_raw(current.as_ref()) != target.original_hash {
        return Err(command_error(
            "preview_stale",
            "环境变量已被其他进程修改，请重新读取后再写入",
        ));
    }

    let result = match pending.operation {
        PendingOperation::Write => {
            // 写值类型：值含 `%...%` 时自动提升为 REG_EXPAND_SZ，否则继承现有类型。
            let value_type = if contains_env_ref(&pending.value) {
                "REG_EXPAND_SZ"
            } else {
                current
                    .as_ref()
                    .and_then(raw_string)
                    .map(|(_, value_type)| value_type)
                    .unwrap_or("REG_SZ")
            };
            let updated = encode_string(&pending.value, value_type);
            user_key
                .set_raw_value(&pending.key, &updated)
                .map_err(|error| registry_error("写入用户环境变量", error))?;
            SetEnvResult {
                ok: true,
                message: format!("已写入用户环境变量 {}", pending.key),
                warnings: vec!["新启动的终端和进程才会读取到新值。".into()],
            }
        }
        PendingOperation::Delete => {
            if current.is_none() {
                return Err(command_error(
                    "preview_stale",
                    "环境变量已不存在，请刷新列表",
                ));
            }
            user_key
                .delete_value(&pending.key)
                .map_err(|error| registry_error("删除用户环境变量", error))?;
            SetEnvResult {
                ok: true,
                message: format!("已删除用户环境变量 {}", pending.key),
                warnings: vec!["新启动的终端和进程将不再继承该用户变量。".into()],
            }
        }
    };

    // 写入成功后才移除预览。
    previews.remove(&request.preview_id);
    drop(previews);
    broadcast_environment_change_in_background();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_reports_windows_direct_write() {
        let info = platform_info().expect("platform info");
        assert_eq!(info.platform, "windows");
        assert!(info.supports_direct_write);
        assert_eq!(info.available_targets[0].id, USER_TARGET_ID);
    }

    #[test]
    fn registry_string_encoding_is_utf16_nul_terminated() {
        let raw = encode_string("A中", "REG_SZ");
        assert_eq!(raw.vtype, REG_SZ);
        let units: Vec<u16> = raw
            .bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(units, vec!['A' as u16, '中' as u16, 0]);
    }

    #[test]
    fn registry_string_encoding_preserves_expand_type() {
        let raw = encode_string(r"%USERPROFILE%\bin", "REG_EXPAND_SZ");
        assert_eq!(raw.vtype, REG_EXPAND_SZ);
        assert_eq!(raw_string(&raw).unwrap().1, "REG_EXPAND_SZ");
    }

    #[test]
    fn raw_hash_distinguishes_absent_value_and_type() {
        let plain = encode_string("same", "REG_SZ");
        let expanded = encode_string("same", "REG_EXPAND_SZ");
        assert_ne!(hash_raw(None), hash_raw(Some(&plain)));
        assert_ne!(hash_raw(Some(&plain)), hash_raw(Some(&expanded)));
    }

    #[test]
    fn delete_preview_and_apply_remove_only_the_user_value() {
        struct Cleanup {
            key: RegKey,
            name: String,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.key.delete_value(&self.name);
            }
        }

        let name = format!("OPEN_TOOLBOX_TEST_DELETE_{}", Uuid::new_v4().simple());
        let key = open_user_write().expect("open user environment");
        key.set_raw_value(&name, &encode_string("temporary", "REG_SZ"))
            .expect("seed test value");
        let _cleanup = Cleanup {
            key,
            name: name.clone(),
        };

        let state = EnvPreviewState::default();
        let preview = preview_delete(&state, PreviewEnvDeleteRequest { key: name.clone() })
            .expect("delete preview");
        assert!(preview.requires_confirmation);
        assert_eq!(preview.targets[0].action, "delete");

        let result = apply(
            &state,
            ApplyEnvWriteRequest {
                preview_id: preview.preview_id,
            },
        )
        .expect("delete apply");
        assert!(result.ok);
        assert!(read_raw(&open_user_write().unwrap(), &name, "用户")
            .unwrap()
            .is_none());
    }

    #[test]
    fn list_reads_windows_registry_without_unsupported_error() {
        let result = list().expect("list environment variables");
        assert!(result.ok);
        assert!(!result.variables.is_empty());
        assert!(result
            .variables
            .iter()
            .all(|variable| variable.scope == "user" || variable.scope == "system"));
    }
}
