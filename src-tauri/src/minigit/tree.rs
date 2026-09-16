use std::path::Path;
use git2::Repository;
use super::error::MiniGitError;
use super::types::TreeEntry;

pub fn list_dir(repo: &Repository, rel_path: &str) -> Result<Vec<TreeEntry>, MiniGitError> {
    let workdir = repo.workdir().ok_or_else(|| {
        MiniGitError::BareRepo("该目录是裸仓库，没有工作区，暂不支持".to_string())
    })?;

    let clean_rel = rel_path.trim_matches(|c| c == '/' || c == '\\');
    let target_dir = if clean_rel.is_empty() {
        workdir.to_path_buf()
    } else {
        workdir.join(clean_rel)
    };

    if !target_dir.exists() {
        return Err(MiniGitError::PathNotFound("目录不存在".to_string()));
    }

    let read_dir = std::fs::read_dir(&target_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            MiniGitError::AccessDenied("没有访问该目录的权限".to_string())
        } else {
            MiniGitError::ListDirFailed("无法读取该目录".to_string())
        }
    })?;

    let index = repo.index().ok();

    // Check submodules
    let mut submodule_paths = std::collections::HashSet::new();
    if let Ok(submodules) = repo.submodules() {
        for sub in submodules {
            submodule_paths.insert(sub.path().to_string_lossy().replace('\\', "/"));
        }
    }

    let mut entries = Vec::new();

    for res in read_dir {
        let entry = match res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".git" {
            continue;
        }

        let full_path = entry.path();
        let symlink_meta = std::fs::symlink_metadata(&full_path).ok();
        let is_symlink = symlink_meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);

        let symlink_target = if is_symlink {
            std::fs::read_link(&full_path)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        } else {
            None
        };

        let is_dir = if is_symlink {
            // Do not follow symlinks
            false
        } else {
            entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false)
        };

        let child_rel_path = if clean_rel.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", clean_rel.replace('\\', "/"), file_name)
        };
        let normalized_child_rel = child_rel_path.replace('\\', "/");

        let is_submodule = submodule_paths.contains(&normalized_child_rel);

        let mut size = 0u64;
        if !is_dir && !is_symlink {
            if let Ok(meta) = entry.metadata() {
                size = meta.len();
            }
        }

        // Check if tracked in index (B-5: find_prefix O(log N) 二分查找替代线性扫描)
        let is_tracked = if let Some(idx) = &index {
            if is_dir {
                let prefix = format!("{}/", normalized_child_rel);
                idx.find_prefix(Path::new(&prefix)).is_ok()
            } else {
                idx.get_path(Path::new(&normalized_child_rel), 0).is_some()
            }
        } else {
            false
        };

        entries.push(TreeEntry {
            name: file_name,
            rel_path: normalized_child_rel,
            is_dir,
            is_submodule,
            is_symlink,
            symlink_target,
            is_ignored: false,
            is_tracked,
            size,
        });
    }

    // 忽略判定：只有存在未跟踪条目时才做，且一次 statuses() 覆盖整个目录。
    // 逐条 status_should_ignore 会让 libgit2 为每个路径重建一次忽略规则栈。
    if entries.iter().any(|e| !e.is_tracked) {
        let mut opts = git2::StatusOptions::new();
        opts.show(git2::StatusShow::Workdir)   // 只比工作区，跳过 HEAD..index 的差异计算
            .include_ignored(true)
            .include_untracked(true)
            .recurse_untracked_dirs(false)     // 只看本层，不进入未跟踪目录
            .recurse_ignored_dirs(false)       // 忽略目录整体报告一条，不展开
            .include_unmodified(false)
            .exclude_submodules(true)
            .update_index(false)               // 只读：不回写 index 的 stat 缓存
            .no_refresh(true);
        if !clean_rel.is_empty() {
            opts.pathspec(clean_rel);
        }

        match repo.statuses(Some(&mut opts)) {
            Ok(statuses) => {
                let ignored: std::collections::HashSet<String> = statuses
                    .iter()
                    .filter(|s| s.status().contains(git2::Status::IGNORED))
                    .filter_map(|s| s.path().map(|p| p.trim_end_matches('/').to_string()))
                    .collect();
                for e in &mut entries {
                    if !e.is_tracked {
                        e.is_ignored = ignored.contains(&e.rel_path);
                    }
                }
            }
            Err(e) => {
                log::warn!("[minigit] 忽略规则批量查询失败 ({}): {}", clean_rel, e);
                // 查不到就全部按「不忽略」处理，不阻断目录列举
            }
        }
    }

    Ok(entries)
}

pub fn list_tracked_files(repo: &Repository) -> Result<Vec<String>, MiniGitError> {
    let index = repo.index().map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    let mut files = Vec::with_capacity(index.len());
    for entry in index.iter() {
        let p = String::from_utf8_lossy(&entry.path).replace('\\', "/");
        files.push(p);
    }
    Ok(files)
}
