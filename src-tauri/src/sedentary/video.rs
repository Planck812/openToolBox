//! 久坐提醒提醒视频（仅 Windows）：内置默认视频资源定位/复制、用户自定义视频上传/重置。
//!
//! 优先级：用户上传视频存在且非空优先；否则确保默认视频就位（源缺失回退无视频模式，
//! 弹窗保持纯红色界面，不阻断启动）。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};
#[cfg(windows)]
use uuid::Uuid;

use crate::error::AppError;

/// 内置默认提醒视频资源文件名（随安装包打包，Windows 专用）。
const SEDENTARY_VIDEO_SOURCE_FILE: &str = "sedentary-reminder.mp4";
/// 应用本地数据目录下存放提醒视频的目录名。
const SEDENTARY_VIDEO_RELATIVE_DIR: &str = "sedentary-video";
/// 提醒视频文件名（复制到应用目录后的固定名）。
const SEDENTARY_VIDEO_FILE_NAME: &str = "reminder-video.mp4";
/// 用户上传视频文件名（与默认视频同目录；覆盖式，只保留最新一个）。
const SEDENTARY_USER_VIDEO_FILE_NAME: &str = "user-video.mp4";
/// 用户上传视频大小上限（20MB，避免大文件影响弹窗加载）。
const MAX_USER_VIDEO_BYTES: u64 = 20 * 1024 * 1024;
/// 用户上传视频扩展名白名单（与前端对话框过滤器一致）。
const SEDENTARY_USER_VIDEO_EXTENSIONS: [&str; 3] = ["mp4", "webm", "mov"];

/// 视频源扩展名是否在白名单内（mp4/webm/mov，大小写不敏感）。
#[cfg_attr(not(windows), allow(dead_code))]
fn is_supported_video_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SEDENTARY_USER_VIDEO_EXTENSIONS
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

/// 判断是否需要复制视频：目标不存在（`None`）或大小与源不一致 → 复制。
///
/// 纯函数便于单测。`source_len` 为源文件字节数，`target` 为目标文件字节数
/// （`None` 表示目标不存在）。
#[cfg_attr(not(windows), allow(dead_code))]
fn should_copy_video(source_len: u64, target: Option<u64>) -> bool {
    match target {
        None => true,
        Some(target_len) => source_len != target_len,
    }
}

/// 原子覆盖复制：先写入同目录临时文件并校验非空，再 `rename` 覆盖目标。
///
/// 避免 `std::fs::copy` 直接写目标导致「半截拷贝当合法视频」：复制失败时目标
/// 保持原样，临时文件被清理；拷贝结果为空则报错，不让空/半截文件落地。
#[cfg(windows)]
fn copy_video_atomic(source: &Path, target: &Path, what: &str) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| format!("{what}目录无效"))?;
    std::fs::create_dir_all(parent).map_err(|error| format!("创建提醒视频目录失败：{error}"))?;
    let temp = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| {
        std::fs::copy(source, &temp).map_err(|error| format!("{what}失败：{error}"))?;
        let metadata =
            std::fs::metadata(&temp).map_err(|error| format!("{what}校验失败：{error}"))?;
        if metadata.len() == 0 {
            return Err(format!("{what}失败：源文件为空"));
        }
        std::fs::rename(&temp, target).map_err(|error| format!("{what}提交失败：{error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// 定位内置默认提醒视频源（Windows 专用）。
///
/// 生产：bundle resource 落盘在 `resource_dir()` 根（`sedentary-reminder.mp4`）；
/// dev：`bundle.resources` 不生效，回退工作区 `src-tauri/resources/sedentary-reminder.mp4`。
/// 两处都找不到时返回 `None`（无视频模式）。
#[cfg(windows)]
fn resolve_sedentary_video_source<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let candidates = [
        app.path().resource_dir().ok()?.join(SEDENTARY_VIDEO_SOURCE_FILE),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join(SEDENTARY_VIDEO_SOURCE_FILE),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// 确保提醒视频已就位，并返回当前生效的视频路径。
///
/// 优先级：用户上传视频（`user-video.mp4`）存在且非空 → 直接返回（不再复制
/// 默认源）；否则确保默认视频就位（目标存在且大小一致 → 跳过；否则从固定源
/// 路径复制到 `app_local_data_dir()/sedentary-video/reminder-video.mp4`）。
/// 恢复默认（删除用户视频）后，下次调用自然回退到默认源逻辑。
///
/// 返回视频绝对路径；源缺失/复制失败仅记日志并回退 `None`
/// （无视频模式，弹窗保持纯红色界面，不阻断启动）。
#[cfg(windows)]
pub fn ensure_reminder_video<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app
        .path()
        .app_local_data_dir()
        .ok()?
        .join(SEDENTARY_VIDEO_RELATIVE_DIR);

    // 用户上传的视频存在且非空：优先使用。
    let user_video = dir.join(SEDENTARY_USER_VIDEO_FILE_NAME);
    if let Ok(meta) = std::fs::metadata(&user_video) {
        if meta.len() > 0 {
            return Some(user_video);
        }
    }

    let target = dir.join(SEDENTARY_VIDEO_FILE_NAME);

    // 定位内置默认视频源（生产取 bundle resource，dev 回退工作区资源目录）。
    let Some(source) = resolve_sedentary_video_source(app) else {
        // 默认视频源缺失（未打包/开发时未放置）：回退无视频模式。
        return None;
    };
    let source_len = match std::fs::metadata(&source) {
        Ok(meta) => meta.len(),
        Err(error) => {
            log::error!("[sedentary] 提醒视频源文件不可用（{}）：{error}", source.display());
            return None;
        }
    };
    let target_len = std::fs::metadata(&target).ok().map(|meta| meta.len());
    if !should_copy_video(source_len, target_len) {
        return Some(target);
    }
    match copy_video_atomic(&source, &target, "复制提醒视频") {
        Ok(()) => Some(target),
        Err(error) => {
            log::error!("[sedentary] {error}");
            None
        }
    }
}

/// 用户视频大小是否超限（> 20MB）。
#[cfg_attr(not(windows), allow(dead_code))]
fn exceeds_max_video_size(len: u64) -> bool {
    len > MAX_USER_VIDEO_BYTES
}

/// `sedentary_set_user_video`：把用户选择的本地视频复制为自定义提醒视频
/// （`app_local_data_dir()/sedentary-video/user-video.mp4`，覆盖式只保留最新
/// 一个）。返回复制后的视频绝对路径；超限（> 20MB）/ 非白名单扩展名 / 非文件 /
/// 复制失败返回错误。
///
/// 安全说明：命令接收任意本地路径并复制到 asset scope。Rust 无法获知路径是否
/// 来自原生对话框，故做来源强校验：源必须是**文件**（非目录）、扩展名在
/// mp4/webm/mov 白名单内（与前端对话框过滤器一致）、且大小 ≤ 20MB。
/// 复制方向固定为「本地源 → 应用数据目录」，不会从 asset scope 反向覆盖系统
/// 关键目录；扩展名+大小约束也把「复制任意文件」的风险限制在小型媒体文件。
#[cfg(windows)]
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn sedentary_set_user_video<R: Runtime>(
    app: AppHandle<R>,
    source_path: String,
) -> Result<String, AppError> {
    let source = PathBuf::from(&source_path);
    let meta = std::fs::metadata(&source)
        .map_err(|e| format!("无法读取所选视频文件（{source_path}）：{e}"))?;
    if !meta.is_file() {
        return Err(AppError::Message(format!("所选路径不是文件（{source_path}）")));
    }
    let source_len = meta.len();
    if exceeds_max_video_size(source_len) {
        return Err(AppError::Message(format!(
            "视频文件超过 {}MB 上限",
            MAX_USER_VIDEO_BYTES / (1024 * 1024)
        )));
    }
    if !is_supported_video_extension(&source) {
        return Err(AppError::Message(
            "仅支持 mp4 / webm / mov 视频文件".to_string(),
        ));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析应用数据目录：{e}"))?
        .join(SEDENTARY_VIDEO_RELATIVE_DIR);
    let target = dir.join(SEDENTARY_USER_VIDEO_FILE_NAME);
    // 源即目标（例如用户直接选择了已生效的 user-video.mp4）：跳过复制直接返回。
    if let Ok(canonical) = source.canonicalize() {
        if canonical == target.canonicalize().unwrap_or_default() {
            return Ok(target.to_string_lossy().into_owned());
        }
    }
    copy_video_atomic(&source, &target, "复制视频文件")?;
    Ok(target.to_string_lossy().into_owned())
}

/// `sedentary_reset_user_video`：删除自定义视频（若有），回退到默认源视频
/// （`ensure_reminder_video` 会重新复制固定源；源缺失则回退无视频模式）。
///
/// 返回恢复后的视频绝对路径（无视频模式返回空串）。
#[cfg(windows)]
#[tauri::command]
#[specta::specta]
pub fn sedentary_reset_user_video<R: Runtime>(app: AppHandle<R>) -> Result<String, AppError> {
    let user_video = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析应用数据目录：{e}"))?
        .join(SEDENTARY_VIDEO_RELATIVE_DIR)
        .join(SEDENTARY_USER_VIDEO_FILE_NAME);
    match std::fs::remove_file(&user_video) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(AppError::Message(format!("删除自定义视频失败：{e}"))),
    }
    Ok(ensure_reminder_video(&app)
        .map_or_else(String::new, |p| p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_size_limit_boundaries() {
        // 恰好 20MB 允许；超过 20MB 拒绝。
        assert!(!exceeds_max_video_size(MAX_USER_VIDEO_BYTES));
        assert!(exceeds_max_video_size(MAX_USER_VIDEO_BYTES + 1));
    }

    #[test]
    fn should_copy_video_when_target_missing() {
        // 目标不存在 → 需要复制。
        assert!(should_copy_video(100, None));
    }

    #[test]
    fn should_copy_video_when_sizes_differ() {
        // 目标存在但大小不一致 → 需要复制（源文件已更换）。
        assert!(should_copy_video(100, Some(200)));
    }

    #[test]
    fn should_skip_copy_when_sizes_match() {
        // 目标存在且大小一致 → 跳过复制。
        assert!(!should_copy_video(100, Some(100)));
    }

    #[test]
    fn should_copy_zero_source_same_rules() {
        // 源大小为 0 也按同一规则：目标缺失/大小不同 → 复制；一致 → 跳过。
        assert!(should_copy_video(0, None));
        assert!(should_copy_video(0, Some(1)));
        assert!(!should_copy_video(0, Some(0)));
    }

    #[test]
    fn video_extension_whitelist() {
        assert!(is_supported_video_extension(Path::new("movie.mp4")));
        assert!(is_supported_video_extension(Path::new("movie.MP4")));
        assert!(is_supported_video_extension(Path::new("movie.webm")));
        assert!(is_supported_video_extension(Path::new("movie.mov")));
        assert!(!is_supported_video_extension(Path::new("movie.avi")));
        assert!(!is_supported_video_extension(Path::new("movie.txt")));
        assert!(!is_supported_video_extension(Path::new("movie")));
        assert!(!is_supported_video_extension(Path::new("video.mov.exe")));
    }
}
