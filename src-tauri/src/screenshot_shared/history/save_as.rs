//! 截图历史：另存为命令、导出目录设置与目标校验。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use super::*;

/// 持久化的另存为设置（`save-as-settings.json`，记录上次导出目录）。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveAsSettings {
    last_directory: PathBuf,
}

impl HistoryRuntime {
    fn save_as_settings_path(&self) -> Result<PathBuf, String> {
        let store = self
            .store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?;
        let app_data = store
            .root
            .parent()
            .ok_or_else(|| "截图历史设置目录不可用".to_string())?;
        Ok(app_data.join(SAVE_AS_SETTINGS_FILE))
    }

    fn load_save_as_directory(&self) -> Option<PathBuf> {
        let path = self.save_as_settings_path().ok()?;
        let settings: SaveAsSettings = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        let metadata = fs::symlink_metadata(&settings.last_directory).ok()?;
        (metadata.is_dir() && !metadata.file_type().is_symlink()).then_some(settings.last_directory)
    }

    fn persist_save_as_directory(&self, directory: &Path) -> Result<(), String> {
        let metadata = fs::symlink_metadata(directory)
            .map_err(|error| format!("检查保存目录失败：{error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("拒绝保存不安全的截图导出目录".to_string());
        }
        let path = self.save_as_settings_path()?;
        let bytes = serde_json::to_vec(&SaveAsSettings {
            last_directory: directory.to_path_buf(),
        })
        .map_err(|error| format!("序列化截图导出设置失败：{error}"))?;
        atomic_write_bytes(&path, &bytes, "保存截图导出设置")
    }
}

/// 拒绝把另存为目标指向截图历史源记录目录。
fn reject_history_destination(
    history: &HistoryRuntime,
    record_id: &str,
    destination: &Path,
) -> Result<(), String> {
    let source = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .record_dir_if_valid(record_id)?;
    let source = source
        .canonicalize()
        .map_err(|error| format!("检查截图源文件失败：{error}"))?;
    let parent = destination
        .parent()
        .ok_or_else(|| "保存截图目录无效".to_string())?;
    if let Ok(parent) = parent.canonicalize() {
        if parent == source {
            return Err("不能覆盖截图历史源文件".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn history_save_as<R: Runtime>(
    app: AppHandle<R>,
    history: State<'_, HistoryRuntime>,
    record_id: String,
    variant: HistoryImageVariant,
) -> Result<HistorySaveAsResult, AppError> {
    validate_opaque_id(&record_id, "record")?;
    // Read and validate through the history store before showing the dialog. The
    // renderer supplies only the opaque record ID and selected image variant.
    let bytes = history.read_image_by_record_id(&record_id, variant)?;
    let initial_directory = history.load_save_as_directory();
    let initial_name = format!("screenshot-{record_id}.png");
    let (sender, receiver) = mpsc::sync_channel(1);
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(initial_name);
    if let Some(directory) = initial_directory {
        dialog = dialog.set_directory(directory);
    }
    dialog.save_file(move |selection| {
        let _ = sender.send(selection);
    });

    // 同步 `recv()` 会阻塞 tokio worker；包裹进 spawn_blocking，改为异步等待，
    // 避免 async 命令内阻塞事件循环（tokio 未作为直接依赖，故用 spawn_blocking 取舍）。
    let selection = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|e| format!("保存截图对话框线程失败：{e}"))?
        .map_err(|_| "保存截图对话框未能返回结果".to_string())?;
    let Some(selection) = selection else {
        return Ok(HistorySaveAsResult {
            saved: false,
            cancelled: true,
        });
    };
    let selected_path = selection
        .into_path()
        .map_err(|error| format!("保存截图路径无效：{error}"))?;
    let destination = normalize_png_extension(&selected_path);
    reject_history_destination(&history, &record_id, &destination)?;
    atomic_write_bytes(&destination, &bytes, "导出截图")?;
    let directory = destination
        .parent()
        .ok_or_else(|| "保存截图目录无效".to_string())?;
    history.persist_save_as_directory(directory)?;

    Ok(HistorySaveAsResult {
        saved: true,
        cancelled: false,
    })
}
