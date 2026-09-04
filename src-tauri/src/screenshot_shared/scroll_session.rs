//! 滚动截图（长截图）会话：拼接引擎 + Tauri 命令。
//!
//! 平台：仅 Windows（依赖 DXGI capture_region 与 scroll.rs 拼接工具）。
//! macOS/Linux 由子任务 E 提供同构命令。
//!
//! 交互模型（手动滚动）：工具**不自动发滚轮**，用户手动滚动页面，
//! HUD 定时调 `scroll_capture_next` 采集当前选区画面，检测到滚动位移后
//! 对齐拼接；用户点「停止」结束。到底检测由用户判断，不自动停止。
//!
//! 数据流：
//! - `scroll_capture_start(selection)`：首帧采集 → 初始化拼接缓冲。
//! - `scroll_capture_next()`（async）：采集 → 对齐 → 拼入 → 进度。
//! - `scroll_capture_stop()`：停止，返回拼接图访问 token。
//! - `scroll_capture_finish(action)`：history-first 完成事务。
//!
//! 滚动期间覆盖层（overlay）隐藏，避免采集到自身。

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::screenshot_shared::capture::{create_backend, OwnedBgraFrame};
use crate::screenshot_shared::scroll::{overlap_offset_debug, StitchBuffer};
use crate::screenshot_shared::types::PhysicalDesktopRectI32;

/// 重叠区模板行数（与 scroll.rs 的 overlap_offset 调用一致）。
/// 128 行模板：更独特的匹配特征，兼顾小滚动量（5-20px）的准确识别。
const OVERLAP_TEMPLATE_ROWS: u32 = 128;
/// 连续对齐失败多少次后重置基线为当前帧（防止长期卡在旧基线）。
const MAX_CONSECUTIVE_FAILURES: u32 = 5;

/// 一个进行中的滚动截图会话（手动滚动模式）。
struct ScrollSession {
    selection: PhysicalDesktopRectI32,
    stitched: StitchBuffer,
    last_frame: Option<OwnedBgraFrame>,
    /// 连续对齐失败次数（用于重置基线）。
    fail_count: u32,
    /// 持久化采集后端（复用打开的 DXGI 流，避免每次重建）。
    backend: Box<dyn crate::screenshot_shared::capture::CaptureBackend>,
}

impl ScrollSession {
    fn new(
        selection: PhysicalDesktopRectI32,
        backend: Box<dyn crate::screenshot_shared::capture::CaptureBackend>,
    ) -> Self {
        let width = selection.width().unwrap_or(0);
        let height = selection.height().unwrap_or(0);
        Self {
            selection,
            stitched: StitchBuffer::new(width, height),
            last_frame: None,
            fail_count: 0,
            backend,
        }
    }
}

static SCROLL_SESSION: OnceLock<Mutex<Option<ScrollSession>>> = OnceLock::new();

fn session_mutex() -> &'static Mutex<Option<ScrollSession>> {
    SCROLL_SESSION.get_or_init(|| Mutex::new(None))
}

/// 滚动截图完成后的结果（独立于会话，stop 后由 finish/publish 消费）。
struct ScrollResult {
    png: Vec<u8>,
    width: u32,
    height: u32,
    preview_token: String,
}

static SCROLL_RESULT: OnceLock<Mutex<Option<ScrollResult>>> = OnceLock::new();

fn result_mutex() -> &'static Mutex<Option<ScrollResult>> {
    SCROLL_RESULT.get_or_init(|| Mutex::new(None))
}

/// 首帧采集 + 初始化会话。
///
/// overlay 关闭后，第一张采集帧可能仍带残留的框选 UI（残影）。策略：
/// 连采两张帧，**丢弃第一张**，用第二张作基线；若两张内容一致（均干净）
/// 则基线即为稳定画面。无论哪张，都确保不是 overlay 刚关闭的过渡帧。
fn capture_first_frame(session: &mut ScrollSession) -> Result<(), String> {
    // 首帧：允许等待更久确保拿到初始画面。
    let first = wait_for_frame(session)?;
    // 丢弃第一张（可能是 overlay 残留帧），等桌面稳定后采第二张作基线。
    std::thread::sleep(std::time::Duration::from_millis(120));
    let baseline = wait_for_frame(session)?;
    let _ = first;
    session.stitched.push(&baseline, 0);
    session.last_frame = Some(baseline);
    Ok(())
}

/// 等待并返回一帧选区画面（持续重试直到拿到新帧）。
fn wait_for_frame(session: &mut ScrollSession) -> Result<OwnedBgraFrame, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2000);
    loop {
        if let Some(frame) = session
            .backend
            .capture_region_stream(session.selection)
            .map_err(|e| e.message)?
        {
            return Ok(frame);
        }
        if std::time::Instant::now() >= deadline {
            return Err("等待首帧超时".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
}

/// 采集当前画面并拼接（手动滚动模式：不自动发滚轮）。
///
/// 用户手动滚动页面，本函数定时采集选区画面；若与上一帧相比内容有变化
/// （滚动产生了位移），则对齐并拼入长图。返回是否拼接了新内容。
fn capture_next_chunk(session: &mut ScrollSession) -> Result<bool, String> {
    let t0 = std::time::Instant::now();
    let Some(frame) = session
        .backend
        .capture_region_stream(session.selection)
        .map_err(|e| e.message)?
    else {
        // 等待超时，无新内容：跳过本轮（不计失败、不重置基线）。
        return Ok(false);
    };
    let capture_ms = t0.elapsed().as_millis();

    // 首帧：直接作为基线，不拼接。
    if session.last_frame.is_none() {
        session.stitched.push(&frame, 0);
        session.last_frame = Some(frame);
        return Ok(false);
    }

    // 对齐：找新帧与上帧的重叠裁剪量。返回 None = 未滚动/无法对齐，保留基线。
    // 由前置校验保证：上面 is_none() 分支已 return，此处必有 last_frame（会话同一 Mutex 串行访问）。
    let prev = session.last_frame.as_ref().expect("已校验存在");
    // 计算内容差异度（诊断用）：中间几行的平均 SAD。
    let diff = frame_diff_score(prev, &frame);
    let align = overlap_offset_debug(prev, &frame, OVERLAP_TEMPLATE_ROWS);
    let Some((crop_top, best_s, best_ncc, ncc_at_zero)) = align else {
        // 尺寸异常，无候选。
        log::debug!("[scroll] 对齐失败：diff={:.4}（尺寸异常，无候选）", diff);
        session.fail_count += 1;
        reset_baseline_if_stale(session, &frame);
        return Ok(false);
    };
    if crop_top == 0 {
        // 相关度不足或内容没动。
        log::debug!("[scroll] 对齐失败：diff={:.4} best_s={} ncc={:.3} s0_ncc={:.3}（需 ≥0.5）",
            diff, best_s, best_ncc, ncc_at_zero);
        session.fail_count += 1;
        reset_baseline_if_stale(session, &frame);
        return Ok(false);
    }
    // 对齐成功：拼入新内容。
    session.fail_count = 0;
    session.stitched.push(&frame, crop_top);
    session.last_frame = Some(frame);
    log::debug!("[scroll] 拼接成功：crop_top={} 采集{}ms → 已拼 {}px", crop_top, capture_ms, session.stitched.height());
    Ok(true)
}

/// 连续对齐失败多次后，把基线重置为当前帧（防止长期卡在旧基线，
/// 例如用户快速滚动导致两帧无重叠，后续慢速滚动也能接上）。
fn reset_baseline_if_stale(session: &mut ScrollSession, frame: &OwnedBgraFrame) {
    if session.fail_count >= MAX_CONSECUTIVE_FAILURES {
        log::debug!("[scroll] 连续 {} 次对齐失败，重置基线为当前帧", session.fail_count);
        session.last_frame = Some(frame.clone());
        session.fail_count = 0;
    }
}

/// 计算两帧整体内容差异度（诊断用）：中间 8 行采样列的平均 SAD。
/// <0.02 表示内容几乎没变；大值表示发生了滚动/内容变化。
fn frame_diff_score(a: &OwnedBgraFrame, b: &OwnedBgraFrame) -> f64 {
    if a.width != b.width || a.height != b.height || a.width == 0 || a.height == 0 {
        return 1.0;
    }
    let width = a.width as usize;
    let rows = 8;
    let row_step = (a.height as usize / (rows + 1)).max(1);
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    for i in 1..=rows {
        let y = i * row_step;
        if y >= a.height as usize {
            continue;
        }
        let a_row = y * width * 4;
        let b_row = y * width * 4;
        for x in (0..width).step_by(8) {
            let a_off = a_row + x * 4;
            let b_off = b_row + x * 4;
            sum += (a.buffer[a_off] as i64 - b.buffer[b_off] as i64).unsigned_abs()
                + (a.buffer[a_off + 1] as i64 - b.buffer[b_off + 1] as i64).unsigned_abs()
                + (a.buffer[a_off + 2] as i64 - b.buffer[b_off + 2] as i64).unsigned_abs();
            count += 1;
        }
    }
    sum as f64 / (count.max(1) as f64 * 255.0)
}

// ---- Tauri 命令 ----

/// 滚动截图会话信息（start 返回）。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStartResult {
    pub session_id: String,
    pub stitched_height: u32,
}

/// 滚动进度（next 返回）。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScrollProgress {
    pub stitched_height: u32,
}

/// 开始滚动截图会话（async：创建 HUD 窗口需要与消息循环协调）。
#[tauri::command(async)]
#[specta::specta]
pub fn scroll_capture_start<R: Runtime>(
    app: AppHandle<R>,
    selection: PhysicalDesktopRectI32,
) -> Result<ScrollStartResult, AppError> {
    let mut guard = session_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    if guard.is_some() {
        return Err(AppError::Message("已有滚动截图会话进行中".to_string()));
    }

    if !selection.is_valid() {
        return Err(AppError::Message("选区无效".to_string()));
    }

    // 滚动前关闭覆盖层（overlay），并取走 universal 会话（避免后续误判会话进行中）。
    crate::screenshot_universal::take_active_session_for_scroll(&app);
    crate::screenshot_universal::overlay::close_all_overlay_windows(&app);
    // 等 overlay 窗口真正销毁（窗口关闭是异步的，立即采集会拍到残留的框选 UI）。
    wait_for_overlay_cleanup(&app);

    let backend = create_backend().map_err(|e| e.message)?;
    let mut session = ScrollSession::new(selection, backend);

    // 首帧采集（作为拼接基线）。
    capture_first_frame(&mut session)?;

    let session_id = format!("ss-{}", uuid::Uuid::new_v4());

    // 创建滚动 HUD 窗口（进度 + 停止）。
    let hud_label = format!("scroll-hud-{session_id}");
    create_hud_window(&app, &hud_label)?;

    let result = ScrollStartResult {
        session_id: session_id.clone(),
        stitched_height: session.stitched.height(),
    };
    *guard = Some(session);
    Ok(result)
}

/// 采集一步并拼接（async 避免阻塞主线程）。手动滚动模式：不自动滚动。
#[tauri::command(async)]
#[specta::specta]
pub fn scroll_capture_next<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ScrollProgress, AppError> {
    let mut guard = session_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "没有进行中的滚动截图会话".to_string())?;

    let _ = capture_next_chunk(session)?;
    let _ = app.emit("scroll_capture_progress", ());
    Ok(ScrollProgress {
        stitched_height: session.stitched.height(),
    })
}

/// 停止滚动截图会话，把拼接结果存入独立存储（与「会话进行中」解耦）。
#[tauri::command]
#[specta::specta]
pub fn scroll_capture_stop<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ScrollStopResult, AppError> {
    // 取出会话，生成拼接 PNG 结果。
    let stitched = {
        let mut guard = session_mutex()
            .lock()
            .map_err(|e| format!("会话锁不可用：{e}"))?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "没有进行中的滚动截图会话".to_string())?;
        session.stitched.to_frame()
    };
    // 拼接结果已克隆取出，立即释放会话（内含打开的 DXGI 采集流），
    // 否则后续 screenshot_universal_start 重建 DXGI 流会冲突失败。
    clear_scroll_session();
    let preview_token = format!("sp-{}", uuid::Uuid::new_v4());

    let png = encode_bgra_to_png(&stitched)?;
    let (width, height) = decode_png_dimensions(&png)?;

    // 存入结果存储（覆盖旧结果）。
    let mut result_guard = result_mutex()
        .lock()
        .map_err(|e| format!("结果锁不可用：{e}"))?;
    *result_guard = Some(ScrollResult {
        png,
        width,
        height,
        preview_token: preview_token.clone(),
    });

    // 恢复主窗口，展示长图结果页（前端 Component.vue 监听 finished 事件切换视图）。
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(ScrollStopResult {
        stitched_height: stitched.height,
        width,
        preview_token,
    })
}

/// 查询是否存在待展示的滚动截图结果（供主窗口恢复后主动获取）。
#[tauri::command]
#[specta::specta]
pub fn scroll_capture_has_result() -> Result<Option<String>, AppError> {
    let guard = result_mutex()
        .lock()
        .map_err(|e| format!("结果锁不可用：{e}"))?;
    Ok(guard.as_ref().map(|r| r.preview_token.clone()))
}

/// 停止返回。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScrollStopResult {
    pub stitched_height: u32,
    pub width: u32,
    /// scroll-image 协议访问 token（用于预览拼接长图）。
    pub preview_token: String,
}

/// 清理滚动会话（释放持 DXGI 采集流的 backend）。
///
/// 会话持有 `Box<dyn CaptureBackend>`（内含打开的 DXGI Duplication），
/// 若不释放，后续 `screenshot_universal_start` 重建 DXGI 流会冲突失败。
/// 必须在停止/取消/完成时调用。
fn clear_scroll_session() {
    if let Ok(mut guard) = session_mutex().lock() {
        guard.take(); // Drop 释放 backend（DXGI duplication）
    }
}

/// 等待覆盖层（overlay）窗口全部销毁。
///
/// 滚动截图启动时关闭 overlay，但窗口销毁是异步的；立即采集会拍到残留的
/// 框选 UI（残影）。轮询 `webview_windows()` 直到没有 `overlay-` 前缀窗口，
/// 再额外等待一段稳定时间（窗口对象移除后屏幕绘制清除还有延迟）。
fn wait_for_overlay_cleanup<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Manager;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    loop {
        let has_overlay = app
            .webview_windows()
            .keys()
            .any(|k| k.starts_with(crate::screenshot_universal::overlay::OVERLAY_LABEL_PREFIX));
        if !has_overlay || std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // 窗口对象移除后，屏幕上的 WebView 绘制清除还有延迟，再等一拍。
    std::thread::sleep(std::time::Duration::from_millis(150));
}

/// 完成滚动截图（history-first 事务）。
///
/// 拼接长图由后端从结果存储取用（长图可能超大，前端不传输），original 与
/// final 均为拼接长图。副作用（Copy/Pin/SaveAs）在历史发布成功后执行。
#[tauri::command(async)]
#[specta::specta]
pub fn scroll_capture_finish<R: Runtime>(
    app: AppHandle<R>,
    action: Option<crate::screenshot_universal::UniversalFinishAction>,
) -> Result<crate::screenshot_universal::ConfirmSelectionResult, AppError> {
    use crate::screenshot_shared::history::{
        HistoryImageVariant, HistoryRuntime, PublishHistoryRequest, HistorySource,
    };

    // 清理会话，释放 DXGI 采集流（避免下次截图冲突）。
    clear_scroll_session();

    // 从结果存储取出拼接长图。
    let mut result_guard = result_mutex()
        .lock()
        .map_err(|e| format!("结果锁不可用：{e}"))?;
    let result = result_guard
        .take()
        .ok_or_else(|| "没有滚动截图结果，请先停止滚动截图".to_string())?;
    let png = result.png;
    let width = result.width;
    let height = result.height;
    // 结果已取走，立即释放结果锁：后续 publish/对话框/建窗等副作用期间不应再持有。
    drop(result_guard);

    let artifact_id = format!("scroll:{}", uuid::Uuid::new_v4());
    let history = app
        .try_state::<HistoryRuntime>()
        .ok_or_else(|| "截图历史服务不可用".to_string())?;
    let manifest = history.publish(PublishHistoryRequest {
        artifact_id,
        original_png: png.clone(),
        final_png: png.clone(),
        width,
        height,
        source: HistorySource {
            kind: "scroll".to_string(),
            record_id: None,
            variant: None,
        },
    })?;
    let _ = app.emit("screenshot_history_changed", ());

    // 副作用（复用 universal 的 Copy/Pin/SaveAs）。
    let action = action.unwrap_or(crate::screenshot_universal::UniversalFinishAction::Copy);
    match action {
        crate::screenshot_universal::UniversalFinishAction::Copy => {
            copy_png_to_clipboard(&app, &png)?;
        }
        crate::screenshot_universal::UniversalFinishAction::Pin => {
            let history_state = app.state::<HistoryRuntime>();
            crate::screenshot_shared::pin::pin_create_from_history(
                app.clone(),
                history_state,
                manifest.record_id.clone(),
                HistoryImageVariant::Final,
            )?;
        }
        crate::screenshot_universal::UniversalFinishAction::SaveAs => {
            save_png_with_dialog(&app, &manifest.record_id, &png)?;
        }
    }

    Ok(crate::screenshot_universal::ConfirmSelectionResult { width, height })
}

/// 发布滚动截图到历史（不执行副作用），返回 record_id。
///
/// 供「保存」动作使用：先发布历史拿到 recordId，再走 `history_save_as`。
#[tauri::command]
#[specta::specta]
pub fn scroll_capture_publish<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ScrollPublishResult, AppError> {
    use crate::screenshot_shared::history::{HistoryRuntime, PublishHistoryRequest, HistorySource};

    // 清理会话，释放 DXGI 采集流（避免下次截图冲突）。
    clear_scroll_session();

    let mut result_guard = result_mutex()
        .lock()
        .map_err(|e| format!("结果锁不可用：{e}"))?;
    let result = result_guard
        .take()
        .ok_or_else(|| "没有滚动截图结果，请先停止滚动截图".to_string())?;
    let png = result.png;
    let width = result.width;
    let height = result.height;
    // 结果已取走，立即释放结果锁：后续 publish 期间不应再持有。
    drop(result_guard);

    let artifact_id = format!("scroll:{}", uuid::Uuid::new_v4());
    let history = app
        .try_state::<HistoryRuntime>()
        .ok_or_else(|| "截图历史服务不可用".to_string())?;
    let manifest = history.publish(PublishHistoryRequest {
        artifact_id,
        original_png: png.clone(),
        final_png: png.clone(),
        width,
        height,
        source: HistorySource {
            kind: "scroll".to_string(),
            record_id: None,
            variant: None,
        },
    })?;
    let _ = app.emit("screenshot_history_changed", ());
    Ok(ScrollPublishResult {
        record_id: manifest.record_id,
        width,
        height,
    })
}

/// publish 返回。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScrollPublishResult {
    pub record_id: String,
    pub width: u32,
    pub height: u32,
}

/// 取消滚动截图会话（放弃，不发布历史）。
#[tauri::command]
#[specta::specta]
pub fn scroll_capture_cancel<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), AppError> {
    let mut guard = session_mutex()
        .lock()
        .map_err(|e| format!("会话锁不可用：{e}"))?;
    guard.take();
    let mut result_guard = result_mutex()
        .lock()
        .map_err(|e| format!("结果锁不可用：{e}"))?;
    result_guard.take();
    // 关闭 HUD 窗口（若有）。
    use tauri::Manager;
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with(SCROLL_HUD_LABEL_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    Ok(())
}

/// 拼接 BGRA 帧编码为 PNG。
fn encode_bgra_to_png(frame: &OwnedBgraFrame) -> Result<Vec<u8>, String> {
    // BGRA → RGBA 通道交换后编码。
    let mut rgba = frame.buffer.clone();
    for px in rgba.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let img = image::RgbaImage::from_raw(frame.width, frame.height, rgba)
        .ok_or_else(|| "拼接帧像素数据无效".to_string())?;
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("编码拼接长图失败：{e}"))?;
    Ok(out)
}

fn decode_png_dimensions(png: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(std::io::Cursor::new(png))
        .with_guessed_format()
        .map_err(|e| format!("解析 PNG 格式失败：{e}"))?;
    let dims = reader
        .into_dimensions()
        .map_err(|e| format!("解析 PNG 尺寸失败：{e}"))?;
    Ok((dims.0, dims.1))
}

fn copy_png_to_clipboard<R: Runtime>(_app: &AppHandle<R>, png: &[u8]) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| format!("剪贴板图像解码失败：{e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = rgba.into_raw();
    let mut clipboard = Clipboard::new().map_err(|e| format!("剪贴板不可用：{e}"))?;
    clipboard
        .set_image(ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(data),
        })
        .map_err(|e| format!("写入剪贴板失败：{e}"))
}

fn save_png_with_dialog<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    png: &[u8],
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let selection = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(format!("scroll-{session_id}.png"))
        .blocking_save_file();
    let Some(selection) = selection else {
        return Ok(()); // 用户取消：不保存，但仍已完成历史发布
    };
    let path = selection
        .into_path()
        .map_err(|e| format!("保存路径无效：{e}"))?;
    crate::screenshot_shared::write_final_png(&path, png)
}

/// HUD 窗口 label 前缀。
pub const SCROLL_HUD_LABEL_PREFIX: &str = "scroll-hud-";

/// 创建滚动 HUD 小窗口（进度 + 停止）。
///
/// 仿 pin 窗口：无边框、透明、置顶。位置固定在屏幕右下角附近。
fn create_hud_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    // 主显示器尺寸（逻辑像素），把 HUD 放到左下角。
    // 左下角较少被截图选区覆盖，避免右下角常见于滚动画面的问题。
    // 底部余量 44px（继续下移 20px，接近屏幕底部）。
    let (_screen_w, screen_h) = primary_screen_logical(app).unwrap_or((1280.0, 720.0));
    let hud_w = 220.0;
    let hud_h = 130.0;
    let x = 4.0;
    let y = screen_h - hud_h - 44.0;

    let url = hud_window_url(app)?;
    WebviewWindowBuilder::new(app, label, url)
        .title("滚动截图")
        .position(x, y)
        .inner_size(hud_w, hud_h)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(true)
        .build()
        .map_err(|e| format!("创建滚动 HUD 窗口失败：{e}"))?;
    Ok(())
}

/// 获取主显示器逻辑像素尺寸（尽力；失败回退默认值）。
fn primary_screen_logical<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.size().width as f64, m.size().height as f64))
}

/// HUD 窗口 URL（复用主 App 入口，main.ts 按 label 路由到 ScrollHud.vue）。
fn hud_window_url<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let dev_url = app
            .config()
            .build
            .dev_url
            .as_ref()
            .ok_or_else(|| "滚动截图开发入口未配置".to_string())?
            .clone();
        Ok(tauri::WebviewUrl::External(dev_url))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Ok(tauri::WebviewUrl::App("index.html".into()))
    }
}

/// scroll-image 自定义协议 scheme。
pub const SCROLL_IMAGE_SCHEME: &str = "scroll-image";

/// 注册滚动截图拼接图协议。
///
/// 请求格式：`http://scroll-image.localhost/<preview_token>`，返回拼接长图
/// PNG。token 无效或结果不存在返回 404。
pub fn register_scroll_image_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    use tauri::http::{header::CONTENT_TYPE, Response, StatusCode};

    builder.register_uri_scheme_protocol(SCROLL_IMAGE_SCHEME, |_app, request| {
        // 由前置校验保证（内部不变量）：status 为合法常量、body 为空，body() 不会失败。
        let bad = |status| Response::builder().status(status).body(Vec::new()).unwrap();
        let mut segments = request.uri().path().trim_start_matches('/').split('/');
        let Some(token) = segments.next() else {
            return bad(StatusCode::BAD_REQUEST);
        };
        if segments.next().is_some() {
            return bad(StatusCode::BAD_REQUEST);
        }

        let Ok(guard) = result_mutex().lock() else {
            return bad(StatusCode::INTERNAL_SERVER_ERROR);
        };
        let Some(result) = guard.as_ref() else {
            return bad(StatusCode::NOT_FOUND);
        };
        if result.preview_token != token {
            return bad(StatusCode::NOT_FOUND);
        }
        // status/headers 均为合法值（CONTENT_TYPE 静态），body() 不会失败（同 bad 的约定）。
        Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "image/png")
            .body(result.png.clone())
            .unwrap()
    })
}
