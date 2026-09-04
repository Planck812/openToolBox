//! 倒计时预设：模型、命令与默认命名。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Runtime, State};

use crate::error::AppError;
use super::store::{read_presets, write_presets, TimerState};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 倒计时预设（内置 + 用户自定义）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct CountdownPreset {
    pub id: String,
    pub seconds: u64,
    pub name: String,
}

// ---------------------------------------------------------------------------
// 命令：预设
// ---------------------------------------------------------------------------

/// 获取倒计时预设（含内置）。
#[tauri::command]
#[specta::specta]
pub fn timer_get_presets<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
) -> Result<Vec<CountdownPreset>, AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    read_presets(&app).map_err(AppError::Message)
}

/// 新增自定义预设。
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn timer_add_preset<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    seconds: u64,
    name: Option<String>,
) -> Result<CountdownPreset, AppError> {
    if seconds == 0 {
        return Err(AppError::Message("预设时长必须大于 0 秒".to_string()));
    }
    let preset = CountdownPreset {
        id: format!("preset-{}", uuid::Uuid::new_v4()),
        seconds,
        name: name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format_preset_default_name(seconds)),
    };
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let mut presets = read_presets(&app)?;
    presets.push(preset.clone());
    write_presets(&app, &presets)?;
    *state.presets.lock().unwrap() = presets;
    Ok(preset)
}

/// 删除自定义预设。
#[tauri::command]
#[specta::specta]
pub fn timer_remove_preset<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TimerState>,
    id: String,
) -> Result<(), AppError> {
    let _guard = state
        .store_lock
        .lock()
        .map_err(|_| "计时 store 锁获取失败".to_string())?;
    let presets = read_presets(&app)?;
    let remaining: Vec<CountdownPreset> = presets.into_iter().filter(|p| p.id != id).collect();
    write_presets(&app, &remaining)?;
    *state.presets.lock().unwrap() = remaining;
    Ok(())
}

fn format_preset_default_name(seconds: u64) -> String {
    if seconds < 60 {
        format!("{seconds} 秒")
    } else if seconds.is_multiple_of(3600) {
        format!("{} 小时", seconds / 3600)
    } else if seconds.is_multiple_of(60) {
        format!("{} 分钟", seconds / 60)
    } else {
        format!("{} 分钟 {} 秒", seconds / 60, seconds % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_default_name() {
        assert_eq!(format_preset_default_name(90), "1 分钟 30 秒");
        assert_eq!(format_preset_default_name(3600), "1 小时");
        assert_eq!(format_preset_default_name(1500), "25 分钟");
        assert_eq!(format_preset_default_name(45), "45 秒");
    }
}
