//! 贴图窗口创建与管理。
//!
//! `create_pin_window` 创建无边框透明置顶贴图窗口，复用主窗口的 WebView2 环境；
//! `initialize` 是应用启动入口（lib.rs 调用）。`PinCreateResult` 为窗口创建命令的
//! 返回 DTO。

use std::io::Cursor;
use std::sync::Arc;

use image::GenericImageView;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use super::aspect_size;
use super::registry::{pin_registry, PinRegistry, PinState};

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PinCreateResult {
    pub pin_id: String,
    pub label: String,
}

#[cfg(not(debug_assertions))]
const PIN_WINDOW_APP_ROUTE: &str = "pin.html";

/// 应用启动时初始化贴图注册表。
///
/// 原先还会后台建一个常驻隐藏窗口预热 WebView2——那是独立 data_directory 才需要的
/// （全新环境初始化慢）。改用主窗口环境后环境在应用启动时已就绪，首个贴图窗直接走
/// 热路径，预热窗连同它常驻的一整套 msedgewebview2 进程一并去掉。
pub fn initialize<R: Runtime>(_app: &AppHandle<R>) -> Arc<PinRegistry> {
    pin_registry()
}

pub(super) fn create_pin_window<R: Runtime>(
    app: &AppHandle<R>,
    image_png: Vec<u8>,
) -> Result<PinCreateResult, String> {
    let t0 = std::time::Instant::now();
    let (width, height) = decode_dimensions(&image_png)?;
    let registry = pin_registry();
    let state = registry.reserve(image_png, width, height)?;
    let (window_width, window_height) = aspect_size(width, height, state.zoom_percent);
    let pin_url = pin_window_url(app)?;
    log::debug!("[pin] create_pin_window: decode+reserve {:?}", t0.elapsed());

    let t_build = std::time::Instant::now();
    // 从 create_pin_window 入口到 page load 各事件的累计耗时（量化 WebView 启动）。
    let t_page = t_build;
    // 不设 data_directory：复用主窗口已就绪的 WebView2 环境。每个独立目录都会拉起
    // 一整套 msedgewebview2 进程组（探针实测 +6 进程 / +300MB 峰值），共享环境只多
    // 一个 renderer（+1 进程）。原注释称共享会导致引擎静默初始化失败（白窗、无
    // page-load 事件），经探针实测不成立：共享环境下窗口渲染与 page-load 均正常。
    let build_result = WebviewWindowBuilder::new(app, &state.label, pin_url)
        .on_page_load(move |_window, payload| {
            log::debug!(
                "[pin] page load {:?}: {} (+{:?} since create)",
                payload.event(),
                payload.url(),
                t_page.elapsed()
            );
        })
        .title("贴图")
        .inner_size(window_width as f64, window_height as f64)
        .min_inner_size(1.0, 1.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        // 窗口必须透明：页面加载前 WebView2 默认白底，是「白底矩形」的直接来源。
        // transparent(true) 让窗口透明，background_color 进一步把 WebView2 的
        // DefaultBackgroundColor 设为全透明（否则 WebView2 初始背景仍白）。
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        // 必须可见创建：WebView2 在隐藏窗口内创建会不渲染页面（onload 不触发、
        // show() 永不调用，导致窗口永久不可见）。白底由 transparent(true) 消除。
        .visible(true)
        .accept_first_mouse(true)
        .build();
    log::debug!("[pin] create_pin_window: build {:?}", t_build.elapsed());

    build_result.map_err(|error| {
        registry.remove(&state.pin_id);
        format!("创建贴图窗口失败：{error}")
    })?;

    let result = PinCreateResult {
        pin_id: state.pin_id,
        label: state.label,
    };
    crate::refresh_pin_tray(app);
    Ok(result)
}

fn pin_window_url<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let dev_url = app
            .config()
            .build
            .dev_url
            .as_ref()
            .ok_or_else(|| "贴图开发入口未配置".to_string())?
            .clone();
        // dev server 下加载精简入口 /pin.html（不经过完整 Vue 应用）。
        let url = format!("{}/pin.html", dev_url);
        let url = tauri::Url::parse(&url).map_err(|e| format!("贴图开发入口 URL 无效：{e}"))?;
        Ok(WebviewUrl::External(url))
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Ok(WebviewUrl::App(PIN_WINDOW_APP_ROUTE.into()))
    }
}

fn decode_dimensions(image_png: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(Cursor::new(image_png))
        .with_guessed_format()
        .map_err(|error| format!("识别贴图格式失败：{error}"))?;
    let image = reader
        .decode()
        .map_err(|error| format!("解码贴图失败：{error}"))?;
    let dimensions = image.dimensions();
    if dimensions.0 == 0 || dimensions.1 == 0 {
        return Err("贴图尺寸无效".to_string());
    }
    Ok(dimensions)
}

pub(super) fn resize_window_for_state<R: Runtime>(
    app: &AppHandle<R>,
    state: &PinState,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&state.label)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    let (width, height) = aspect_size(state.width, state.height, state.zoom_percent);
    window
        .set_size(LogicalSize::new(width as f64, height as f64))
        .map_err(|error| format!("调整贴图大小失败：{error}"))
}

#[cfg(test)]
#[cfg(not(debug_assertions))]
mod tests {
    use super::*;

    #[test]
    fn release_pin_window_uses_a_real_app_route() {
        assert_eq!(PIN_WINDOW_APP_ROUTE, "pin.html");
        assert!(!PIN_WINDOW_APP_ROUTE.contains('?'));
    }
}
