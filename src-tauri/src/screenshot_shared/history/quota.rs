//! 截图历史：容量设置与校验。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::*;

pub const QUOTA_512_MB_BYTES: u64 = 512 * 1024 * 1024;
pub const QUOTA_1_GB_BYTES: u64 = 1024 * 1024 * 1024;
pub const DEFAULT_QUOTA_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const QUOTA_5_GB_BYTES: u64 = 5 * 1024 * 1024 * 1024;
pub const PERMITTED_QUOTA_BYTES: [u64; 4] = [
    QUOTA_512_MB_BYTES,
    QUOTA_1_GB_BYTES,
    DEFAULT_QUOTA_BYTES,
    QUOTA_5_GB_BYTES,
];
pub const FREE_RESERVE_BYTES: u64 = 1024 * 1024 * 1024;

/// 持久化的容量设置（`quota-settings.json`）。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuotaSettings {
    pub(crate) quota_bytes: u64,
}

/// 对外暴露的容量设置（含可选档位）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuotaSettings {
    pub quota_bytes: u64,
    pub permitted_quota_bytes: Vec<u64>,
}

pub(crate) fn validate_quota_bytes(quota_bytes: u64) -> Result<(), String> {
    if PERMITTED_QUOTA_BYTES.contains(&quota_bytes) {
        return Ok(());
    }
    Err("截图历史容量仅支持 512 MB、1 GB、2 GB 或 5 GB".to_string())
}

pub(crate) fn load_quota_bytes(product_root: &Path) -> Option<u64> {
    let path = product_root.join(QUOTA_SETTINGS_FILE);
    let settings: QuotaSettings = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    validate_quota_bytes(settings.quota_bytes)
        .ok()
        .map(|()| settings.quota_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store(temp: &TempDir, quota: u64) -> HistoryStore {
        let mut store = HistoryStore::new(temp.path().join(ROOT_DIR), quota).unwrap();
        store
            .initialize_and_recover(&temp.path().join("legacy"), 10_000)
            .unwrap();
        store
    }

    #[test]
    fn quota_settings_only_accept_the_product_permitted_values() {
        assert_eq!(
            PERMITTED_QUOTA_BYTES,
            [
                QUOTA_512_MB_BYTES,
                QUOTA_1_GB_BYTES,
                DEFAULT_QUOTA_BYTES,
                QUOTA_5_GB_BYTES,
            ]
        );
        for quota in PERMITTED_QUOTA_BYTES {
            assert!(validate_quota_bytes(quota).is_ok());
        }
        assert!(validate_quota_bytes(3 * 1024 * 1024 * 1024).is_err());
        assert!(validate_quota_bytes(0).is_err());
    }

    #[test]
    fn quota_setting_persists_at_the_history_feature_boundary() {
        let temp = TempDir::new().unwrap();
        let runtime = HistoryRuntime::new(store(&temp, DEFAULT_QUOTA_BYTES));

        let updated = runtime.set_quota_bytes(QUOTA_5_GB_BYTES).unwrap();
        assert_eq!(updated.quota_bytes, QUOTA_5_GB_BYTES);
        assert_eq!(updated.permitted_quota_bytes, PERMITTED_QUOTA_BYTES);
        assert_eq!(
            load_quota_bytes(temp.path()),
            Some(QUOTA_5_GB_BYTES),
            "a later history initialization must load the feature-owned setting"
        );
        assert!(runtime.set_quota_bytes(3 * 1024 * 1024 * 1024).is_err());
        assert_eq!(
            runtime.quota_settings().unwrap().quota_bytes,
            QUOTA_5_GB_BYTES
        );
    }
}
