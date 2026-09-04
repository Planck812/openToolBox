//! 版本化截图历史记录（records / undo trash / 配额 / 另存为 / 缩略图 / 图像令牌）。
//!
//! 子模块：
//! - `store`：HistoryStore 存储引擎（发布 / 列表 / 读取 / 删除 / 恢复 / 配额保留）。
//! - `fs`：文件系统 / 校验 / 哈希 helper。
//! - `quota`：容量设置与校验。
//! - `trash`：待删除区元数据与收据。
//! - `save_as`：另存为命令与导出目录设置。
//! - `thumbnail`：缩略图生成与读取。
//! - `grants`：图像访问令牌。
//! - `runtime`：HistoryRuntime 状态与初始化。
//!
//! 命令路径：`lib.rs` 的 `attach_invoke_handler!` 中命令引用指向各子模块实际定义处
//! （`#[tauri::command]` 隐藏项不随 re-export）。

mod fs;
pub(crate) mod grants;
mod quota;
mod runtime;
pub(crate) mod save_as;
mod store;
pub(crate) mod thumbnail;
mod trash;

pub(crate) use fs::{
    atomic_write_bytes, artifact_digest, ensure_real_directory, file_name, is_sha256,
    normalize_png_extension, now_millis, read_directories, remove_dir_best_effort,
    remove_dir_checked, remove_file_best_effort, sha256_hex, sync_directory, validate_opaque_id,
    validate_payload_file, validate_png, write_synced_file,
};
pub(crate) use grants::{revoke_record_grants, ImageGrant};
pub use quota::{
    DEFAULT_QUOTA_BYTES, FREE_RESERVE_BYTES, HistoryQuotaSettings, PERMITTED_QUOTA_BYTES,
};
pub(crate) use quota::{load_quota_bytes, validate_quota_bytes};
pub(crate) use quota::QuotaSettings;
pub use runtime::{initialize, HistoryRuntime};
pub(crate) use store::HistoryStore;
pub use trash::TrashReceipt;
pub(crate) use trash::{read_trash_metadata, TrashMetadata};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::error::AppError;

pub(crate) const MANIFEST_SCHEMA_VERSION: u32 = 2;
pub(crate) const ROOT_DIR: &str = "screenshots-v2";
pub(crate) const RECORDS_DIR: &str = "records";
pub(crate) const STAGING_DIR: &str = "staging";
pub(crate) const TRASH_DIR: &str = "trash";
pub(crate) const MANIFEST_FILE: &str = "manifest.json";
pub(crate) const ORIGINAL_FILE: &str = "original.png";
pub(crate) const FINAL_FILE: &str = "final.png";
pub(crate) const TRASH_META_FILE: &str = "trash.json";
pub(crate) const INIT_MARKER: &str = ".initialized-v2";
pub(crate) const SAVE_AS_SETTINGS_FILE: &str = "save-as-settings.json";
pub(crate) const QUOTA_SETTINGS_FILE: &str = "quota-settings.json";
pub(crate) const MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;
pub(crate) const TRASH_UNDO_MS: u64 = 8_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySource {
    pub kind: String,
    #[serde(default)]
    pub record_id: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
}

impl Default for HistorySource {
    fn default() -> Self {
        Self {
            kind: "capture".to_string(),
            record_id: None,
            variant: None,
        }
    }
}

impl HistorySource {
    fn validate(&self) -> Result<(), String> {
        match self.kind.as_str() {
            "capture" if self.record_id.is_none() && self.variant.is_none() => Ok(()),
            // 全平台截图（screenshot-universal）来源：独立截图工具，无上游记录。
            "universal" if self.record_id.is_none() && self.variant.is_none() => Ok(()),
            // 滚动截图（scroll-screenshot）来源：独立截图工具，无上游记录。
            "scroll" if self.record_id.is_none() && self.variant.is_none() => Ok(()),
            "reannotate" => {
                let record_id = self
                    .record_id
                    .as_deref()
                    .ok_or_else(|| "截图历史来源记录 ID 无效".to_string())?;
                if Uuid::parse_str(record_id).is_err() {
                    return Err("截图历史来源记录 ID 无效".to_string());
                }
                match self.variant.as_deref() {
                    Some("original" | "final") => Ok(()),
                    _ => Err("截图历史来源图像版本无效".to_string()),
                }
            }
            _ => Err("截图历史来源元数据无效".to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryManifest {
    pub schema_version: u32,
    pub record_id: String,
    pub artifact_id: String,
    pub created_at: u64,
    pub width: u32,
    pub height: u32,
    pub original_file: String,
    pub final_file: String,
    pub original_bytes: u64,
    pub final_bytes: u64,
    pub original_digest: String,
    pub final_digest: String,
    pub artifact_digest: String,
    pub source: HistorySource,
    pub completed: bool,
}

impl HistoryManifest {
    fn validate(&self, expected_record_id: &str) -> Result<(), String> {
        if self.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err(format!("不支持的截图历史版本：{}", self.schema_version));
        }
        if self.record_id != expected_record_id || Uuid::parse_str(&self.record_id).is_err() {
            return Err("截图历史记录 ID 无效".to_string());
        }
        if self.artifact_id.trim().is_empty() || self.created_at == 0 {
            return Err("截图历史 artifact 元数据无效".to_string());
        }
        if self.width == 0 || self.height == 0 || !self.completed {
            return Err("截图历史记录尚未完整提交".to_string());
        }
        if self.original_file != ORIGINAL_FILE || self.final_file != FINAL_FILE {
            return Err("截图历史文件名无效".to_string());
        }
        if !is_sha256(&self.original_digest)
            || !is_sha256(&self.final_digest)
            || !is_sha256(&self.artifact_digest)
        {
            return Err("截图历史摘要无效".to_string());
        }
        self.source.validate()?;
        Ok(())
    }

    fn total_bytes(&self) -> u64 {
        self.original_bytes.saturating_add(self.final_bytes)
    }
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecordSummary {
    pub record_id: String,
    pub created_at: u64,
    pub width: u32,
    pub height: u32,
    pub total_bytes: u64,
    pub artifact_digest: String,
    pub source: HistorySource,
}

impl From<&HistoryManifest> for HistoryRecordSummary {
    fn from(manifest: &HistoryManifest) -> Self {
        Self {
            record_id: manifest.record_id.clone(),
            created_at: manifest.created_at,
            width: manifest.width,
            height: manifest.height,
            total_bytes: manifest.total_bytes(),
            artifact_digest: manifest.artifact_digest.clone(),
            source: manifest.source.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecordDetail {
    pub manifest: HistoryManifest,
    pub original_token: String,
    pub final_token: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishHistoryRequest {
    pub artifact_id: String,
    pub original_png: Vec<u8>,
    pub final_png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub source: HistorySource,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, Type)]
#[serde(rename_all = "lowercase")]
pub enum HistoryImageVariant {
    Original,
    Final,
}

pub(crate) type ImageVariant = HistoryImageVariant;

#[derive(Clone, Debug, Serialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistorySaveAsResult {
    pub saved: bool,
    pub cancelled: bool,
}

#[tauri::command]
#[specta::specta]
pub fn history_get_quota_settings(
    history: State<'_, HistoryRuntime>,
) -> Result<HistoryQuotaSettings, AppError> {
    history.quota_settings().map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn history_set_quota_settings(
    history: State<'_, HistoryRuntime>,
    quota_bytes: u64,
) -> Result<HistoryQuotaSettings, AppError> {
    history.set_quota_bytes(quota_bytes).map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn history_list_records(
    history: State<'_, HistoryRuntime>,
) -> Result<Vec<HistoryRecordSummary>, AppError> {
    history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .list_records(now_millis(), true)
        .map_err(AppError::Message)
}

/// Creates an independent history record from a selected source image. The
/// annotation editor can later modify this copy without mutating its source.
#[tauri::command]
#[specta::specta]
pub fn history_create_copy_from_record(
    history: State<'_, HistoryRuntime>,
    record_id: String,
    variant: HistoryImageVariant,
) -> Result<HistoryRecordSummary, AppError> {
    validate_opaque_id(&record_id, "record")?;
    history.create_copy_from_record(&record_id, variant).map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn history_delete_record(
    history: State<'_, HistoryRuntime>,
    record_id: String,
) -> Result<TrashReceipt, AppError> {
    validate_opaque_id(&record_id, "record")?;
    let receipt = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .delete_to_trash(&record_id, now_millis())?;
    revoke_record_grants(&history, &record_id)?;
    history.schedule_trash_settlement(receipt.delete_after);
    Ok(receipt)
}

#[tauri::command]
#[specta::specta]
pub fn history_undo_delete(
    history: State<'_, HistoryRuntime>,
    record_id: String,
) -> Result<HistoryRecordSummary, AppError> {
    validate_opaque_id(&record_id, "record")?;
    history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .undo_trash(&record_id, now_millis())
        .map_err(AppError::Message)
}

#[tauri::command]
#[specta::specta]
pub fn history_clear_all(history: State<'_, HistoryRuntime>) -> Result<u32, AppError> {
    let count = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .clear_all()?;
    history
        .image_grants
        .lock()
        .map_err(|_| "截图历史令牌服务不可用".to_string())?
        .clear();
    Ok(count)
}

#[tauri::command]
#[specta::specta]
pub fn history_reveal_record<R: Runtime>(
    app: AppHandle<R>,
    history: State<'_, HistoryRuntime>,
    record_id: String,
) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;

    validate_opaque_id(&record_id, "record")?;
    let record_dir = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .record_dir_if_valid(&record_id)?;
    app.opener()
        .reveal_item_in_dir(record_dir.join(FINAL_FILE))
        .map_err(|error| AppError::Message(format!("打开截图位置失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn manifest_guard_rejects_wrong_schema_and_unsafe_names() {
        let id = Uuid::new_v4().to_string();
        let mut manifest = HistoryManifest {
            schema_version: 99,
            record_id: id.clone(),
            artifact_id: "artifact".to_string(),
            created_at: 1,
            width: 1,
            height: 1,
            original_file: ORIGINAL_FILE.to_string(),
            final_file: FINAL_FILE.to_string(),
            original_bytes: 1,
            final_bytes: 1,
            original_digest: "a".repeat(64),
            final_digest: "b".repeat(64),
            artifact_digest: "c".repeat(64),
            source: HistorySource::default(),
            completed: true,
        };
        assert!(manifest.validate(&id).is_err());
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.original_file = "../original.png".to_string();
        assert!(manifest.validate(&id).is_err());
    }

    #[test]
    fn manifest_guard_rejects_invalid_source_metadata() {
        let id = Uuid::new_v4().to_string();
        let mut manifest = HistoryManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            record_id: id.clone(),
            artifact_id: "artifact".to_string(),
            created_at: 1,
            width: 1,
            height: 1,
            original_file: ORIGINAL_FILE.to_string(),
            final_file: FINAL_FILE.to_string(),
            original_bytes: 1,
            final_bytes: 1,
            original_digest: "a".repeat(64),
            final_digest: "b".repeat(64),
            artifact_digest: "c".repeat(64),
            source: HistorySource {
                kind: "reannotate".to_string(),
                record_id: Some("not-a-uuid".to_string()),
                variant: Some("final".to_string()),
            },
            completed: true,
        };
        assert!(manifest.validate(&id).is_err());
        manifest.source = HistorySource {
            kind: "capture".to_string(),
            record_id: Some(Uuid::new_v4().to_string()),
            variant: None,
        };
        assert!(manifest.validate(&id).is_err());
    }
}
