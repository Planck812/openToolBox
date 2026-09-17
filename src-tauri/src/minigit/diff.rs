use std::path::Path;
use git2::{DiffOptions, Oid, Repository};
use super::blob::is_binary_buffer;
use super::error::MiniGitError;
use super::types::{DiffHunk, DiffLine, DiffPlan};

const MAX_DEGRADED_LINES: usize = 200_000;
const MAX_FULL_LINES: usize = 20_000;
const MAX_FULL_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB
const MAX_DEGRADED_BYTES: u64 = 20 * 1024 * 1024; // 20 MiB

pub fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn diff_prepare(
    repo: &Repository,
    source: &str,
    rel_path: &str,
) -> Result<DiffPlan, MiniGitError> {
    let normalized_rel = rel_path.replace('\\', "/");
    let workdir = repo.workdir().ok_or_else(|| {
        MiniGitError::BareRepo("该目录是裸仓库，没有工作区，暂不支持".to_string())
    })?;

    if source == "working-conflicted" {
        let file_path = workdir.join(&normalized_rel);
        let raw_bytes = std::fs::read(&file_path).map_err(|_| {
            MiniGitError::ReadFileFailed("无法读取冲突文件".to_string())
        })?;
        let is_bin = is_binary_buffer(&raw_bytes);
        let size = raw_bytes.len() as u64;

        if is_bin {
            return Ok(DiffPlan {
                tier: "Rejected".to_string(),
                source: source.to_string(),
                rel_path: normalized_rel,
                old_content: None,
                new_content: None,
                hunks: Vec::new(),
                additions: 0,
                deletions: 0,
                is_binary: true,
                old_size: size,
                new_size: size,
                reason: Some("二进制文件，不展示内容".to_string()),
                old_path: None,
            });
        }

        let text = normalize_line_endings(&String::from_utf8_lossy(&raw_bytes));
        return Ok(DiffPlan {
            tier: "Full".to_string(),
            source: source.to_string(),
            rel_path: normalized_rel,
            old_content: Some(text.clone()),
            new_content: Some(text),
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
            is_binary: false,
            old_size: size,
            new_size: size,
            reason: None,
            old_path: None,
        });
    }

    if source == "working-untracked" {
        let file_path = workdir.join(&normalized_rel);
        let raw_bytes = std::fs::read(&file_path).map_err(|_| {
            MiniGitError::ReadFileFailed("无法读取未跟踪文件".to_string())
        })?;
        let is_bin = is_binary_buffer(&raw_bytes);
        let size = raw_bytes.len() as u64;

        if is_bin {
            return Ok(DiffPlan {
                tier: "Rejected".to_string(),
                source: source.to_string(),
                rel_path: normalized_rel,
                old_content: None,
                new_content: None,
                hunks: Vec::new(),
                additions: 0,
                deletions: 0,
                is_binary: true,
                old_size: 0,
                new_size: size,
                reason: Some("二进制文件，不展示内容".to_string()),
                old_path: None,
            });
        }

        let new_text = normalize_line_endings(&String::from_utf8_lossy(&raw_bytes));
        let lines_count = new_text.lines().count() as u32;

        return Ok(DiffPlan {
            tier: "Full".to_string(),
            source: source.to_string(),
            rel_path: normalized_rel,
            old_content: Some("".to_string()),
            new_content: Some(new_text),
            hunks: Vec::new(),
            additions: lines_count,
            deletions: 0,
            is_binary: false,
            old_size: 0,
            new_size: size,
            reason: None,
            old_path: None,
        });
    }

    // Determine old content & new content
    let (old_raw_bytes, new_raw_bytes, old_path) = if source == "working" {
        // Old content is from HEAD
        let old_bytes = match repo.head().and_then(|h| h.peel_to_commit()) {
            Ok(head_commit) => {
                let tree = head_commit.tree().map_err(|e| MiniGitError::Other(e.message().to_string()))?;
                match tree.get_path(Path::new(&normalized_rel)) {
                    Ok(entry) => repo
                        .find_blob(entry.id())
                        .map(|b| b.content().to_vec())
                        .unwrap_or_default(),
                    Err(_) => Vec::new(), // newly added file in working copy
                }
            }
            Err(_) => Vec::new(), // empty repo
        };

        let file_path = workdir.join(&normalized_rel);
        let new_bytes = if file_path.exists() {
            std::fs::read(&file_path).unwrap_or_default()
        } else {
            Vec::new() // deleted file in working copy
        };

        (old_bytes, new_bytes, None)
    } else if let Some(oid_str) = source.strip_prefix("commit:") {
        let oid = Oid::from_str(oid_str).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
        let commit = repo.find_commit(oid).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
        let current_tree = commit.tree().map_err(|e| MiniGitError::Other(e.message().to_string()))?;

        let new_bytes = match current_tree.get_path(Path::new(&normalized_rel)) {
            Ok(entry) => repo
                .find_blob(entry.id())
                .map(|b| b.content().to_vec())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };

        let old_bytes = if commit.parent_count() > 0 {
            let parent = commit.parent(0).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
            let parent_tree = parent.tree().map_err(|e| MiniGitError::Other(e.message().to_string()))?;
            match parent_tree.get_path(Path::new(&normalized_rel)) {
                Ok(entry) => repo
                    .find_blob(entry.id())
                    .map(|b| b.content().to_vec())
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };

        (old_bytes, new_bytes, None)
    } else if let Some(oid_str) = source.strip_prefix("commit-local:") {
        // 「与本地对比」：左边是提交里的版本，右边是工作区磁盘上的当前内容，
        // 因此未提交的改动也会算进来（对齐 IDEA 的 Compare with Local）。
        let oid = Oid::from_str(oid_str).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
        let commit = repo.find_commit(oid).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
        let tree = commit.tree().map_err(|e| MiniGitError::Other(e.message().to_string()))?;

        let old_bytes = match tree.get_path(Path::new(&normalized_rel)) {
            Ok(entry) => repo
                .find_blob(entry.id())
                .map(|b| b.content().to_vec())
                .unwrap_or_default(),
            Err(_) => Vec::new(), // 该提交里没有这个文件
        };

        let file_path = workdir.join(&normalized_rel);
        let new_bytes = if file_path.exists() {
            std::fs::read(&file_path).unwrap_or_default()
        } else {
            Vec::new() // 本地已删除
        };

        (old_bytes, new_bytes, None)
    } else {
        (Vec::new(), Vec::new(), None)
    };

    let old_size = old_raw_bytes.len() as u64;
    let new_size = new_raw_bytes.len() as u64;

    // Binary check
    if is_binary_buffer(&old_raw_bytes) || is_binary_buffer(&new_raw_bytes) {
        return Ok(DiffPlan {
            tier: "Rejected".to_string(),
            source: source.to_string(),
            rel_path: normalized_rel,
            old_content: None,
            new_content: None,
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
            is_binary: true,
            old_size,
            new_size,
            reason: Some("二进制文件，不展示内容".to_string()),
            old_path,
        });
    }

    // Size tier check
    if old_size > MAX_DEGRADED_BYTES || new_size > MAX_DEGRADED_BYTES {
        return Ok(DiffPlan {
            tier: "Rejected".to_string(),
            source: source.to_string(),
            rel_path: normalized_rel,
            old_content: None,
            new_content: None,
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
            is_binary: false,
            old_size,
            new_size,
            reason: Some("文件过大，超出差异计算上限".to_string()),
            old_path,
        });
    }

    // Convert to normalized text
    let old_text = normalize_line_endings(&String::from_utf8_lossy(&old_raw_bytes));
    let new_text = normalize_line_endings(&String::from_utf8_lossy(&new_raw_bytes));

    let old_lines_count = old_text.lines().count();
    let new_lines_count = new_text.lines().count();
    let total_lines = old_lines_count + new_lines_count;

    if total_lines > MAX_DEGRADED_LINES {
        return Ok(DiffPlan {
            tier: "Rejected".to_string(),
            source: source.to_string(),
            rel_path: normalized_rel,
            old_content: None,
            new_content: None,
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
            is_binary: false,
            old_size,
            new_size,
            reason: Some("总行数超出计算上限".to_string()),
            old_path,
        });
    }

    let is_degraded = total_lines > MAX_FULL_LINES || old_size > MAX_FULL_BYTES || new_size > MAX_FULL_BYTES;

    // Compute diff hunks using git2 diff buffers in a separate scope
    let (hunks, additions, deletions) = {
        let mut diff_opts = DiffOptions::new();
        diff_opts.context_lines(3);
        diff_opts.ignore_whitespace_eol(true);

        let patch = git2::Patch::from_buffers(
            old_text.as_bytes(),
            Some(Path::new(&normalized_rel)),
            new_text.as_bytes(),
            Some(Path::new(&normalized_rel)),
            Some(&mut diff_opts),
        );

        let mut hunks = Vec::new();
        let mut additions = 0u32;
        let mut deletions = 0u32;

        if let Ok(p) = patch {
            for h_idx in 0..p.num_hunks() {
                if let Ok((hunk, _)) = p.hunk(h_idx) {
                    let mut lines = Vec::new();
                    let num_lines = p.num_lines_in_hunk(h_idx).unwrap_or(0);
                    for l_idx in 0..num_lines {
                        if let Ok(line) = p.line_in_hunk(h_idx, l_idx) {
                            let origin = match line.origin() {
                                '+' => {
                                    additions += 1;
                                    "+"
                                }
                                '-' => {
                                    deletions += 1;
                                    "-"
                                }
                                _ => " ",
                            }
                            .to_string();

                            let content = String::from_utf8_lossy(line.content()).to_string();
                            let clean_content = content.trim_end_matches(|c| c == '\r' || c == '\n').to_string();

                            lines.push(DiffLine {
                                origin,
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                                content: clean_content,
                            });
                        }
                    }

                    hunks.push(DiffHunk {
                        old_start: hunk.old_start(),
                        old_lines: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_lines: hunk.new_lines(),
                        header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                        lines,
                    });
                }
            }
        }
        (hunks, additions, deletions)
    };

    let tier = if is_degraded { "Degraded" } else { "Full" }.to_string();
    let reason = if is_degraded {
        Some("超出完整档规模限制，已降级为仅行级高亮展示".to_string())
    } else {
        None
    };

    Ok(DiffPlan {
        tier,
        source: source.to_string(),
        rel_path: normalized_rel,
        old_content: if is_degraded { None } else { Some(old_text) },
        new_content: if is_degraded { None } else { Some(new_text) },
        hunks,
        additions,
        deletions,
        is_binary: false,
        old_size,
        new_size,
        reason,
        old_path,
    })
}
