use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use git2::{Oid, Repository, Sort};
use super::error::MiniGitError;
use super::types::{CommitSummary, LogFilter, LogPage, SearchProgress, SearchQuery};

pub struct ActiveWalk {
    pub repo_path: PathBuf,
    pub filter: LogFilter,
    pub oids: Vec<Oid>,
    pub current_offset: usize,
    pub last_accessed: Instant,
}

pub struct ActiveSearch {
    pub cancel_flag: Arc<AtomicBool>,
    pub results: Vec<CommitSummary>,
    pub scanned_count: usize,
    pub matched_count: usize,
    pub is_done: bool,
    pub last_accessed: Instant,
}

pub struct RepoSession {
    pub id: String,
    pub path: PathBuf,
    pub last_accessed: Instant,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, RepoSession>>,
    walks: Mutex<HashMap<String, ActiveWalk>>,
    searches: Mutex<HashMap<String, ActiveSearch>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            walks: Mutex::new(HashMap::new()),
            searches: Mutex::new(HashMap::new()),
        }
    }

    pub fn open_session(&self, path_str: &str) -> Result<String, MiniGitError> {
        let path = Path::new(path_str);
        if !path.exists() {
            return Err(MiniGitError::PathNotFound(
                "仓库路径不存在，可能已被移动或删除".to_string(),
            ));
        }

        let canonical_path = std::fs::canonicalize(path).map_err(|_| {
            MiniGitError::PathNotFound("仓库路径不存在，可能已被移动或删除".to_string())
        })?;

        // Open repo to verify
        let _ = Repository::open(&canonical_path)
            .map_err(|_| MiniGitError::NotGitRepo("该目录不是 Git 仓库".to_string()))?;

        let repo_id = uuid::Uuid::new_v4().to_string();
        let mut sessions = self.sessions.lock().unwrap();

        // Max 3 sessions: evict oldest
        if sessions.len() >= 3 {
            if let Some(oldest_id) = sessions
                .iter()
                .min_by_key(|(_, s)| s.last_accessed)
                .map(|(k, _)| k.clone())
            {
                sessions.remove(&oldest_id);
            }
        }

        sessions.insert(
            repo_id.clone(),
            RepoSession {
                id: repo_id.clone(),
                path: canonical_path,
                last_accessed: Instant::now(),
            },
        );

        Ok(repo_id)
    }

    pub fn close_session(&self, repo_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(repo_id);

        let mut walks = self.walks.lock().unwrap();
        walks.retain(|id, _| !id.starts_with(repo_id));

        let mut searches = self.searches.lock().unwrap();
        searches.retain(|id, _| !id.starts_with(repo_id));
    }

    pub fn get_repo_path(&self, repo_id: &str) -> Result<PathBuf, MiniGitError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(repo_id)
            .ok_or_else(|| MiniGitError::SessionNotFound("仓库会话已过期或不存在".to_string()))?;
        session.last_accessed = Instant::now();
        Ok(session.path.clone())
    }

    pub fn get_repo(&self, repo_id: &str) -> Result<Repository, MiniGitError> {
        let path = self.get_repo_path(repo_id)?;
        Repository::open(&path)
            .map_err(|e| MiniGitError::RepoCorrupted(format!("无法打开仓库: {}", e)))
    }

    pub fn open_walk(&self, repo_id: &str, filter: LogFilter) -> Result<String, MiniGitError> {
        let path = self.get_repo_path(repo_id)?;
        let repo = Repository::open(&path)
            .map_err(|e| MiniGitError::RepoCorrupted(e.message().to_string()))?;

        let mut walk = repo
            .revwalk()
            .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

        walk.set_sorting(Sort::TIME)
            .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

        if let Some(refname) = &filter.refname {
            if let Ok(reference) = repo.find_reference(refname) {
                if let Some(target) = reference.target() {
                    let _ = walk.push(target);
                }
            } else if let Ok(oid) = Oid::from_str(refname) {
                let _ = walk.push(oid);
            }
        } else if let Ok(head) = repo.head() {
            if let Some(target) = head.target() {
                let _ = walk.push(target);
            }
        }

        let mut oids = Vec::new();
        for oid_res in walk {
            if let Ok(oid) = oid_res {
                oids.push(oid);
            } else {
                break;
            }
        }

        let walk_id = format!("{}:{}", repo_id, uuid::Uuid::new_v4());
        let mut walks = self.walks.lock().unwrap();

        // Max 4 walks per session
        let session_walks_count = walks.iter().filter(|(k, _)| k.starts_with(repo_id)).count();
        if session_walks_count >= 4 {
            if let Some(oldest_k) = walks
                .iter()
                .filter(|(k, _)| k.starts_with(repo_id))
                .min_by_key(|(_, w)| w.last_accessed)
                .map(|(k, _)| k.clone())
            {
                walks.remove(&oldest_k);
            }
        }

        walks.insert(
            walk_id.clone(),
            ActiveWalk {
                repo_path: path,
                filter,
                oids,
                current_offset: 0,
                last_accessed: Instant::now(),
            },
        );

        Ok(walk_id)
    }

    pub fn next_walk_page(&self, walk_id: &str, limit: usize) -> Result<LogPage, MiniGitError> {
        let (path, filter, oids_slice, offset, total_traversed) = {
            let mut walks = self.walks.lock().unwrap();
            let walk = walks
                .get_mut(walk_id)
                .ok_or_else(|| MiniGitError::CursorNotFound("游标已过期或不存在".to_string()))?;
            walk.last_accessed = Instant::now();

            let start = walk.current_offset;
            let end = (start + limit).min(walk.oids.len());
            let slice = walk.oids[start..end].to_vec();
            walk.current_offset = end;
            (
                walk.repo_path.clone(),
                walk.filter.clone(),
                slice,
                end,
                walk.oids.len(),
            )
        };

        let repo = Repository::open(&path)
            .map_err(|e| MiniGitError::RepoCorrupted(e.message().to_string()))?;

        let mut commits = Vec::with_capacity(oids_slice.len());
        for oid in oids_slice {
            if let Ok(commit) = repo.find_commit(oid) {
                if let Some(author_sub) = &filter.author_contains {
                    let author_name = commit.author().name().unwrap_or("").to_lowercase();
                    if !author_name.contains(&author_sub.to_lowercase()) {
                        continue;
                    }
                }
                commits.push(super::log::commit_to_summary(&commit));
            }
        }

        // Stability sort
        commits.sort_by(|a, b| {
            if a.committer_time != b.committer_time {
                b.committer_time.cmp(&a.committer_time)
            } else {
                a.oid.cmp(&b.oid)
            }
        });

        let has_more = offset < total_traversed;

        Ok(LogPage {
            commits,
            has_more,
            traversed_count: offset,
        })
    }

    pub fn close_walk(&self, walk_id: &str) {
        let mut walks = self.walks.lock().unwrap();
        walks.remove(walk_id);
    }

    pub fn start_search(&self, repo_id: &str, query: SearchQuery) -> Result<String, MiniGitError> {
        let search_id = format!("{}:{}", repo_id, uuid::Uuid::new_v4());
        let cancel_flag = Arc::new(AtomicBool::new(false));

        let path = self.get_repo_path(repo_id)?;
        let cancel_clone = cancel_flag.clone();

        // Run initial scan
        let repo = Repository::open(&path)
            .map_err(|e| MiniGitError::RepoCorrupted(e.message().to_string()))?;

        let progress = super::log::search_commits(&repo, query, cancel_clone, 500, 50, 0)?;

        let mut searches = self.searches.lock().unwrap();
        searches.insert(
            search_id.clone(),
            ActiveSearch {
                cancel_flag,
                results: progress.results,
                scanned_count: progress.scanned_count,
                matched_count: progress.matched_count,
                is_done: progress.is_done,
                last_accessed: Instant::now(),
            },
        );

        Ok(search_id)
    }

    pub fn poll_search(&self, search_id: &str) -> Result<SearchProgress, MiniGitError> {
        let mut searches = self.searches.lock().unwrap();
        let search = searches
            .get_mut(search_id)
            .ok_or_else(|| MiniGitError::Other("搜索任务不存在".to_string()))?;
        search.last_accessed = Instant::now();

        Ok(SearchProgress {
            search_id: search_id.to_string(),
            scanned_count: search.scanned_count,
            matched_count: search.matched_count,
            results: search.results.clone(),
            is_done: search.is_done,
        })
    }

    pub fn cancel_search(&self, search_id: &str) {
        let mut searches = self.searches.lock().unwrap();
        if let Some(search) = searches.get_mut(search_id) {
            search.cancel_flag.store(true, Ordering::Relaxed);
        }
        searches.remove(search_id);
    }
}
