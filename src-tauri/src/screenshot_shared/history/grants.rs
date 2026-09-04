//! 截图历史：图像访问令牌（ImageGrant）与按令牌读图。

use tauri::State;
use uuid::Uuid;

use super::*;

/// 一次性的图像访问授权：凭令牌读取对应记录的指定版本图像。
#[derive(Clone, Debug)]
pub(crate) struct ImageGrant {
    record_id: String,
    variant: ImageVariant,
}

impl HistoryRuntime {
    /// 为指定记录/版本签发一次性读取令牌。
    fn issue_image_grant(&self, record_id: &str, variant: ImageVariant) -> Result<String, String> {
        let token = Uuid::new_v4().to_string();
        let mut grants = self
            .image_grants
            .lock()
            .map_err(|_| "截图历史令牌服务不可用".to_string())?;
        grants.insert(
            token.clone(),
            ImageGrant {
                record_id: record_id.to_string(),
                variant,
            },
        );
        Ok(token)
    }
}

#[tauri::command]
#[specta::specta]
pub fn history_get_record(
    history: State<'_, HistoryRuntime>,
    record_id: String,
) -> Result<HistoryRecordDetail, AppError> {
    validate_opaque_id(&record_id, "record")?;
    let manifest = history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .get_manifest(&record_id)?;
    let original_token = history.issue_image_grant(&record_id, ImageVariant::Original)?;
    let final_token = history.issue_image_grant(&record_id, ImageVariant::Final)?;
    Ok(HistoryRecordDetail {
        manifest,
        original_token,
        final_token,
    })
}

#[tauri::command]
#[specta::specta]
pub fn history_read_image_token(
    history: State<'_, HistoryRuntime>,
    token: String,
) -> Result<Vec<u8>, AppError> {
    validate_opaque_id(&token, "image token")?;
    // 一次性令牌：读取即消费（take），防止令牌无限复用与 image_grants 表无限增长。
    let grant = history
        .image_grants
        .lock()
        .map_err(|_| "截图历史令牌服务不可用".to_string())?
        .remove(&token)
        .ok_or_else(|| "截图图像令牌无效或已过期".to_string())?;
    history
        .store
        .lock()
        .map_err(|_| "截图历史服务不可用".to_string())?
        .read_image(&grant.record_id, grant.variant)
        .map_err(AppError::Message)
}

/// 撤销某记录的全部令牌（删除/清空记录时调用）。
pub(crate) fn revoke_record_grants(history: &HistoryRuntime, record_id: &str) -> Result<(), String> {
    history
        .image_grants
        .lock()
        .map_err(|_| "截图历史令牌服务不可用".to_string())?
        .retain(|_, grant| grant.record_id != record_id);
    Ok(())
}
