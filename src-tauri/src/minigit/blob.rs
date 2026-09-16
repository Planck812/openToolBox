use std::path::Path;
use git2::{Oid, Repository};
use super::error::MiniGitError;
use super::types::FileMeta;

pub const MAX_TEXT_FILE_SIZE: u64 = 2 * 1024 * 1024; // 2 MiB (2,097,152 bytes)

pub fn is_binary_buffer(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return false;
    }

    // Check UTF-16 BOM
    if buf.len() >= 2 {
        if (buf[0] == 0xFE && buf[1] == 0xFF) || (buf[0] == 0xFF && buf[1] == 0xFE) {
            return false;
        }
    }
    // Check UTF-32 BOM
    if buf.len() >= 4 {
        if (buf[0] == 0x00 && buf[1] == 0x00 && buf[2] == 0xFE && buf[3] == 0xFF)
            || (buf[0] == 0xFF && buf[1] == 0xFE && buf[2] == 0x00 && buf[3] == 0x00)
        {
            return false;
        }
    }

    let inspect_len = buf.len().min(8000);
    buf[..inspect_len].contains(&0x00)
}

pub fn detect_lfs_pointer(content: &str) -> (bool, Option<String>, Option<u64>) {
    if content.starts_with("version https://git-lfs.github.com/spec/v1") {
        let mut oid = None;
        let mut size = None;
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("oid sha256:") {
                oid = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("size ") {
                size = rest.trim().parse::<u64>().ok();
            }
        }
        (true, oid, size)
    } else {
        (false, None, None)
    }
}

pub fn read_workspace_file_meta(
    repo: &Repository,
    rel_path: &str,
) -> Result<FileMeta, MiniGitError> {
    let workdir = repo.workdir().ok_or_else(|| {
        MiniGitError::BareRepo("该目录是裸仓库，没有工作区，暂不支持".to_string())
    })?;
    let path = workdir.join(rel_path);
    if !path.exists() {
        return Err(MiniGitError::ReadFileFailed("无法读取该文件".to_string()));
    }

    let meta = std::fs::metadata(&path).map_err(|_| {
        MiniGitError::ReadFileFailed("无法读取该文件".to_string())
    })?;
    let size = meta.len();

    // Read up to 8000 bytes for binary & encoding check
    let mut file = std::fs::File::open(&path).map_err(|_| {
        MiniGitError::ReadFileFailed("无法读取该文件".to_string())
    })?;
    use std::io::Read;
    let mut buf = vec![0u8; 8000.min(size as usize)];
    let bytes_read = file.read(&mut buf).unwrap_or(0);
    buf.truncate(bytes_read);

    let is_binary = is_binary_buffer(&buf);
    let mut encoding = "UTF-8".to_string();
    let mut is_lfs = false;
    let mut lfs_oid = None;
    let mut lfs_size = None;

    if !is_binary && size <= 1024 {
        if let Ok(text) = std::str::from_utf8(&buf) {
            let (lfs, o, s) = detect_lfs_pointer(text);
            is_lfs = lfs;
            lfs_oid = o;
            lfs_size = s;
        }
    }

    if !is_binary {
        if std::str::from_utf8(&buf).is_err() {
            encoding = "GBK".to_string();
        }
    }

    Ok(FileMeta {
        size,
        is_binary,
        encoding,
        is_lfs_pointer: is_lfs,
        lfs_oid,
        lfs_size,
    })
}

pub fn read_workspace_file_text(
    repo: &Repository,
    rel_path: &str,
) -> Result<String, MiniGitError> {
    let workdir = repo.workdir().ok_or_else(|| {
        MiniGitError::BareRepo("该目录是裸仓库，没有工作区，暂不支持".to_string())
    })?;
    let path = workdir.join(rel_path);
    if !path.exists() {
        return Err(MiniGitError::ReadFileFailed("无法读取该文件".to_string()));
    }

    let bytes = std::fs::read(&path).map_err(|_| {
        MiniGitError::ReadFileFailed("无法读取该文件".to_string())
    })?;

    if bytes.len() as u64 > MAX_TEXT_FILE_SIZE {
        let size_mb = (bytes.len() as f64) / (1024.0 * 1024.0);
        return Err(MiniGitError::FileTooLarge(format!(
            "文件过大（{:.1} MB），不展示内容",
            size_mb
        )));
    }

    if is_binary_buffer(&bytes) {
        let size_mb = (bytes.len() as f64) / (1024.0 * 1024.0);
        return Err(MiniGitError::BinaryFile(format!(
            "二进制文件（{:.1} MB），不展示内容",
            size_mb
        )));
    }

    // Strip UTF-8 BOM if present
    let raw_slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };

    Ok(String::from_utf8_lossy(raw_slice).to_string())
}

pub fn read_blob_text(
    repo: &Repository,
    oid_str: &str,
    rel_path: &str,
) -> Result<String, MiniGitError> {
    let oid = Oid::from_str(oid_str).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    let tree = commit
        .tree()
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    let entry = tree
        .get_path(Path::new(rel_path))
        .map_err(|_| MiniGitError::ReadFileFailed("历史版本中未找到该文件".to_string()))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let content = blob.content();
    if content.len() as u64 > MAX_TEXT_FILE_SIZE {
        let size_mb = (content.len() as f64) / (1024.0 * 1024.0);
        return Err(MiniGitError::FileTooLarge(format!(
            "文件过大（{:.1} MB），不展示内容",
            size_mb
        )));
    }

    if is_binary_buffer(content) {
        let size_mb = (content.len() as f64) / (1024.0 * 1024.0);
        return Err(MiniGitError::BinaryFile(format!(
            "二进制文件（{:.1} MB），不展示内容",
            size_mb
        )));
    }

    let raw_slice = if content.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &content[3..]
    } else {
        content
    };

    Ok(String::from_utf8_lossy(raw_slice).to_string())
}
