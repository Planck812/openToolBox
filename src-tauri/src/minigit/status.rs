use std::collections::{HashMap, HashSet};
use git2::{Repository, Status, StatusOptions};
use super::error::MiniGitError;
use super::types::{ChangedFile, WorkingStatus};

pub fn working_status(repo: &Repository) -> Result<WorkingStatus, MiniGitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .update_index(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();
    let mut unique_paths = HashSet::new();

    // Map to track dual status if needed
    let mut file_map: HashMap<String, ChangedFile> = HashMap::new();

    for entry in statuses.iter() {
        let s = entry.status();
        let path = match entry.path() {
            Some(p) => p.replace('\\', "/"),
            None => continue,
        };

        if s.is_ignored() {
            continue;
        }

        unique_paths.insert(path.clone());

        let is_conflict = s.is_conflicted();
        let is_untracked = s.is_wt_new();

        let staged_stat = if s.contains(Status::INDEX_NEW) {
            Some("A".to_string())
        } else if s.contains(Status::INDEX_MODIFIED) {
            Some("M".to_string())
        } else if s.contains(Status::INDEX_DELETED) {
            Some("D".to_string())
        } else if s.contains(Status::INDEX_RENAMED) {
            Some("R".to_string())
        } else if s.contains(Status::INDEX_TYPECHANGE) {
            Some("T".to_string())
        } else {
            None
        };

        let unstaged_stat = if s.contains(Status::WT_MODIFIED) {
            Some("M".to_string())
        } else if s.contains(Status::WT_DELETED) {
            Some("D".to_string())
        } else if s.contains(Status::WT_RENAMED) {
            Some("R".to_string())
        } else if s.contains(Status::WT_TYPECHANGE) {
            Some("T".to_string())
        } else {
            None
        };

        let primary_status = if is_conflict {
            "Conflicted".to_string()
        } else if is_untracked {
            "U".to_string()
        } else if let Some(st) = &staged_stat {
            st.clone()
        } else if let Some(ust) = &unstaged_stat {
            ust.clone()
        } else {
            "M".to_string()
        };

        let changed_file = ChangedFile {
            path: path.clone(),
            old_path: None,
            status: primary_status,
            staged_status: staged_stat.clone(),
            unstaged_status: unstaged_stat.clone(),
            additions: 0,
            deletions: 0,
        };

        if is_conflict {
            conflicted.push(changed_file.clone());
        } else if is_untracked {
            untracked.push(changed_file.clone());
        } else {
            if staged_stat.is_some() {
                staged.push(changed_file.clone());
            }
            if unstaged_stat.is_some() {
                unstaged.push(changed_file.clone());
            }
        }

        file_map.insert(path, changed_file);
    }

    let is_clean = unique_paths.is_empty();
    let total_changes = unique_paths.len();

    Ok(WorkingStatus {
        staged,
        unstaged,
        untracked,
        conflicted,
        total_changes,
        is_clean,
    })
}
