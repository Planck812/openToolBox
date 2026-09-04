//! 加密落盘模块：服务 pwd-box（密码夹）与 curl-runner（请求历史）两类敏感数据。
//!
//! 数据安全设计：
//! - 主密钥：32 字节随机密钥，hex 编码后存入系统凭据库（Windows Credential Manager /
//!   macOS Keychain / Linux Secret Service），service=`open-toolbox`，user=`pwdbox-master-key`。
//! - 密文落盘：AES-256-GCM 加密密码库 JSON，密文文件格式 `v1:` + base64(nonce || ciphertext)。
//! - 迁移：读到旧明文 JSON 时返回其内容并立即以密文重写（一次迁移、原子写 temp + rename）。
//! - 凭据库不可用时返回带稳定标记的明确错误，绝不静默明文回退。
//!
//! 可测试性：核心读写逻辑经 `MasterKeyStore` trait 注入密钥存取；生产代码走
//! `KeyringStore`（系统凭据库），单测走 `#[cfg(test)]` 的内存实现，避免 CI 无凭据库失败。

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes_gcm::aead::Aead;
use aes_gcm::aead::KeyInit;
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::AppError;

/// 系统凭据库中的 service 标识（pwd-box 与 curl-runner 共用同一 service、不同 user）。
const SERVICE: &str = "open-toolbox";
/// 旧版本（smart-toolbox）使用的 service 标识，用于向下兼容平滑迁移凭据。
const LEGACY_SERVICE: &str = "smart-toolbox";
/// 密码夹主密钥在系统凭据库中的 user 标识。
const PWDBOX_USER: &str = "pwdbox-master-key";
/// Curl 请求历史主密钥在系统凭据库中的 user 标识（独立于密码夹，避免一损俱损）。
const CURL_USER: &str = "curl-storage-master-key";
/// 密码库密文文件名（与旧明文文件同名，便于原地迁移）。
const PWDBOX_FILE_NAME: &str = ".smtPwdBox.json";
/// Curl 请求历史密文文件名（与旧 plugin-store 明文文件同名，便于原地迁移）。
const CURL_FILE_NAME: &str = "curl-requests.json";
/// 密文文件魔法前缀，用于区分密文与旧明文。
const MAGIC_PREFIX: &str = "v1:";
/// AES-256 密钥长度。
const KEY_LEN: usize = 32;
/// GCM nonce 长度（96-bit）。
const NONCE_LEN: usize = 12;
/// 凭据库不可用时的稳定错误标记（前端据此提示「当前环境不支持加密存储」）。
const UNSUPPORTED_STORAGE_MARK: &str = "pwdbox: encrypted storage unavailable";

/// 主密钥存取抽象：真实实现走系统凭据库，测试用内存实现注入。
trait MasterKeyStore {
    /// 读取已存主密钥；尚未存储时返回 `Ok(None)`。
    fn get(&self) -> Result<Option<Vec<u8>>, String>;
    /// 写入主密钥。
    fn set(&self, key: &[u8]) -> Result<(), String>;
}

/// 生产实现：主密钥存入系统凭据库（keyring）。`service`/`user` 由调用方指定，
/// 使 pwd-box 与 curl-runner 各自持有独立主密钥。
struct KeyringStore {
    service: &'static str,
    user: &'static str,
}

impl MasterKeyStore for KeyringStore {
    fn get(&self) -> Result<Option<Vec<u8>>, String> {
        let entry = keyring::Entry::new(self.service, self.user).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(hex) => decode_hex(&hex).map(Some),
            Err(keyring::Error::NoEntry) => {
                // 如果当前使用新 service（open-toolbox），且尚未记录，自动尝试从旧版 smart-toolbox 凭据平滑迁移
                if self.service == SERVICE {
                    if let Ok(legacy_entry) = keyring::Entry::new(LEGACY_SERVICE, self.user) {
                        if let Ok(hex) = legacy_entry.get_password() {
                            if let Ok(key) = decode_hex(&hex) {
                                let _ = entry.set_password(&hex);
                                return Ok(Some(key));
                            }
                        }
                    }
                }
                Ok(None)
            }
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, key: &[u8]) -> Result<(), String> {
        let entry = keyring::Entry::new(self.service, self.user).map_err(|e| e.to_string())?;
        entry
            .set_password(&encode_hex(key))
            .map_err(|e| e.to_string())
    }
}

/// 把密钥不可用的底层错误统一映射为带稳定标记的 `AppError`，前端据此提示不支持加密存储。
fn unsupported_storage(cause: String) -> AppError {
    AppError::Message(format!("{UNSUPPORTED_STORAGE_MARK}: {cause}"))
}

/// 读取已存主密钥；无则生成一个并写回（用于保存与旧明文迁移路径）。
fn get_or_create_key(store: &dyn MasterKeyStore) -> Result<Vec<u8>, AppError> {
    match store.get().map_err(unsupported_storage)? {
        Some(key) => Ok(key),
        None => {
            let key = generate_key();
            store.set(&key).map_err(unsupported_storage)?;
            Ok(key)
        }
    }
}

fn generate_key() -> Vec<u8> {
    let mut key = vec![0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

/// 加密明文，返回 `v1:` + base64(nonce || ciphertext)。
fn encrypt(key: &[u8], plaintext: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Message(format!("AES 密钥长度非法：{e}")))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Message(format!("加密失败：{e}")))?;

    let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(format!("{MAGIC_PREFIX}{}", BASE64.encode(payload)))
}

/// 解密 `v1:` + base64(nonce || ciphertext)。
fn decrypt(key: &[u8], content: &str) -> Result<Vec<u8>, AppError> {
    let encoded = content
        .strip_prefix(MAGIC_PREFIX)
        .ok_or_else(|| AppError::Message("密码库密文格式非法".to_string()))?;
    let payload = BASE64
        .decode(encoded)
        .map_err(|e| AppError::Message(format!("密文 base64 解码失败：{e}")))?;
    if payload.len() < NONCE_LEN {
        return Err(AppError::Message("密码库密文长度非法".to_string()));
    }
    let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Message(format!("AES 密钥长度非法：{e}")))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Message(format!("解密失败（主密钥不匹配或数据损坏）：{e}")))
}

/// 判定文件内容是否为旧明文 JSON（可被 `serde_json` 解析）。
fn is_plaintext_json(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content).is_ok()
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err("主密钥 hex 长度非法".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标（避免写一半留下损坏密文）。
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Message("无法解析密码库文件目录".to_string()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Message("无法解析密码库文件名".to_string()))?;
    let tmp_path = dir.join(format!("{}.tmp", file_name.to_string_lossy()));

    std::fs::write(&tmp_path, bytes).map_err(AppError::Io)?;
    // Windows 上 `std::fs::rename` 使用 MOVEFILE_REPLACE_EXISTING，可原子覆盖已存在目标。
    std::fs::rename(&tmp_path, path).map_err(AppError::Io)
}

/// 读取密码库文件（含迁移）：返回 JSON 字符串；文件不存在返回 `Ok(None)`。
fn load_from(store: &dyn MasterKeyStore, path: &Path) -> Result<Option<String>, AppError> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::Io(e)),
    };

    if content.starts_with(MAGIC_PREFIX) {
        // 密文：必须已有主密钥，否则无法解密。此处不自动生成新密钥，避免密钥缺失时
        // 生成一把新密钥进而「看似成功实则数据永久不可读」。
        let key = store
            .get()
            .map_err(unsupported_storage)?
            .ok_or_else(|| {
                unsupported_storage("主密钥缺失，无法解密密码库".to_string())
            })?;
        let plaintext = decrypt(&key, &content)?;
        let json = String::from_utf8(plaintext).map_err(AppError::Utf8)?;
        return Ok(Some(json));
    }

    if is_plaintext_json(&content) {
        // 旧明文：返回内容并立即以密文重写（一次迁移、原子写）。
        let key = get_or_create_key(store)?;
        let encrypted = encrypt(&key, content.as_bytes())?;
        atomic_write(path, encrypted.as_bytes())?;
        return Ok(Some(content));
    }

    Err(AppError::Message(
        "密码库文件已损坏（既非密文也非合法 JSON）".to_string(),
    ))
}

/// 加密并原子写回密码库文件。
fn save_to(store: &dyn MasterKeyStore, path: &Path, data: &str) -> Result<(), AppError> {
    let key = get_or_create_key(store)?;
    let encrypted = encrypt(&key, data.as_bytes())?;
    atomic_write(path, encrypted.as_bytes())
}

/// 解析密码库文件在用户目录下的绝对路径（`~/.smtPwdBox.json`）。
fn pwdbox_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .home_dir()
        .map(|dir| dir.join(PWDBOX_FILE_NAME))
        .map_err(|e| AppError::Message(format!("无法解析用户主目录：{e}")))
}

/// 读取密码库（解密 / 迁移后返回 JSON 字符串；不存在返回 `None`）。
#[tauri::command]
#[specta::specta]
pub fn pwdbox_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, AppError> {
    let path = pwdbox_path(&app)?;
    let store = KeyringStore { service: SERVICE, user: PWDBOX_USER };
    load_from(&store, &path)
}

/// 加密并落盘密码库 JSON 字符串。
#[tauri::command]
#[specta::specta]
pub fn pwdbox_save<R: Runtime>(app: AppHandle<R>, data: String) -> Result<(), AppError> {
    let path = pwdbox_path(&app)?;
    let store = KeyringStore { service: SERVICE, user: PWDBOX_USER };
    save_to(&store, &path, &data)
}

/// 密码夹免密查看/复制有效期：10 分钟。
pub const AUTH_SESSION_TIMEOUT: Duration = Duration::from_secs(600);

/// 记录最近一次成功验证的时间戳。
static LAST_AUTH_INSTANT: Mutex<Option<Instant>> = Mutex::new(None);

/// 检查当前是否仍在 10 分钟免密有效期内。
pub fn is_auth_session_valid() -> bool {
    let guard = match LAST_AUTH_INSTANT.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(instant) = *guard {
        instant.elapsed() < AUTH_SESSION_TIMEOUT
    } else {
        false
    }
}

/// 记录一次成功的身份验证时间戳。
pub fn update_auth_session() {
    let mut guard = match LAST_AUTH_INSTANT.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *guard = Some(Instant::now());
}

/// 清除免密会话（主动锁定）。
pub fn clear_auth_session() {
    let mut guard = match LAST_AUTH_INSTANT.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *guard = None;
}

#[cfg(windows)]
fn verify_user_consent(
    message: &str,
    hwnd: Option<windows::Win32::Foundation::HWND>,
) -> Result<bool, AppError> {
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
    use windows::Win32::System::WinRT::{RoGetActivationFactory, IUserConsentVerifierInterop};

    let _ = unsafe {
        windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        )
    };

    let msg = HSTRING::from(message);

    // 优先使用 IUserConsentVerifierInterop 绑定宿主窗口句柄（HWND），
    // 确保 Windows Hello 对话框直接在前台居中作为模态弹窗弹出，避免被系统判定为无主窗口而最小化或隐藏到后台。
    let result = if let Some(parent_hwnd) = hwnd {
        let interop_res: windows::core::Result<IUserConsentVerifierInterop> = unsafe {
            RoGetActivationFactory(&HSTRING::from("Windows.Security.Credentials.UI.UserConsentVerifier"))
        };
        match interop_res {
            Ok(interop) => {
                let op: windows::core::Result<windows_future::IAsyncOperation<UserConsentVerificationResult>> = unsafe {
                    interop.RequestVerificationForWindowAsync(parent_hwnd, &msg)
                };
                match op {
                    Ok(async_op) => async_op.get().map_err(|e| AppError::Message(format!("等待系统身份验证结果失败：{e}"))),
                    Err(_) => {
                        let op = UserConsentVerifier::RequestVerificationAsync(&msg)
                            .map_err(|e| AppError::Message(format!("发起系统身份验证失败：{e}")))?;
                        op.get().map_err(|e| AppError::Message(format!("等待系统身份验证结果失败：{e}")))
                    }
                }
            }
            Err(_) => {
                let op = UserConsentVerifier::RequestVerificationAsync(&msg)
                    .map_err(|e| AppError::Message(format!("发起系统身份验证失败：{e}")))?;
                op.get().map_err(|e| AppError::Message(format!("等待系统身份验证结果失败：{e}")))
            }
        }
    } else {
        let op = UserConsentVerifier::RequestVerificationAsync(&msg)
            .map_err(|e| AppError::Message(format!("发起系统身份验证失败：{e}")))?;
        op.get().map_err(|e| AppError::Message(format!("等待系统身份验证结果失败：{e}")))
    }?;

    match result {
        UserConsentVerificationResult::Verified => Ok(true),
        UserConsentVerificationResult::Canceled => Ok(false),
        UserConsentVerificationResult::DeviceBusy => {
            Err(AppError::Message("身份验证设备正忙，请重试".to_string()))
        }
        UserConsentVerificationResult::RetriesExhausted => {
            Err(AppError::Message("验证尝试次数过多，请稍后再试".to_string()))
        }
        UserConsentVerificationResult::DisabledByPolicy => {
            Err(AppError::Message("系统策略已禁用身份验证".to_string()))
        }
        UserConsentVerificationResult::DeviceNotPresent
        | UserConsentVerificationResult::NotConfiguredForUser => {
            Err(AppError::Message(
                "当前系统未配置 Windows Hello 或开机凭据（PIN/密码）".to_string(),
            ))
        }
        _ => Ok(false),
    }
}

#[cfg(not(windows))]
fn verify_user_consent(_message: &str) -> Result<bool, AppError> {
    Ok(true)
}

/// 发起系统开机密码 / Windows Hello 身份验证。
/// 若当前在 10 分钟免密有效期内，直接返回 `Ok(true)`。
#[tauri::command]
#[specta::specta]
pub async fn pwdbox_authenticate<R: Runtime>(
    app: AppHandle<R>,
    prompt: Option<String>,
) -> Result<bool, AppError> {
    if is_auth_session_valid() {
        return Ok(true);
    }

    let message = prompt.unwrap_or_else(|| "请输入电脑开机密码或通过 Windows Hello 验证身份以访问密码".to_string());

    #[cfg(windows)]
    let raw_hwnd: Option<isize> = {
        let win = app.get_webview_window("main").or_else(|| {
            app.webview_windows().into_values().next()
        });
        win.and_then(|w| w.hwnd().ok()).map(|h| h.0 as isize)
    };

    let verified = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let hwnd = raw_hwnd.map(|val| windows::Win32::Foundation::HWND(val as *mut core::ffi::c_void));
            verify_user_consent(&message, hwnd)
        }
        #[cfg(not(windows))]
        {
            verify_user_consent(&message)
        }
    })
    .await
    .map_err(|e| AppError::Message(format!("验证任务调度失败：{e}")))?;

    if verified? {
        update_auth_session();
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 检查当前是否在 10 分钟免密有效期内。
#[tauri::command]
#[specta::specta]
pub fn pwdbox_auth_check() -> bool {
    is_auth_session_valid()
}

/// 主动锁定密码夹（清除免密会话）。
#[tauri::command]
#[specta::specta]
pub fn pwdbox_auth_lock() {
    clear_auth_session();
}


/// 解析 Curl 请求历史文件路径（`AppData/curl-requests.json`，与旧 plugin-store 同路径以便原地迁移）。
fn curl_storage_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .resolve(CURL_FILE_NAME, tauri::path::BaseDirectory::AppData)
        .map_err(|e| AppError::Message(format!("无法解析应用数据目录：{e}")))
}

/// 读取 Curl 请求历史（解密 / 迁移后返回 JSON 字符串；不存在返回 `None`）。
#[tauri::command]
#[specta::specta]
pub fn curl_storage_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, AppError> {
    let path = curl_storage_path(&app)?;
    let store = KeyringStore { service: SERVICE, user: CURL_USER };
    load_from(&store, &path)
}

/// 加密并落盘 Curl 请求历史 JSON 字符串。
#[tauri::command]
#[specta::specta]
pub fn curl_storage_save<R: Runtime>(app: AppHandle<R>, data: String) -> Result<(), AppError> {
    let path = curl_storage_path(&app)?;
    let store = KeyringStore { service: SERVICE, user: CURL_USER };
    save_to(&store, &path, &data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 内存主密钥存储，供单测注入（避免依赖系统凭据库）。
    struct MemoryStore {
        key: Mutex<Option<Vec<u8>>>,
    }

    impl MemoryStore {
        fn new() -> Self {
            Self {
                key: Mutex::new(None),
            }
        }

        fn with_key(key: &[u8]) -> Self {
            Self {
                key: Mutex::new(Some(key.to_vec())),
            }
        }
    }

    impl MasterKeyStore for MemoryStore {
        fn get(&self) -> Result<Option<Vec<u8>>, String> {
            Ok(self.key.lock().unwrap().clone())
        }

        fn set(&self, key: &[u8]) -> Result<(), String> {
            *self.key.lock().unwrap() = Some(key.to_vec());
            Ok(())
        }
    }

    #[test]
    fn hex_round_trip() {
        let bytes = vec![0x00, 0x01, 0xab, 0xff, 0x10];
        assert_eq!(decode_hex(&encode_hex(&bytes)).unwrap(), bytes);
    }

    #[test]
    fn decode_hex_rejects_odd_length() {
        assert!(decode_hex("abc").is_err());
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = generate_key();
        let plaintext = br#"{"version":1,"items":[]}"#;
        let encrypted = encrypt(&key, plaintext).unwrap();
        assert!(encrypted.starts_with(MAGIC_PREFIX));
        // 密文本身必须不可被解析为 JSON（不会与旧明文混淆）。
        assert!(!is_plaintext_json(&encrypted));
        assert_eq!(decrypt(&key, &encrypted).unwrap(), plaintext);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let key = generate_key();
        let other = generate_key();
        let encrypted = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&other, &encrypted).is_err());
    }

    #[test]
    fn decrypt_rejects_non_magic_content() {
        let key = generate_key();
        assert!(decrypt(&key, "not-a-ciphertext").is_err());
    }

    #[test]
    fn save_then_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PWDBOX_FILE_NAME);
        let store = MemoryStore::new();
        let data = r#"{"version":1,"items":[{"id":"a"}]}"#;

        save_to(&store, &path, data).unwrap();

        // 落盘的是密文（带魔法前缀），不是明文 JSON。
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.starts_with(MAGIC_PREFIX));
        assert!(!is_plaintext_json(&raw));

        // 同一把密钥可读回原始数据。
        assert_eq!(load_from(&store, &path).unwrap().as_deref(), Some(data));
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PWDBOX_FILE_NAME);
        let store = MemoryStore::new();
        assert_eq!(load_from(&store, &path).unwrap(), None);
    }

    #[test]
    fn load_migrates_legacy_plaintext_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PWDBOX_FILE_NAME);
        let store = MemoryStore::new();
        let legacy = r#"{"version":1,"items":[]}"#;
        std::fs::write(&path, legacy).unwrap();

        // 首次加载返回明文内容，并立即以密文重写。
        assert_eq!(load_from(&store, &path).unwrap().as_deref(), Some(legacy));
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.starts_with(MAGIC_PREFIX));
        assert!(!is_plaintext_json(&raw));

        // 迁移后再次加载走密文解密路径，数据一致。
        assert_eq!(load_from(&store, &path).unwrap().as_deref(), Some(legacy));
    }

    #[test]
    fn load_rejects_corrupt_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PWDBOX_FILE_NAME);
        let store = MemoryStore::new();
        std::fs::write(&path, "garbage-not-json").unwrap();
        assert!(load_from(&store, &path).is_err());
    }

    #[test]
    fn load_ciphertext_with_missing_key_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PWDBOX_FILE_NAME);
        let key = generate_key();
        let writer = MemoryStore::with_key(&key);
        save_to(&writer, &path, r#"{"version":1,"items":[]}"#).unwrap();

        // 换一个「空」存储（无主密钥）尝试读取：必须明确报错，而非静默生成新密钥。
        let empty = MemoryStore::new();
        let err = load_from(&empty, &path).unwrap_err().to_string();
        assert!(err.contains(UNSUPPORTED_STORAGE_MARK));
    }

    #[test]
    fn get_or_create_key_is_idempotent() {
        let store = MemoryStore::new();
        let first = get_or_create_key(&store).unwrap();
        let second = get_or_create_key(&store).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), KEY_LEN);
    }

    #[test]
    fn auth_session_lifecycle() {
        clear_auth_session();
        assert!(!is_auth_session_valid());

        update_auth_session();
        assert!(is_auth_session_valid());

        clear_auth_session();
        assert!(!is_auth_session_valid());
    }
}
