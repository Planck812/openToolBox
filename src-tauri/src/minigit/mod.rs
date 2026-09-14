pub mod blob;
pub mod diff;
pub mod error;
pub mod log;
pub mod refs;
pub mod repo;
pub mod session;
pub mod status;
pub mod tree;
pub mod types;

use std::sync::Arc;
use tauri::{Runtime, State, Webview};
pub use error::MiniGitError;
pub use session::SessionManager;
pub use types::*;

pub type MinigitState = Arc<SessionManager>;

fn guard_minigit_window<R: Runtime>(webview: &Webview<R>) -> Result<(), MiniGitError> {
    if webview.label() != "mini-git" {
        return Err(MiniGitError::Other("非法调用来源".into()));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn mg_validate_repo<R: Runtime>(
    webview: Webview<R>,
    path: String,
) -> Result<RepoInfo, MiniGitError> {
    guard_minigit_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || repo::validate_repo(&path))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_open_session<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    path: String,
) -> Result<String, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state_clone.open_session(&path))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_close_session<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<(), MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        state_clone.close_session(&repo_id);
        Ok(())
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_repo_state<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<RepoState, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        repo::get_repo_state(&repo)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_list_dir<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    rel_path: String,
) -> Result<Vec<TreeEntry>, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        tree::list_dir(&repo, &rel_path)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_list_tracked_files<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<Vec<String>, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        tree::list_tracked_files(&repo)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_read_file_meta<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    rel_path: String,
) -> Result<FileMeta, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        blob::read_workspace_file_meta(&repo, &rel_path)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_read_file_content<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    rel_path: String,
) -> Result<String, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        blob::read_workspace_file_text(&repo, &rel_path)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_read_blob_content<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    oid: String,
    rel_path: String,
) -> Result<String, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        blob::read_blob_text(&repo, &oid, &rel_path)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_list_refs<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<Refs, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        refs::list_refs(&repo)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_has_changes<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<bool, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        repo::has_changes(&repo)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_log_open<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    filter: LogFilter,
) -> Result<String, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state_clone.open_walk(&repo_id, filter))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_log_next<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    walk_id: String,
    limit: usize,
) -> Result<LogPage, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state_clone.next_walk_page(&walk_id, limit))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_log_close<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    walk_id: String,
) -> Result<(), MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        state_clone.close_walk(&walk_id);
        Ok(())
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_commit_detail<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    oid: String,
) -> Result<CommitDetail, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        log::get_commit_detail(&repo, &oid)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_status<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<WorkingStatus, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        status::working_status(&repo)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_diff_prepare<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    source: String,
    rel_path: String,
) -> Result<DiffPlan, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        diff::diff_prepare(&repo, &source, &rel_path)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_search_start<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
    query: SearchQuery,
) -> Result<String, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state_clone.start_search(&repo_id, query))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_search_poll<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    search_id: String,
) -> Result<SearchProgress, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || state_clone.poll_search(&search_id))
        .await
        .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_search_cancel<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    search_id: String,
) -> Result<(), MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        state_clone.cancel_search(&search_id);
        Ok(())
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn mg_unpushed_commits<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MinigitState>,
    repo_id: String,
) -> Result<UnpushedCommits, MiniGitError> {
    guard_minigit_window(&webview)?;
    let state_clone = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || {
        let repo = state_clone.get_repo(&repo_id)?;
        log::get_unpushed_commits(&repo, 200)
    })
    .await
    .map_err(|e| MiniGitError::Other(e.to_string()))?
}

