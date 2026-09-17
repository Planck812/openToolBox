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
    println!("Found {} unpushed commits", unpushed.commits.len());
    for c in &unpushed.commits {
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

/// 在临时目录里建一个仓库，并写入首个提交。
fn init_test_repo(dir: &Path, file: &str, content: &str) -> (git2::Repository, git2::Oid) {
    let repo = git2::Repository::init(dir).expect("init repo failed");
    std::fs::write(dir.join(file), content).expect("write file failed");
    let oid = commit_all(&repo, "c1", None);
    (repo, oid)
}

/// 暂存工作区全部内容并提交，返回提交 oid。
fn commit_all(repo: &git2::Repository, message: &str, parent: Option<git2::Oid>) -> git2::Oid {
    let sig = git2::Signature::now("Test", "test@example.com").expect("signature failed");
    let mut index = repo.index().expect("index failed");
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .expect("add_all failed");
    index.write().expect("index write failed");
    let tree = repo
        .find_tree(index.write_tree().expect("write_tree failed"))
        .expect("find_tree failed");

    let parent_commit = parent.map(|p| repo.find_commit(p).expect("find_commit failed"));
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .expect("commit failed")
}

#[test]
fn test_diff_commit_local_compares_against_working_tree() {
    let tmp = tempfile::tempdir().expect("tempdir failed");
    let dir = tmp.path();
    let (repo, c1) = init_test_repo(dir, "a.txt", "v1\n");

    std::fs::write(dir.join("a.txt"), "v2\n").expect("write failed");
    let c2 = commit_all(&repo, "c2", Some(c1));

    // 工作区再改一次，但不提交
    std::fs::write(dir.join("a.txt"), "v3\n").expect("write failed");

    // 与本地对比：左边是 c1 的版本，右边是磁盘上的当前内容（含未提交改动）
    let plan = diff::diff_prepare(&repo, &format!("commit-local:{}", c1), "a.txt")
        .expect("diff_prepare failed");
    assert_eq!(plan.old_content.as_deref(), Some("v1\n"));
    assert_eq!(plan.new_content.as_deref(), Some("v3\n"));

    // 对照：与父提交对比时看不到未提交的 v3
    let plan_parent = diff::diff_prepare(&repo, &format!("commit:{}", c2), "a.txt")
        .expect("diff_prepare failed");
    assert_eq!(plan_parent.old_content.as_deref(), Some("v1\n"));
    assert_eq!(plan_parent.new_content.as_deref(), Some("v2\n"));
}

#[test]
fn test_diff_commit_local_handles_missing_files() {
    let tmp = tempfile::tempdir().expect("tempdir failed");
    let dir = tmp.path();
    let (repo, c1) = init_test_repo(dir, "a.txt", "v1\n");

    // 本地删掉文件：右边为空，整体呈现为删除
    std::fs::remove_file(dir.join("a.txt")).expect("remove failed");
    let deleted = diff::diff_prepare(&repo, &format!("commit-local:{}", c1), "a.txt")
        .expect("diff_prepare failed");
    assert_eq!(deleted.old_content.as_deref(), Some("v1\n"));
    assert_eq!(deleted.new_content.as_deref(), Some(""));
    assert!(deleted.deletions > 0);

    // 提交里没有、但本地新增的文件：左边为空
    std::fs::write(dir.join("b.txt"), "new\n").expect("write failed");
    let added = diff::diff_prepare(&repo, &format!("commit-local:{}", c1), "b.txt")
        .expect("diff_prepare failed");
    assert_eq!(added.old_content.as_deref(), Some(""));
    assert_eq!(added.new_content.as_deref(), Some("new\n"));
    assert!(added.additions > 0);
}
