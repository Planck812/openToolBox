//! 历史统计：模型与查询/清空命令。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime, State};

use crate::error::AppError;
use super::store::{write_history, TimerState};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 历史统计条目（追加型）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// "countdown" | "pomodoro"。
    pub kind: String,
    /// 本次时长（秒）。
    pub seconds: u64,
    /// 完成时刻（epoch 秒）。
    pub finished_at_epoch_secs: u64,
}

// ---------------------------------------------------------------------------
// 命令：历史
// ---------------------------------------------------------------------------

/// 获取历史统计。
#[tauri::command]
#[specta::specta]
pub fn timer_get_history(
    state: State<'_, TimerState>,
) -> Result<Vec<HistoryEntry>, AppError> {
    Ok(state.history.lock().unwrap().clone())
}

/// 清空历史统计。
#[tauri::command]
#[specta::specta]
pub fn timer_clear_history<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    write_history(&app, &[])?;
    *state.history.lock().unwrap() = Vec::new();
    Ok(())
}
