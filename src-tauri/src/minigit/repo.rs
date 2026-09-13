use std::path::{Path, PathBuf};
use git2::{Repository, RepositoryOpenFlags, RepositoryState, StatusOptions};
use super::error::MiniGitError;
use super::types::{RepoInfo, RepoState};

pub fn canonicalize_path(path_str: &str) -> Result<PathBuf, MiniGitError> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(MiniGitError::PathNotFound(
            "仓库路径不存在，可能已被移动或删除".to_string(),
        ));
    }
    std::fs::canonicalize(path).map_err(|_| {
        MiniGitError::PathNotFound("仓库路径不存在，可能已被移动或删除".to_string())
    })
}

pub fn validate_repo(path_str: &str) -> Result<RepoInfo, MiniGitError> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(MiniGitError::PathNotFound(
            "仓库路径不存在，可能已被移动或删除".to_string(),
        ));
    }

    // Check if selecting .git directly
    if path.file_name().and_then(|n| n.to_str()) == Some(".git") {
        return Err(MiniGitError::NotRepoRoot(
            "该目录不是仓库根目录，请选择包含 .git 的目录".to_string(),
        ));
    }

    // Check if .git exists in the directory (either directory or file for worktree/submodule)
    let dot_git = path.join(".git");
    if !dot_git.exists() {
        // Check if it might be a subdirectory of a git repository
        if let Ok(parent_repo) = Repository::open(path) {
            if let Some(workdir) = parent_repo.workdir() {
                if workdir != path {
                    return Err(MiniGitError::NotRepoRoot(
                        "该目录不是仓库根目录，请选择包含 .git 的目录".to_string(),
                    ));
                }
            }
        }
        return Err(MiniGitError::NotGitRepo("该目录不是 Git 仓库".to_string()));
    }

    // Must open strictly at this path with NO_SEARCH to prevent walking up
    let repo = Repository::open_ext(path, RepositoryOpenFlags::NO_SEARCH, &[] as &[&std::ffi::OsStr])
        .map_err(|_| MiniGitError::NotGitRepo("该目录不是 Git 仓库".to_string()))?;

    if repo.is_bare() {
        return Err(MiniGitError::BareRepo(
            "该目录是裸仓库，没有工作区，暂不支持".to_string(),
        ));
    }

    let repo_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repository")
        .to_string();

    let clean_path = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string_lossy().to_string());

    // Normalize Windows \\?\ prefix if present
    let clean_path = clean_path.strip_prefix(r"\\?\").unwrap_or(&clean_path).to_string();

    Ok(RepoInfo {
        name: repo_name,
        path: clean_path,
        is_valid: true,
    })
}

pub fn get_repo_state(repo: &Repository) -> Result<RepoState, MiniGitError> {
    let head = repo.head();
    let (head_oid, head_name, is_detached) = match head {
        Ok(h) => {
            let oid = h.target().map(|o| o.to_string());
            let name = if h.is_branch() {
                h.shorthand().map(|s| s.to_string())
            } else {
                oid.as_ref().map(|o| o.chars().take(7).collect())
            };
            let detached = repo.head_detached().unwrap_or(false);
            (oid, name, detached)
        }
        Err(_) => (None, None, false),
    };

    let state = match repo.state() {
        RepositoryState::Clean => "NORMAL",
        RepositoryState::Merge => "MERGING",
        RepositoryState::Rebase | RepositoryState::RebaseInteractive | RepositoryState::RebaseMerge => {
            "REBASING"
        }
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "CHERRY-PICKING",
        RepositoryState::Bisect => "BISECTING",
        RepositoryState::Revert | RepositoryState::RevertSequence => "REVERTING",
        RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => "APPLYING",
    }
    .to_string();

    Ok(RepoState {
        head_oid,
        head_name,
        is_detached,
        state,
    })
}

pub fn has_changes(repo: &Repository) -> Result<bool, MiniGitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .update_index(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    for entry in statuses.iter() {
        let status = entry.status();
        if !status.is_empty() && !status.is_ignored() {
            return Ok(true);
        }
    }
    Ok(false)
}
