//! OCR 文本识别模块。
//!
//! 基于 `tesseract-rs`（`build-tesseract` feature 静态编译，零系统依赖）：
//! - 引擎首次使用时初始化（加载 LSTM 模型，秒级），之后复用（识别百毫秒级）。
//! - 同步阻塞调用经 `tauri::async_runtime::spawn_blocking` 放到线程池，不占 UI 线程。
//! - 语言包 tessdata（chi_sim + eng）随应用打包（bundle.resources），运行时经
//!   `app.path().resource_dir()` 定位；dev 模式回退到 `src-tauri/tessdata/`。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tauri::Manager;
use tesseract_rs::TesseractAPI;

use crate::error::AppError;

/// 大图降采样阈值（长边超过此值的图片先缩放，避免 Tesseract 内存峰值）。
const MAX_DIMENSION: u32 = 4096;

/// OCR 引擎全局状态（经 `app.manage` 注入）。
/// OCR 模式：`fast`（快速） / `best`（精准，默认）。
pub const MODE_BEST: &str = "best";
pub const MODE_FAST: &str = "fast";

pub struct OcrState {
    /// 引擎实例缓存：按模式（`best`/`fast`）缓存，首次初始化后复用。
    /// `HashMap` 而非单个 `Option`：两种模式可并行缓存，切换时无需重新初始化。
    /// 每个引擎实例再用 `Mutex` 保护：Tesseract 的 `TessBaseAPI` 非线程安全，
    /// 并发识别必须串行化（同一实例被多线程同时操作属未定义行为）。
    engines: Mutex<std::collections::HashMap<String, Arc<Mutex<TesseractAPI>>>>,
}

impl OcrState {
    pub fn new() -> Self {
        Self {
            engines: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

/// 单行识别结果（本期仅返回整段文本 + 平均置信度，行级信息预留）。
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub confidence: f32,
    pub bbox: Option<[i32; 4]>,
}

/// OCR 识别结果。
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub lines: Vec<OcrLine>,
    pub avg_confidence: f32,
}

/// 规范化 Windows 路径：去掉 `\\?\` 长路径前缀。
///
/// `tauri::path().resolve()` 在 Windows 返回 `\\?\C:\...` 格式（Win32 长路径），
/// 但 Tesseract 不识别该前缀，导致找不到 tessdata 文件。转回普通绝对路径。
fn normalize_tessdata_path(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(s) = p.to_str() {
            if let Some(rest) = s.strip_prefix(r"\\?\") {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

/// 定位 tessdata 目录：
/// - 生产：`$RESOURCE/<mode_dir>`（best → `tessdata`；fast → `tessdata_fast`）。
/// - dev 兜底：`src-tauri/<mode_dir>`。
/// - 最后兜底：`TESSDATA_PREFIX` 环境变量（Tesseract 官方约定）。
fn resolve_tessdata_dir(app: &tauri::AppHandle, mode: &str) -> Result<PathBuf, String> {
    // 模式对应的目录名：best → tessdata，fast → tessdata_fast。
    let subdir = if mode == MODE_FAST { "tessdata_fast" } else { "tessdata" };
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1) bundle.resources 定位（dev 模式 = exe 目录；生产 = 安装目录）。
    match app.path().resolve(subdir, tauri::path::BaseDirectory::Resource) {
        Ok(p) => candidates.push(normalize_tessdata_path(p)),
        Err(e) => log::warn!("[ocr] resolve tessdata({subdir}) failed: {e}"),
    }
    // 2) dev 兜底：源码 src-tauri/<subdir>。
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(subdir));
    // 3) TESSDATA_PREFIX 环境变量。
    if let Ok(prefix) = std::env::var("TESSDATA_PREFIX") {
        candidates.push(normalize_tessdata_path(PathBuf::from(prefix)));
    }

    for c in &candidates {
        if c.join("chi_sim.traineddata").exists() && c.join("eng.traineddata").exists() {
            log::info!("[ocr] mode={mode} using tessdata at {}", c.display());
            return Ok(c.clone());
        }
    }

    let tried: Vec<String> = candidates.iter().map(|c| c.display().to_string()).collect();
    Err(format!(
        "未找到 tessdata（{subdir}，chi_sim/eng），已检查：{}",
        tried.join("; ")
    ))
}

/// 初始化引擎（在 spawn_blocking 线程内执行，加载 LSTM 模型耗时秒级）。
fn init_engine(tessdata_dir: &PathBuf) -> Result<Arc<TesseractAPI>, String> {
    let api = TesseractAPI::new();
    api.init(tessdata_dir, "chi_sim+eng")
        .map_err(|e| format!("Tesseract 初始化失败：{e}"))?;
    Ok(Arc::new(api))
}

/// 将 PNG 字节解码为灰度像素（image 0.25），并做 OCR 预处理。
///
/// 预处理管线（提升识别率）：
/// 1. 大图降采样（> MAX_DIMENSION）避免内存峰值；
/// 2. 小图放大：目标短边至少 MIN_SHORT_EDGE（Tesseract 对足够大的字识别更好）；
/// 3. 对比度增强：灰度直方图线性拉伸，提高文字/背景区分度。
fn decode_to_luma(png: &[u8]) -> Result<(Vec<u8>, i32, i32), String> {
    let img = image::load_from_memory(png).map_err(|e| format!("图片解码失败：{e}"))?;

    // 1) 大图降采样，避免 Tesseract 内存峰值。
    let img = if img.width() > MAX_DIMENSION || img.height() > MAX_DIMENSION {
        let scale = MAX_DIMENSION as f32 / img.width().max(img.height()) as f32;
        let (w, h) = (
            (img.width() as f32 * scale).max(1.0) as u32,
            (img.height() as f32 * scale).max(1.0) as u32,
        );
        img.resize(w, h, image::imageops::FilterType::Triangle)
    } else {
        img
    };

    // 2) 小图放大：目标短边至少 MIN_SHORT_EDGE 像素（小字放大后识别率显著提升）。
    let img = {
        let short_edge = img.width().min(img.height());
        if short_edge < MIN_SHORT_EDGE {
            let scale = MIN_SHORT_EDGE as f32 / short_edge.max(1) as f32;
            let (w, h) = (
                (img.width() as f32 * scale).max(1.0) as u32,
                (img.height() as f32 * scale).max(1.0) as u32,
            );
            img.resize(w, h, image::imageops::FilterType::Lanczos3)
        } else {
            img
        }
    };

    let gray = img.to_luma8();

    // 3) 对比度增强：线性拉伸直方图（去掉 1% 边缘，拉伸到 0-255）。
    let gray = enhance_contrast(&gray);

    let (w, h) = (gray.width() as i32, gray.height() as i32);
    Ok((gray.into_raw(), w, h))
}

/// 小图放大目标短边（px）：低于此值放大，Tesseract 对足够大的字识别率更高。
const MIN_SHORT_EDGE: u32 = 120;

/// 对比度增强：灰度直方图 1%/99% 分位线性拉伸到 [0,255]。
fn enhance_contrast(gray: &image::GrayImage) -> image::GrayImage {
    // 统计直方图。
    let mut hist = [0u32; 256];
    for p in gray.as_raw() {
        hist[*p as usize] += 1;
    }
    // 找 1% 和 99% 分位。
    let total = gray.len() as f64;
    let lo_target = total * 0.01;
    let hi_target = total * 0.99;
    let mut acc = 0u64;
    let mut lo = 0u8;
    for (v, count) in hist.iter().enumerate() {
        acc += *count as u64;
        if acc as f64 >= lo_target {
            lo = v as u8;
            break;
        }
    }
    acc = 0;
    let mut hi = 255u8;
    for (v, count) in hist.iter().enumerate() {
        acc += *count as u64;
        if acc as f64 >= hi_target {
            hi = v as u8;
            break;
        }
    }
    // 若分位差太小（已是对比度高的图），直接返回。
    let range = hi.saturating_sub(lo);
    if range < 40 {
        return gray.clone();
    }

    let mut out = image::GrayImage::new(gray.width(), gray.height());
    for (dst, src) in out.as_mut().iter_mut().zip(gray.as_raw().iter()) {
        let v = *src as f32;
        let normalized = (v - lo as f32) / range as f32;
        *dst = (normalized.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    out
}

/// 根据图像宽高比选择最合适的版面分析模式（PSM），提升识别率。
///
/// 阈值刻意保守：`SINGLE_LINE` 只在极扁时使用（误判会把多行切成一字一行），
/// 绝大多数场景走 `AUTO`（多行/中文混排最可靠）。
///
/// - 极扁（宽 ≥ 15×高）：几乎确定是单行 → `SINGLE_LINE`
/// - 极高（高 ≥ 10×宽）：几乎确定是单列 → `SINGLE_COLUMN`
/// - 其他：`AUTO` 自动分析（多行文字、对话、列表最稳）
fn select_psm(w: i32, h: i32) -> tesseract_rs::TessPageSegMode {
    let ratio = if h > 0 { w as f32 / h as f32 } else { 0.0 };
    if ratio >= 15.0 {
        // 极扁：单行（如状态栏、标题条）。
        tesseract_rs::TessPageSegMode::PSM_SINGLE_LINE
    } else if ratio <= 0.1 {
        // 极高：单列（如竖排列表）。
        tesseract_rs::TessPageSegMode::PSM_SINGLE_COLUMN
    } else {
        tesseract_rs::TessPageSegMode::PSM_AUTO
    }
}

/// 判断字符是否为 CJK（中日韩）统一表意文字。
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF   // CJK 统一表意文字
        | 0x3400..=0x4DBF // CJK 扩展 A
        | 0xF900..=0xFAFF // CJK 兼容表意文字
    )
}

/// 清理中文识别结果中的字间空格。
///
/// `tessdata_best` 的 chi_sim 模型对紧凑中文会输出字间空格（如「第 一 行」），
/// fast 模型不会。中文文本中字间不应有空格，删除 CJK 字符之间的空格是安全的。
/// 英文单词间的空格（如 "Hello World"）不受影响。
fn cleanup_chinese_spaces(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (i, c) in chars.iter().enumerate() {
        if *c == ' ' {
            // 空格：仅当两侧都是 CJK 时删除（中文字间空格）。
            let prev_is_cjk = i > 0 && is_cjk(chars[i - 1]);
            let next_is_cjk = i + 1 < chars.len() && is_cjk(chars[i + 1]);
            if prev_is_cjk && next_is_cjk {
                continue; // 跳过中文之间的空格
            }
        }
        out.push(*c);
    }
    out
}

/// 对灰度像素执行 OCR。
///
/// 引擎实例经 `Mutex` 保护：整个识别过程持有锁，保证同一实例串行访问
/// （Tesseract 的 `TessBaseAPI` 非线程安全，并发操作属未定义行为）。
fn run_ocr(api: &Mutex<TesseractAPI>, png: &[u8]) -> Result<OcrResult, String> {
    let guard = api
        .lock()
        .map_err(|e| format!("OCR 引擎锁等待失败：{e}"))?;
    run_ocr_locked(&guard, png)
}

/// 持有引擎锁后的实际识别逻辑（纯逻辑，便于测试）。
fn run_ocr_locked(api: &TesseractAPI, png: &[u8]) -> Result<OcrResult, String> {
    let (luma, w, h) = decode_to_luma(png)?;
    api.set_image(&luma, w, h, 1, w)
        .map_err(|e| format!("设置图像失败：{e}"))?;
    // PSM 自适应：按宽高比选单行/单列/自动，替代固定 AUTO。
    let psm = select_psm(w, h);
    api.set_page_seg_mode(psm)
        .map_err(|e| format!("设置版面模式失败：{e}"))?;
    let text = api.get_utf8_text().map_err(|e| format!("OCR 识别失败：{e}"))?;
    let conf = api.mean_text_conf().unwrap_or(0) as f32;

    // best 模型可能输出中文字间空格，清理之。
    let cleaned = cleanup_chinese_spaces(&text);
    let trimmed = cleaned.trim().to_string();
    let lines = if trimmed.is_empty() {
        Vec::new()
    } else {
        vec![OcrLine {
            text: trimmed.clone(),
            confidence: conf,
            bbox: None,
        }]
    };

    Ok(OcrResult {
        text: trimmed,
        lines,
        avg_confidence: conf,
    })
}

/// 获取指定模式的引擎实例：已初始化则复用，否则初始化后缓存。
///
/// 采用 double-checked：先查表；未命中则**释放锁**后执行秒级 LSTM 加载，
/// 再重新抢锁写回。避免持有全局 engines 表锁期间阻塞其它模式的识别请求。
fn get_or_init_engine(
    app: &tauri::AppHandle,
    mode: &str,
) -> Result<Arc<Mutex<TesseractAPI>>, String> {
    let state = app.state::<OcrState>();
    {
        let guard = state
            .engines
            .lock()
            .map_err(|e| format!("OCR 引擎锁失败：{e}"))?;
        if let Some(api) = guard.get(mode) {
            return Ok(api.clone());
        }
    }

    // 释放锁后做慢初始化（加载 LSTM 模型，秒级）。
    let tessdata_dir = resolve_tessdata_dir(app, mode)?;
    let api = init_engine(&tessdata_dir)?;
    // init_engine 返回 Arc<TesseractAPI> 且此处无其他引用，try_unwrap 必成功；
    // 解包取得所有权后再包进 Mutex，供并发识别串行访问。
    let api = Arc::try_unwrap(api).map_err(|_| "OCR 引擎初始化 Arc 仍有引用".to_string())?;
    let api = Arc::new(Mutex::new(api));

    // 重新抢锁写回；若并发初始化抢先完成，直接复用已存在的实例。
    let mut guard = state
        .engines
        .lock()
        .map_err(|e| format!("OCR 引擎锁失败：{e}"))?;
    if let Some(existing) = guard.get(mode) {
        return Ok(existing.clone());
    }
    guard.insert(mode.to_string(), api.clone());
    Ok(api)
}

/// OCR 识别 PNG 图片（截图选区 / 独立工具共用）。
///
/// `mode`：`best`（精准，默认）或 `fast`（快速）。两种模式的引擎分别缓存。
///
/// 异步命令：同步阻塞的引擎初始化与识别都经 `spawn_blocking` 放到线程池，
/// 避免冻结 UI 线程。
#[tauri::command]
#[specta::specta]
pub async fn ocr_recognize_png(
    app: tauri::AppHandle,
    png: Vec<u8>,
    mode: Option<String>,
) -> Result<OcrResult, AppError> {
    let start_time = std::time::Instant::now();
    let mode = mode.as_deref().unwrap_or(MODE_BEST);
    log::info!("[ocr] recognition started: mode={} imageSize={}", mode, png.len());

    // 引擎获取 + 识别都在阻塞线程池执行（AppHandle 可 move 进闭包，State 在闭包内取）。
    let app_clone = app.clone();
    let mode_owned = mode.to_string();

    let engine_start = std::time::Instant::now();
    let engine = tauri::async_runtime::spawn_blocking(move || {
        get_or_init_engine(&app_clone, &mode_owned)
    })
    .await
    .map_err(|e| format!("引擎初始化线程失败：{e}"))??;

    let engine_duration = engine_start.elapsed();
    if engine_duration.as_millis() > 100 {
        log::debug!("[ocr] engine acquired: mode={} duration={}ms", mode, engine_duration.as_millis());
    }

    let ocr_start = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || run_ocr(&engine, &png))
        .await
        .map_err(|e| format!("OCR 执行线程失败：{e}"))?
        .map_err(AppError::Message)?;

    let ocr_duration = ocr_start.elapsed();
    let total_duration = start_time.elapsed();

    log::info!("[ocr] recognition completed: mode={} text_length={} confidence={:.1}% ocr_duration={}ms total_duration={}ms",
        mode, result.text.len(), result.avg_confidence, ocr_duration.as_millis(), total_duration.as_millis());

    if total_duration.as_millis() > 3000 {
        log::warn!("[ocr] slow recognition: mode={} total={}ms", mode, total_duration.as_millis());
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_removes_chinese_internal_spaces() {
        // best 模型的字间空格应被删除。
        assert_eq!(cleanup_chinese_spaces("第 一 行文 字 内 容"), "第一行文字内容");
        assert_eq!(cleanup_chinese_spaces("中文 识别"), "中文识别");
    }

    #[test]
    fn cleanup_keeps_english_word_spaces() {
        // 英文单词间空格必须保留。
        assert_eq!(cleanup_chinese_spaces("Hello World"), "Hello World");
        // 中文与英文之间（非 CJK+CJK）的空格也保留。
        assert_eq!(cleanup_chinese_spaces("你好 World 世界"), "你好 World 世界");
        // 混合：中文之间的空格删，中文-英文之间保留。
        assert_eq!(cleanup_chinese_spaces("中文 识别 OCR 测试"), "中文识别 OCR 测试");
    }

    #[test]
    fn normalize_removes_win_long_path_prefix() {
        // `\\?\C:\...` → `C:\...`（Tesseract 不识别长路径前缀）。
        let p = PathBuf::from(r"\\?\C:\Users\dev\cargo-target\debug\tessdata");
        let n = normalize_tessdata_path(p);
        assert_eq!(n.to_str().unwrap(), r"C:\Users\dev\cargo-target\debug\tessdata");
    }

    #[test]
    fn normalize_keeps_normal_path() {
        let p = PathBuf::from(r"C:\Users\dev\cargo-target\debug\tessdata");
        let n = normalize_tessdata_path(p);
        assert_eq!(n.to_str().unwrap(), r"C:\Users\dev\cargo-target\debug\tessdata");
    }

    /// 构造一张纯色 PNG（image 编码）。
    fn make_png(width: u32, height: u32, color: [u8; 3]) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(width, height, image::Rgb(color));
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn decode_to_luma_returns_correct_dimensions() {
        // 短边 ≥ MIN_SHORT_EDGE：不放大，尺寸保持。
        let png = make_png(200, 150, [200, 100, 50]);
        let (luma, w, h) = decode_to_luma(&png).unwrap();
        assert_eq!(w, 200);
        assert_eq!(h, 150);
        // 灰度：luma 长度 = 宽*高（bytes_per_pixel=1）
        assert_eq!(luma.len(), (200 * 150) as usize);
    }

    #[test]
    fn decode_to_luma_upscales_small_image() {
        // 短边 < MIN_SHORT_EDGE（120）：放大到短边=120。
        let png = make_png(100, 50, [200, 100, 50]);
        let (luma, w, h) = decode_to_luma(&png).unwrap();
        assert_eq!(h, MIN_SHORT_EDGE as i32);
        assert_eq!(w, 240);
        assert_eq!(luma.len(), (w as usize) * (h as usize));
    }

    #[test]
    fn decode_to_luma_returns_error_on_invalid_png() {
        let result = decode_to_luma(b"not a png");
        assert!(result.is_err());
    }

    #[test]
    fn decode_to_luma_downscales_large_image() {
        // 两个维度都超过 MAX_DIMENSION：只触发降采样，不触发小图放大。
        let big = MAX_DIMENSION + 1000;
        let png = make_png(big, MAX_DIMENSION + 500, [10, 20, 30]);
        let (_, w, h) = decode_to_luma(&png).unwrap();
        assert!(w <= MAX_DIMENSION as i32);
        assert!(h <= MAX_DIMENSION as i32);
    }


    /// 端到端识别验证（需真实 tessdata，dev 目录 `src-tauri/tessdata`）。
    /// 用 `cargo test ocr_e2e -- --ignored` 运行。
    #[test]
    #[ignore]
    fn ocr_e2e_recognizes_english_text() {
        let tessdata_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tessdata");
        assert!(
            tessdata_dir.join("eng.traineddata").exists(),
            "需要 eng.traineddata 在 src-tauri/tessdata/"
        );
        let api = init_engine(&tessdata_dir).unwrap();
        let png = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ocr_test_image.png"),
        )
        .unwrap();
        let result = run_ocr_locked(&api, &png).unwrap();
        assert!(result.text.to_lowercase().contains("hello"), "识别结果应含 hello: {}", result.text);
        assert!(result.text.contains("123"), "识别结果应含 123: {}", result.text);
    }

    /// 中文识别 e2e 验证（需 chi_sim.traineddata 在 src-tauri/tessdata/）。
    #[test]
    #[ignore]
    fn ocr_e2e_recognizes_chinese_text() {
        let tessdata_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tessdata");
        assert!(
            tessdata_dir.join("chi_sim.traineddata").exists(),
            "需要 chi_sim.traineddata 在 src-tauri/tessdata/"
        );
        let api = init_engine(&tessdata_dir).unwrap();
        let png = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ocr_chinese_test.png"),
        )
        .unwrap();
        let result = run_ocr_locked(&api, &png).unwrap();
        assert!(
            result.text.contains("中文") || result.text.contains("识别"),
            "中文识别应含关键词：{}",
            result.text
        );
    }

    /// fast 模式 e2e 验证（需 tessdata_fast 目录）。
    #[test]
    #[ignore]
    fn ocr_e2e_recognizes_fast_mode() {
        let tessdata_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tessdata_fast");
        assert!(
            tessdata_dir.join("eng.traineddata").exists(),
            "需要 tessdata_fast 在 src-tauri/tessdata_fast/"
        );
        let api = init_engine(&tessdata_dir).unwrap();
        let png = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ocr_test_image.png"),
        )
        .unwrap();
        let result = run_ocr_locked(&api, &png).unwrap();
        assert!(
            result.text.to_lowercase().contains("hello"),
            "fast 模式识别应含 hello：{}",
            result.text
        );
    }

    /// 多行中文 e2e 验证：应整体识别，而非一字一空格（PSM 误判回归测试）。
    #[test]
    #[ignore]
    fn ocr_e2e_recognizes_multiline_text() {
        let tessdata_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tessdata");
        let api = init_engine(&tessdata_dir).unwrap();
        let png = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ocr_multiline_test.png"),
        )
        .unwrap();
        let result = run_ocr_locked(&api, &png).unwrap();
        assert!(
            result.text.contains("第一行") || result.text.contains("第二行") || result.text.contains("第三行"),
            "多行识别应含行内容：{}",
            result.text
        );
    }

}
