//! 系统托盘菜单与贴图（pin）菜单管理。

use tauri::{Emitter, Manager};

use crate::log_to_test_file;

/// 显示并聚焦主窗口。
pub(crate) fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
    use tauri_plugin_autostart::ManagerExt;

    let always_on_top_checked = app
        .get_webview_window("main")
        .and_then(|window| window.is_always_on_top().ok())
        .unwrap_or(false);
    let autostart_checked = app.autolaunch().is_enabled().unwrap_or(false);

    let always_on_top_item = CheckMenuItemBuilder::new("置顶显示")
        .id("always_on_top")
        .checked(always_on_top_checked)
        .build(app)?;
    let autostart_item = CheckMenuItemBuilder::new("开机自启")
        .id("auto_start")
        .checked(autostart_checked)
        .build(app)?;
    let minimize_item = MenuItemBuilder::new("最小化").id("minimize").build(app)?;
    let restore_pins_item = MenuItemBuilder::new("恢复全部贴图交互")
        .id("restore_pins")
        .build(app)?;
    let close_pins_item = MenuItemBuilder::new("关闭全部贴图")
        .id("close_pins")
        .build(app)?;
    #[cfg(windows)]
    let sedentary_enabled_item = {
        use tauri_plugin_store::StoreExt;
        let enabled = app
            .store("sedentary.json")
            .ok()
            .and_then(|store| store.get("sedentary:config"))
            .and_then(|v| v.get("enabled").and_then(|e| e.as_bool()))
            .unwrap_or(true);
        CheckMenuItemBuilder::new("久坐提醒")
            .id("sedentary_enabled")
            .checked(enabled)
            .build(app)?
    };
    let shortcut_item = MenuItemBuilder::new("设置快捷键...")
        .id("shortcut")
        .build(app)?;
    let devtools_item = MenuItemBuilder::new("打开开发者工具")
        .id("devtools")
        .build(app)?;
    let quit_item = MenuItemBuilder::new("退出").id("quit").build(app)?;

    let mut menu = MenuBuilder::new(app)
        .item(&always_on_top_item)
        .item(&autostart_item)
        .separator()
        .item(&minimize_item)
        .item(&restore_pins_item)
        .item(&close_pins_item);
    #[cfg(windows)]
    {
        menu = menu.item(&sedentary_enabled_item);
    }

    let registry = app.state::<std::sync::Arc<crate::screenshot_shared::pin::PinRegistry>>();
    let tray_items = registry.tray_items().unwrap_or_else(|error| {
        log_to_test_file(&format!("could not build pin tray entries: {error}"));
        Vec::new()
    });
    let pin_entries = crate::screenshot_shared::pin::pin_tray_menu_entries(&tray_items);
    if !pin_entries.is_empty() {
        menu = menu.separator();
    }
    for entry in pin_entries {
        if let Some(restore_action_id) = entry.restore_action_id {
            let restore_item = MenuItemBuilder::new(format!("贴图 {}：恢复交互", entry.ordinal))
                .id(restore_action_id)
                .build(app)?;
            menu = menu.item(&restore_item);
        }
        let close_item = MenuItemBuilder::new(format!("关闭贴图 {}", entry.ordinal))
            .id(entry.close_action_id)
            .build(app)?;
        menu = menu.item(&close_item);
    }

    menu
        .item(&shortcut_item)
        .item(&devtools_item)
        .separator()
        .item(&quit_item)
        .build()
}

pub(crate) fn refresh_pin_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(tray) = app.tray_by_id("main_tray") else {
        return;
    };
    match build_tray_menu(app) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                log_to_test_file(&format!("could not refresh pin tray menu: {error}"));
            }
        }
        Err(error) => log_to_test_file(&format!("could not build pin tray menu: {error}")),
    }
}

fn handle_pin_tray_action<R: tauri::Runtime>(app: &tauri::AppHandle<R>, menu_id: &str) -> bool {
    use crate::screenshot_shared::pin::PinTrayAction;

    let Some(action) = crate::screenshot_shared::pin::parse_pin_tray_action(menu_id) else {
        return false;
    };
    let registry = app.state::<std::sync::Arc<crate::screenshot_shared::pin::PinRegistry>>();
    let result = match action {
        PinTrayAction::RestoreInteraction { pin_id } => {
            crate::screenshot_shared::pin::pin_set_click_through(app.clone(), registry, pin_id, false)
                .map(|_| ())
        }
        PinTrayAction::Close { pin_id } => {
            crate::screenshot_shared::pin::pin_close(app.clone(), registry, pin_id).map(|_| ())
        }
    };
    if let Err(error) = result {
        log_to_test_file(&format!("pin tray action failed: {error}"));
    }
    refresh_pin_tray(app);
    true
}

/// 创建快速唤起浮层窗口：无边框置顶小窗，默认隐藏；窗口唤起快捷键（Alt+Space）时显示。
pub(crate) fn create_quicklaunch_window(app: &mut tauri::App) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        app,
        "quicklaunch",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .inner_size(600.0, 160.0)
    .center()
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .title("open-toolbox 快速唤起")
    .build()
    .map_err(|error| format!("创建快速唤起窗口失败：{error}"))?;
    Ok(())
}

pub(crate) fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::{
        image::Image,
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let menu = build_tray_menu(app.handle())?;

    TrayIconBuilder::with_id("main_tray")
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .on_menu_event(move |app, event| {
            if handle_pin_tray_action(app, event.id.as_ref()) {
                return;
            }
            match event.id.as_ref() {
                "always_on_top" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let current = window.is_always_on_top().unwrap_or(false);
                        let _ = window.set_always_on_top(!current);
                        refresh_pin_tray(app);
                    }
                }
                "auto_start" => {
                    use tauri_plugin_autostart::ManagerExt;
                    let current = app.autolaunch().is_enabled().unwrap_or(false);
                    let result = if current {
                        app.autolaunch().disable()
                    } else {
                        app.autolaunch().enable()
                    };
                    if result.is_ok() {
                        refresh_pin_tray(app);
                    }
                }
                #[cfg(windows)]
                "sedentary_enabled" => {
                    let state = app.state::<crate::sedentary::SedentaryState>();
                    let current = state.is_enabled();
                    if let Err(error) = crate::sedentary::sedentary_toggle(
                        app.clone(),
                        app.state::<crate::sedentary::SedentaryState>(),
                        !current,
                    ) {
                        log_to_test_file(&format!("toggle sedentary failed: {error}"));
                    }
                    refresh_pin_tray(app);
                }
                "minimize" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "restore_pins" => {
                    let registry =
                        app.state::<std::sync::Arc<crate::screenshot_shared::pin::PinRegistry>>();
                    if let Err(error) =
                        crate::screenshot_shared::pin::pin_enable_all_interaction(app.clone(), registry)
                    {
                        log_to_test_file(&format!("restore pin interaction failed: {error}"));
                    }
                    refresh_pin_tray(app);
                }
                "close_pins" => {
                    let registry =
                        app.state::<std::sync::Arc<crate::screenshot_shared::pin::PinRegistry>>();
                    if let Err(error) = crate::screenshot_shared::pin::pin_close_all(app.clone(), registry)
                    {
                        log_to_test_file(&format!("close all pins failed: {error}"));
                    }
                    refresh_pin_tray(app);
                }
                "shortcut" => {
                    show_main_window(app);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("open_shortcut_settings", ());
                    }
                }
                "devtools" => {
                    show_main_window(app);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("show_diagnostics", ());
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
