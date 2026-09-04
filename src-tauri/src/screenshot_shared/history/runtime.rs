//! 截图历史：HistoryRuntime 运行时状态与初始化。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{Manager, Runtime};

use super::*;

/// 截图历史运行时状态：存储引擎 + 图像令牌表。
pub struct HistoryRuntime {
    pub(crate) store: Arc<Mutex<HistoryStore>>,
    pub(crate) image_grants: Mutex<HashMap<String, ImageGrant>>,
}

impl HistoryRuntime {
    pub(crate) fn new(store: HistoryStore) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
            image_grants: Mutex::new(HashMap::new()),
        }
    }

    pub fn publish(&self, request: PublishHistoryRequest) -> Result<HistoryManifest, String> {
        // 解码/哈希（最重）在锁外完成；锁内只做清单比对 + 落盘，避免阻塞全部历史命令。
        let prepared = HistoryStore::prepare_publish(request)?;
        self.store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .publish_prepared(prepared)
    }

    pub fn read_image_by_record_id(
        &self,
        record_id: &str,
        variant: HistoryImageVariant,
    ) -> Result<Vec<u8>, String> {
        self.store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .read_image(record_id, variant)
    }

    /// 当前可撤销的待删除区截止时间（用于启动时安排后台结算）。
    fn active_trash_deadlines(&self) -> Result<Vec<u64>, String> {
        self.store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .active_trash_deadlines(now_millis())
    }

    pub(crate) fn create_copy_from_record(
        &self,
        record_id: &str,
        variant: HistoryImageVariant,
    ) -> Result<HistoryRecordSummary, String> {
        self.store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .create_copy_from_record(record_id, variant)
            .map(|manifest| HistoryRecordSummary::from(&manifest))
    }

    fn quota_settings_path(&self) -> Result<PathBuf, String> {
        let store = self
            .store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?;
        let app_data = store
            .root
            .parent()
            .ok_or_else(|| "截图历史设置目录不可用".to_string())?;
        Ok(app_data.join(QUOTA_SETTINGS_FILE))
    }

    pub(crate) fn quota_settings(&self) -> Result<HistoryQuotaSettings, String> {
        let quota_bytes = self
            .store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .quota_bytes;
        Ok(HistoryQuotaSettings {
            quota_bytes,
            permitted_quota_bytes: PERMITTED_QUOTA_BYTES.to_vec(),
        })
    }

    pub(crate) fn set_quota_bytes(&self, quota_bytes: u64) -> Result<HistoryQuotaSettings, String> {
        validate_quota_bytes(quota_bytes)?;
        let path = self.quota_settings_path()?;
        let bytes = serde_json::to_vec(&QuotaSettings { quota_bytes })
            .map_err(|error| format!("序列化截图历史容量设置失败：{error}"))?;
        atomic_write_bytes(&path, &bytes, "保存截图历史容量设置")?;
        self.store
            .lock()
            .map_err(|_| "截图历史服务不可用".to_string())?
            .quota_bytes = quota_bytes;
        self.quota_settings()
    }

    /// 到截止时间后结算一次待删除区（后台线程，失败静默）。
    pub(crate) fn schedule_trash_settlement(&self, delete_after: u64) {
        let store = Arc::clone(&self.store);
        thread::spawn(move || {
            loop {
                let now = now_millis();
                if now >= delete_after {
                    break;
                }
                thread::sleep(Duration::from_millis(delete_after.saturating_sub(now)));
            }

            if let Ok(mut store) = store.lock() {
                let _ = store.settle_expired_trash(now_millis());
            }
        });
    }
}

/// 应用启动时初始化截图历史：建目录、恢复/清理、注册运行时状态，并安排待删除区结算。
pub fn initialize<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录：{error}"))?;
    let product_root = app_data.join("open-toolbox");
    let history_root = product_root.join(ROOT_DIR);
    let legacy_root = product_root.join("screenshots");
    let quota_bytes = load_quota_bytes(&product_root).unwrap_or(DEFAULT_QUOTA_BYTES);
    let mut store = HistoryStore::new(history_root, quota_bytes)?;
    store.initialize_and_recover(&legacy_root, now_millis())?;
    app.manage(HistoryRuntime::new(store));
    let history = app.state::<HistoryRuntime>();
    for deadline in history.active_trash_deadlines()? {
        history.schedule_trash_settlement(deadline);
    }
    Ok(())
}
