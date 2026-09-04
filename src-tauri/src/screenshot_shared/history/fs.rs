//! 截图历史：文件系统 / 校验 / 哈希 helper。

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// 原子写入：先写唯一临时文件并同步，再重命名提交，最后同步父目录。
pub(crate) fn atomic_write_bytes(path: &Path, bytes: &[u8], operation: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{operation}目录无效"))?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("检查{operation}目录失败：{error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("{operation}目录不安全"));
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("{operation}文件名无效"))?;
    let temp = parent.join(format!(".{name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("创建{operation}临时文件失败：{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("写入{operation}临时文件失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步{operation}临时文件失败：{error}"))?;
        fs::rename(&temp, path).map_err(|error| format!("提交{operation}失败：{error}"))?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        remove_file_best_effort(&temp);
    }
    result
}

/// 以「新建失败即报错」的方式写入并同步一个文件（`create_new(true)`）。
pub(crate) fn write_synced_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path)
        .map_err(|error| format!("写入截图历史文件失败：{error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("写入截图历史文件失败：{error}"))?;
    file.sync_all()
        .map_err(|error| format!("同步截图历史文件失败：{error}"))
}

/// 同步目录项；Windows 上目录同步权限被拒时视为成功。
pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    match File::open(path).and_then(|file| file.sync_all()) {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => Ok(()),
        Err(error) => Err(format!("同步截图历史目录失败：{error}")),
    }
}

/// 确认目录存在且是「真实目录」（非符号链接），否则创建。
pub(crate) fn ensure_real_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        let metadata =
            fs::symlink_metadata(path).map_err(|error| format!("检查截图历史目录失败：{error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(format!("截图历史路径不是安全目录：{}", path.display()));
        }
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|error| format!("创建截图历史目录失败：{error}"))
}

/// 列出目录下的「真实子目录」（跳过符号链接）。
pub(crate) fn read_directories(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut directories = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| format!("读取截图历史目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取截图历史目录项失败：{error}"))?;
        let metadata = entry
            .file_type()
            .map_err(|error| format!("检查截图历史目录项失败：{error}"))?;
        if metadata.is_dir() && !metadata.is_symlink() {
            directories.push(entry.path());
        }
    }
    Ok(directories)
}

/// 取路径的 UTF-8 文件名。
pub(crate) fn file_name(path: &Path) -> Option<String> {
    path.file_name()?.to_str().map(ToOwned::to_owned)
}

/// 校验目标为「真实目录」后整树删除。
pub(crate) fn remove_dir_checked(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("检查截图历史记录失败：{error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("拒绝删除不安全的截图历史路径".to_string());
    }
    fs::remove_dir_all(path).map_err(|error| format!("删除截图历史记录失败：{error}"))
}

/// 尽力删除目录（校验为真实目录后静默失败）。
pub(crate) fn remove_dir_best_effort(path: &Path) {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        let _ = fs::remove_dir_all(path);
    }
}

/// 尽力删除文件（静默失败）。
pub(crate) fn remove_file_best_effort(path: &Path) {
    let _ = fs::remove_file(path);
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// 校验 PNG 签名并可解码，返回像素尺寸。
pub(crate) fn validate_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < PNG_SIGNATURE.len() || &bytes[..8] != PNG_SIGNATURE {
        return Err("截图内容不是有效 PNG".to_string());
    }
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(|error| format!("无法解码截图 PNG：{error}"))?;
    Ok((image.width(), image.height()))
}

/// 校验 payload 文件：真实文件、字节数一致、SHA-256 摘要一致。
pub(crate) fn validate_payload_file(
    path: &Path,
    expected_bytes: u64,
    expected_digest: &str,
) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("截图历史图像缺失：{error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != expected_bytes
    {
        return Err("截图历史图像文件无效".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("读取截图历史图像失败：{error}"))?;
    if sha256_hex(&bytes) != expected_digest {
        return Err("截图历史图像校验失败".to_string());
    }
    Ok(())
}

/// Save As 总是使用小写 `.png` 后缀：非 PNG 后缀被替换，缺失后缀则追加。
pub(crate) fn normalize_png_extension(path: &Path) -> PathBuf {
    let is_png = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
    if is_png {
        return path.with_extension("png");
    }
    path.with_extension("png")
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

/// 校验不透明 ID（UUID 格式）。
pub(crate) fn validate_opaque_id(value: &str, kind: &str) -> Result<(), String> {
    if Uuid::parse_str(value).is_err() {
        return Err(format!("无效的 {kind} ID"));
    }
    Ok(())
}

/// 由两份 payload 摘要与尺寸派生的 artifact 摘要。
pub(crate) fn artifact_digest(original: &str, final_digest: &str, width: u32, height: u32) -> String {
    sha256_hex(format!("{original}:{final_digest}:{width}:{height}").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn normalize_png_extension_replaces_or_appends_png() {
        assert_eq!(
            normalize_png_extension(Path::new("report"))
                .file_name()
                .unwrap(),
            "report.png"
        );
        assert_eq!(
            normalize_png_extension(Path::new("report.PNG"))
                .file_name()
                .unwrap(),
            "report.png"
        );
        assert_eq!(
            normalize_png_extension(Path::new("report.jpg"))
                .file_name()
                .unwrap(),
            "report.png"
        );
    }

    #[test]
    fn atomic_write_bytes_writes_destination_without_leaving_temp_file() {
        let temp = TempDir::new().unwrap();
        let destination = temp.path().join("export.png");

        atomic_write_bytes(&destination, b"png bytes", "test export").unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"png bytes");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomic_write_bytes_cleans_temp_when_destination_is_a_directory() {
        let temp = TempDir::new().unwrap();
        let destination = temp.path().join("existing.png");
        fs::create_dir(&destination).unwrap();

        assert!(atomic_write_bytes(&destination, b"png bytes", "test export").is_err());
        assert!(destination.is_dir());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }
}
