use tauri::{AppHandle, Runtime, Webview};

fn guard_resident_caller<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let label = webview.label();
    if label == "main" || label == "mini-git" || label.starts_with("resident-") {
        Ok(())
    } else {
        Err("非法调用来源".into())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn resident_open<R: Runtime>(
    webview: Webview<R>,
    app: AppHandle<R>,
    tool_id: String,
) -> Result<(), String> {
    guard_resident_caller(&webview)?;
    super::open_resident_window(&app, &tool_id)
}

#[tauri::command]
#[specta::specta]
pub async fn resident_focus<R: Runtime>(
    webview: Webview<R>,
    app: AppHandle<R>,
    tool_id: String,
) -> Result<(), String> {
    guard_resident_caller(&webview)?;
    super::focus_resident_window(&app, &tool_id)
}
