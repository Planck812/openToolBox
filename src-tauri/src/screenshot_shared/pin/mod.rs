//! 贴图（pin）模块：贴图注册表、贴图窗口、图片协议与全部 IPC 命令。
//!
//! 结构：`registry`（注册表核心与状态 DTO）、`window`（窗口创建/管理）、`protocol`
//! （图片 URI scheme 协议）、`commands`（全部 `#[tauri::command]`）拆为子模块。
//! 本模块保留跨子模块共享的数学/校验辅助函数与 `cleanup_window_label` 入口，并经
//! `pub use` 维持原有对外 API（含 Tauri 命令的隐藏 `__cmd__<name>` 宏，lib.rs 的
//! `generate_handler!` 按 `screenshot_shared::pin::__cmd__<name>` 路径解析）。

mod commands;
mod protocol;
mod registry;
mod window;

#[allow(unused_imports)]
pub use commands::{
    pin_close, pin_close_all, pin_create_from_history, pin_enable_all_interaction,
    pin_get_state, pin_list, pin_read_image, pin_reset, pin_set_click_through,
    pin_set_flip, pin_set_group, pin_set_opacity, pin_set_rotation, pin_set_zoom,
    pin_start_drag,
    __cmd__pin_close, __cmd__pin_close_all, __cmd__pin_create_from_history,
    __cmd__pin_enable_all_interaction, __cmd__pin_get_state, __cmd__pin_list,
    __cmd__pin_read_image, __cmd__pin_reset, __cmd__pin_set_click_through,
    __cmd__pin_set_flip, __cmd__pin_set_group, __cmd__pin_set_opacity,
    __cmd__pin_set_rotation, __cmd__pin_set_zoom, __cmd__pin_start_drag,
    __specta__fn__pin_close, __specta__fn__pin_close_all, __specta__fn__pin_create_from_history,
    __specta__fn__pin_enable_all_interaction, __specta__fn__pin_get_state,
    __specta__fn__pin_list, __specta__fn__pin_read_image, __specta__fn__pin_reset,
    __specta__fn__pin_set_click_through, __specta__fn__pin_set_flip,
    __specta__fn__pin_set_group, __specta__fn__pin_set_opacity,
    __specta__fn__pin_set_rotation, __specta__fn__pin_set_zoom, __specta__fn__pin_start_drag,
};
pub use protocol::register_image_protocol;
#[allow(unused_imports)]
pub use registry::{PinRegistry, PinState, PinTrayItem};
#[allow(unused_imports)]
pub use window::{initialize, PinCreateResult};

#[allow(unused_imports)]
pub(crate) use commands::{
    parse_pin_tray_action, pin_tray_menu_entries, PinTrayAction, PinTrayMenuEntry,
};

use uuid::Uuid;

pub const ZOOM_MIN_PERCENT: u16 = 20;
pub const ZOOM_MAX_PERCENT: u16 = 500;
pub const OPACITY_MIN_PERCENT: u8 = 20;
pub const OPACITY_MAX_PERCENT: u8 = 100;
const MAX_INITIAL_WIDTH: u32 = 1200;
const MAX_INITIAL_HEIGHT: u32 = 800;

pub fn clamp_zoom(zoom_percent: u16) -> u16 {
    zoom_percent.clamp(ZOOM_MIN_PERCENT, ZOOM_MAX_PERCENT)
}

pub fn aspect_size(width: u32, height: u32, zoom_percent: u16) -> (u32, u32) {
    let zoom = u64::from(clamp_zoom(zoom_percent));
    let scaled_width = (u64::from(width).saturating_mul(zoom) + 50) / 100;
    let scaled_height = (u64::from(height).saturating_mul(zoom) + 50) / 100;
    (
        scaled_width.clamp(1, u64::from(u32::MAX)) as u32,
        scaled_height.clamp(1, u64::from(u32::MAX)) as u32,
    )
}

fn initial_zoom_percent(width: u32, height: u32) -> u16 {
    let width_scale = u64::from(MAX_INITIAL_WIDTH).saturating_mul(100) / u64::from(width.max(1));
    let height_scale = u64::from(MAX_INITIAL_HEIGHT).saturating_mul(100) / u64::from(height.max(1));
    clamp_zoom(width_scale.min(height_scale).min(100) as u16)
}

fn validate_pin_id(pin_id: &str) -> Result<(), String> {
    Uuid::parse_str(pin_id)
        .map(|_| ())
        .map_err(|_| "贴图 ID 无效".to_string())
}

pub fn cleanup_window_label(label: &str) {
    let Some(pin_id) = label.strip_prefix("pin-") else {
        return;
    };
    if validate_pin_id(pin_id).is_err() {
        return;
    }
    if let Some(registry) = registry::PIN_REGISTRY.get() {
        if registry.remove(pin_id) {
            if let Some(app) = crate::screenshot_shared::app_handle() {
                crate::refresh_pin_tray(app);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_clamps_and_preserves_aspect_size() {
        assert_eq!(clamp_zoom(1), ZOOM_MIN_PERCENT);
        assert_eq!(clamp_zoom(999), ZOOM_MAX_PERCENT);
        assert_eq!(aspect_size(400, 200, 150), (600, 300));
        assert_eq!(aspect_size(400, 200, 1), (80, 40));
        assert_eq!(aspect_size(400, 200, 999), (2000, 1000));
    }
}
