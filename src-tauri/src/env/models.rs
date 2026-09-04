use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use specta::Type;

#[allow(dead_code, reason = "平台实现将在后续任务接线")]
pub const ENV_PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub value_type: String,
    pub scope: String,
    pub source_label: String,
    pub writable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvCommandError {
    pub code: String,
    pub message: String,
}

impl EnvCommandError {
    pub(crate) fn unsupported_platform() -> Self {
        Self {
            code: "unsupported_platform".into(),
            message: "当前平台尚未实现环境变量管理".into(),
        }
    }
}

impl fmt::Display for EnvCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EnvCommandError {}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvTargetInfo {
    pub id: String,
    pub path: String,
    pub exists: bool,
    pub recommended: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvPlatformInfo {
    pub platform: String,
    pub supports_direct_write: bool,
    pub available_targets: Vec<EnvTargetInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListEnvResult {
    pub ok: bool,
    pub variables: Vec<EnvVariable>,
    pub message: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct GetEnvResult {
    pub ok: bool,
    pub value: Option<String>,
    pub variable: Option<EnvVariable>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEnvWriteRequest {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEnvDeleteRequest {
    pub key: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvTargetPreview {
    pub id: String,
    pub path: String,
    pub exists: bool,
    pub action: String,
    pub before_lines: Vec<String>,
    pub after_lines: Vec<String>,
    pub diff: String,
    pub hash: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvWritePreview {
    pub preview_id: String,
    pub requires_confirmation: bool,
    pub targets: Vec<EnvTargetPreview>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEnvWriteRequest {
    pub preview_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetEnvResult {
    pub ok: bool,
    pub message: String,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
#[allow(dead_code, reason = "平台实现将在后续任务接线")]
pub(crate) struct PendingTargetWrite {
    pub id: String,
    pub path: String,
    pub original_hash: String,
    pub original_content: Vec<u8>,
    pub updated_content: Vec<u8>,
    pub existed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingOperation {
    Write,
    Delete,
}

#[derive(Debug)]
#[allow(dead_code, reason = "平台实现将在后续任务接线")]
pub(crate) struct PendingPreview {
    pub key: String,
    pub value: String,
    pub operation: PendingOperation,
    pub targets: Vec<PendingTargetWrite>,
    pub created_at: SystemTime,
}

#[derive(Default)]
pub struct EnvPreviewState {
    #[allow(dead_code, reason = "平台实现将在后续任务接线")]
    pub(crate) previews: Mutex<HashMap<String, PendingPreview>>,
}
