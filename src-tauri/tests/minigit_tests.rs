use open_toolbox_lib::minigit::{
    blob, diff, log, refs, repo::{self, validate_repo}, status, tree,
    types::{LogFilter, SearchQuery},
    MiniGitError, SessionManager,
};
use std::path::Path;

#[test]
fn test_validate_repo_root() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap();

    let res = validate_repo(repo_root.to_str().unwrap());
    assert!(res.is_ok(), "Failed to validate repo root: {:?}", res.err());

    let info = res.unwrap();
    assert!(info.is_valid);
    assert_eq!(info.name, "openToolBox");
}

#[test]
fn test_validate_repo_subdir() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let subdir = manifest_dir.join("src");

    let res = validate_repo(subdir.to_str().unwrap());
    assert!(res.is_err());
    let err = res.unwrap_err();
    match err {
        MiniGitError::NotRepoRoot(_) => {}
        other => panic!("Expected NotRepoRoot error, got {:?}", other),
    }
}

#[test]
fn test_validate_repo_not_git() {
    let temp_dir = std::env::temp_dir();
    let res = validate_repo(temp_dir.to_str().unwrap());
    assert!(res.is_err());
    let err = res.unwrap_err();
    match err {
        MiniGitError::NotGitRepo(_) | MiniGitError::NotRepoRoot(_) => {}
        other => panic!("Expected NotGitRepo or NotRepoRoot, got {:?}", other),
    }
}

#[test]
fn test_session_lifecycle_and_operations() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap();
    let repo_root_str = repo_root.to_str().unwrap();

    let mgr = SessionManager::new();

    // 1. Open session
    let session_id = mgr.open_session(repo_root_str).expect("open_session failed");
    assert!(!session_id.is_empty());

    // 2. Get repo handle
    let git_repo = mgr.get_repo(&session_id).expect("get_repo failed");

    // 3. Repo state
    let state = repo::get_repo_state(&git_repo).expect("get_repo_state failed");
    assert!(state.head_oid.is_some(), "HEAD OID should exist");
    assert!(!state.head_oid.as_ref().unwrap().is_empty());

    // 4. List refs
    let refs_data = refs::list_refs(&git_repo).expect("list_refs failed");
    assert!(!refs_data.local_branches.is_empty(), "Local branches should not be empty");

    // 5. Tracked files & dir
    let tracked = tree::list_tracked_files(&git_repo).expect("list_tracked_files failed");
    assert!(
        tracked.iter().any(|f| f.ends_with("package.json") || f.ends_with("Cargo.toml")),
        "Tracked files should include package.json or Cargo.toml"
    );

    let dir_entries = tree::list_dir(&git_repo, "").expect("list_dir failed");
    assert!(
        dir_entries.iter().any(|e| e.name == "src" && e.is_dir),
        "Root dir should contain src directory"
    );

    // 6. Read file meta and content
    let meta = blob::read_workspace_file_meta(&git_repo, "package.json").expect("read_workspace_file_meta failed");
    assert!(!meta.is_binary);
    assert!(meta.size > 0);

    let content = blob::read_workspace_file_text(&git_repo, "package.json").expect("read_workspace_file_text failed");
    assert!(content.contains("open-toolbox"));

    // 7. Working status
    let st = status::working_status(&git_repo).expect("working_status failed");
    let _ = st.total_changes;

    // 8. Commit log walk
    let walk_id = mgr
        .open_walk(&session_id, LogFilter { refname: None, author_contains: None })
        .expect("open_walk failed");
    let page = mgr.next_walk_page(&walk_id, 10).expect("next_walk_page failed");
    assert!(!page.commits.is_empty(), "Commit history should contain commits");
    let first_commit_oid = page.commits[0].oid.clone();
    mgr.close_walk(&walk_id);

    // 9. Commit detail
    let detail = log::get_commit_detail(&git_repo, &first_commit_oid).expect("get_commit_detail failed");
    assert_eq!(detail.oid, first_commit_oid);
    assert!(!detail.message.is_empty());

    // 9.1 Unpushed commits
    let unpushed = log::get_unpushed_commits(&git_repo, 20).expect("get_unpushed_commits failed");
    println!("Found {} unpushed commits", unpushed.len());
    for c in &unpushed {
        assert!(!c.oid.is_empty());
        assert!(!c.summary.is_empty());
    }

    // 10. Diff prepare
    let diff_source = format!("commit:{}", first_commit_oid);
    if let Some(first_file) = detail.files.first() {
        let plan = diff::diff_prepare(&git_repo, &diff_source, &first_file.path).expect("diff_prepare failed");
        assert_eq!(plan.rel_path, first_file.path);
    }

    // 11. Search commits
    let search_id = mgr
        .start_search(
            &session_id,
            SearchQuery {
                text: "fix".to_string(),
                refname: None,
                author_contains: None,
            },
        )
        .expect("start_search failed");
    let search_progress = mgr.poll_search(&search_id).expect("poll_search failed");
    let _ = search_progress.scanned_count;
    mgr.cancel_search(&search_id);

    // 12. Close session
    mgr.close_session(&session_id);
    let after_close = mgr.get_repo(&session_id);
    assert!(after_close.is_err(), "Session should be closed");
}
