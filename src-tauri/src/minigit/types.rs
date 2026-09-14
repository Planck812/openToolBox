use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
    pub is_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RepoState {
    pub head_oid: Option<String>,
    pub head_name: Option<String>,
    pub is_detached: bool,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TreeEntry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub is_submodule: bool,
    pub is_symlink: bool,
    pub symlink_target: Option<String>,
    pub is_ignored: bool,
    pub is_tracked: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RefInfo {
    pub name: String,
    pub short_name: String,
    pub target_oid: Option<String>,
    pub is_head: bool,
    pub is_tag: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Refs {
    pub local_branches: Vec<RefInfo>,
    pub remote_branches: Vec<RefInfo>,
    pub tags: Vec<RefInfo>,
    pub head: Option<RefInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub staged_status: Option<String>,
    pub unstaged_status: Option<String>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkingStatus {
    pub staged: Vec<ChangedFile>,
    pub unstaged: Vec<ChangedFile>,
    pub untracked: Vec<ChangedFile>,
    pub conflicted: Vec<ChangedFile>,
    pub total_changes: usize,
    pub is_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_name: String,
    pub committer_time: i64,
    pub summary: String,
    pub parent_oids: Vec<String>,
}

/// 未推送提交列表。`commits` 至多 `limit` 条摘要，`total` 是不受 limit 限制的精确总数。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UnpushedCommits {
    pub commits: Vec<CommitSummary>,
    pub total: u32,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommitDetail {
    pub oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub author_tz_offset: i32,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_time: i64,
    pub committer_tz_offset: i32,
    pub message: String,
    pub summary: String,
    pub parent_oids: Vec<String>,
    pub is_root: bool,
    pub is_merge: bool,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LogPage {
    pub commits: Vec<CommitSummary>,
    pub has_more: bool,
    pub traversed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LogFilter {
    pub refname: Option<String>,
    pub author_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SearchQuery {
    pub text: String,
    pub refname: Option<String>,
    pub author_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SearchProgress {
    pub search_id: String,
    pub scanned_count: usize,
    pub matched_count: usize,
    pub results: Vec<CommitSummary>,
    pub is_done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DiffLine {
    pub origin: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DiffPlan {
    pub tier: String,
    pub source: String,
    pub rel_path: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub old_size: u64,
    pub new_size: u64,
    pub reason: Option<String>,
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileMeta {
    pub size: u64,
    pub is_binary: bool,
    pub encoding: String,
    pub is_lfs_pointer: bool,
    pub lfs_oid: Option<String>,
    pub lfs_size: Option<u64>,
}
