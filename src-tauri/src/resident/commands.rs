use tauri::{AppHandle, Runtime};

#[tauri::command]
#[specta::specta]
pub async fn resident_open<R: Runtime>(app: AppHandle<R>, tool_id: String) -> Result<(), String> {
    super::open_resident_window(&app, &tool_id)
}

#[tauri::command]
#[specta::specta]
pub async fn resident_focus<R: Runtime>(app: AppHandle<R>, tool_id: String) -> Result<(), String> {
    super::focus_resident_window(&app, &tool_id)
}
