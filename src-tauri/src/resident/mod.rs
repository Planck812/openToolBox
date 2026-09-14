pub mod commands;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub fn resident_window_label(tool_id: &str) -> String {
    format!("resident-{}", tool_id)
}

pub fn open_resident_window<R: Runtime>(app: &AppHandle<R>, tool_id: &str) -> Result<(), String> {
    let label = if tool_id == "mini-git" {
        "mini-git".to_string()
    } else {
        resident_window_label(tool_id)
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let url_str = if tool_id == "mini-git" {
        "mini-git.html"
    } else {
        "index.html"
    };

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url_str.into()))
        .title("Mini-Git")
        .inner_size(1400.0, 900.0)
        .min_inner_size(1000.0, 600.0)
        .decorations(false)
        .skip_taskbar(false)
        .always_on_top(false)
        .resizable(true)
        .maximizable(true);

    let window = builder.build().map_err(|e| format!("Failed to create resident window: {}", e))?;

    // 屏幕适配：根据工作区自动缩放并居中，防止小屏笔记本上贴边/溢出 (B-6 #3)
    crate::fit_window_to_screen(&window, 1000.0, 600.0);

    // 关闭拦截统一由 lib.rs:761 全局 WindowEvent::CloseRequested 处理，此处不再重复注册 (B-6 #2)
    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

pub fn focus_resident_window<R: Runtime>(app: &AppHandle<R>, tool_id: &str) -> Result<(), String> {
    let label = if tool_id == "mini-git" {
        "mini-git".to_string()
    } else {
        resident_window_label(tool_id)
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        Ok(())
    } else {
        open_resident_window(app, tool_id)
    }
}
