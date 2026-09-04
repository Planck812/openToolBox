//! 截图共享模块：被全平台截图（`screenshot_universal`）与贴图（pin）复用。
//!
//! 从旧 `screenshot/` 模块迁移而来，只保留跨功能共享的代码：
//! - `types`：坐标/错误/会话 DTO。
//! - `capture`：DXGI Desktop Duplication 后端（Windows 最快取帧）。
//! - `history`：版本化截图历史记录（records / undo trash / 配额）。
//! - `pin`：贴图注册表与贴图窗口。
//! - `write_final_png` / `set_app_handle`：另存为与 AppHandle 共享入口。

pub mod capture;
pub mod history;
pub mod pin;
pub mod types;
#[cfg(windows)]
pub mod scroll;
#[cfg(windows)]
pub mod scroll_session;

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::AppHandle;

/// Stored AppHandle for overlay-initiated operations (e.g. pin window creation).
static APP_HANDLE: OnceLock<AppHandle<tauri::Wry>> = OnceLock::new();

/// Set the global AppHandle for use in shared flows.
pub fn set_app_handle(handle: AppHandle<tauri::Wry>) {
    let _ = APP_HANDLE.set(handle);
}

/// Retrieve the stored AppHandle, if set.
pub(crate) fn app_handle() -> Option<&'static AppHandle<tauri::Wry>> {
    APP_HANDLE.get()
}

/// Write a final screenshot PNG to disk with extension normalization and
/// directory safety checks.
pub(crate) fn write_final_png(path: &Path, png: &[u8]) -> Result<(), String> {
    let path = normalize_png_extension(path);
    let parent = path.parent().ok_or_else(|| "保存目录无效".to_string())?;
    let metadata =
        std::fs::symlink_metadata(parent).map_err(|e| format!("检查保存目录失败：{e}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("保存目录不安全".to_string());
    }
    std::fs::write(&path, png).map_err(|e| format!("写入截图文件失败：{e}"))
}

fn normalize_png_extension(path: &Path) -> PathBuf {
    path.with_extension("png")
}
