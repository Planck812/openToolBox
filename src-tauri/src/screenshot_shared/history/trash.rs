//! 截图历史：待删除区（trash）元数据与收据。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::TRASH_META_FILE;

/// 删除操作的收据：记录 ID 与可撤销截止时间。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashReceipt {
    pub record_id: String,
    pub delete_after: u64,
}

/// 待删除区记录元数据（与 `trash.json` 持久化）。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrashMetadata {
    pub(crate) record_id: String,
    pub(crate) deleted_at: u64,
    pub(crate) delete_after: u64,
}

/// 读取待删除区目录的 `trash.json`。
pub(crate) fn read_trash_metadata(directory: &Path) -> Result<TrashMetadata, String> {
    let bytes = fs::read(directory.join(TRASH_META_FILE))
        .map_err(|error| format!("读取截图删除状态失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("截图删除状态无效：{error}"))
}
