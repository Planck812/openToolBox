use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use git2::{Commit, Oid, Repository, Revwalk, Sort};
use super::error::MiniGitError;
use super::types::{ChangedFile, CommitDetail, CommitSummary, LogFilter, LogPage, SearchProgress, SearchQuery, UnpushedCommits};

pub struct CommitWalker<'a> {
    walk: Revwalk<'a>,
    repo: &'a Repository,
    filter: LogFilter,
    total_traversed: usize,
}

impl<'a> CommitWalker<'a> {
    pub fn new(repo: &'a Repository, filter: LogFilter) -> Result<Self, MiniGitError> {
        let mut walk = repo
            .revwalk()
            .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

        // Mandate CN-1: Sort by TIME, do not use TOPOLOGICAL sort!
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
        } else {
            // Push HEAD
            if let Ok(head) = repo.head() {
                if let Some(target) = head.target() {
                    let _ = walk.push(target);
                }
            }
        }

        Ok(Self {
            walk,
            repo,
            filter,
            total_traversed: 0,
        })
    }

    pub fn next_page(&mut self, limit: usize) -> Result<LogPage, MiniGitError> {
        let mut commits = Vec::with_capacity(limit);
        let mut has_more = false;

        while commits.len() < limit {
            let next_oid = match self.walk.next() {
                Some(Ok(oid)) => oid,
                Some(Err(_)) => {
                    // Shallow clone boundary or corrupt loose object: stop gracefully
                    break;
                }
                None => break,
            };

            self.total_traversed += 1;

            if let Ok(commit) = self.repo.find_commit(next_oid) {
                if let Some(author_sub) = &self.filter.author_contains {
                    let author_name = commit.author().name().unwrap_or("").to_lowercase();
                    if !author_name.contains(&author_sub.to_lowercase()) {
                        continue;
                    }
                }

                commits.push(commit_to_summary(&commit));
            }
        }

        // Check if there is at least one more
        // Secondary sort within the batch by (committer_date DESC, oid ASC) for absolute stability
        commits.sort_by(|a, b| {
            if a.committer_time != b.committer_time {
                b.committer_time.cmp(&a.committer_time)
            } else {
                a.oid.cmp(&b.oid)
            }
        });

        // Determine if more commits exist
        if commits.len() == limit {
            has_more = true;
        }

        Ok(LogPage {
            commits,
            has_more,
            traversed_count: self.total_traversed,
        })
    }
}

pub fn commit_to_summary(commit: &Commit) -> CommitSummary {
    let oid_str = commit.id().to_string();
    let short_oid = oid_str.chars().take(7).collect();
    let author = commit.author();
    let committer = commit.committer();

    let raw_msg = commit.message_bytes();
    let message = decode_commit_message(raw_msg, commit.message_encoding());
    let summary = message.lines().next().unwrap_or("").to_string();

    let parent_oids: Vec<String> = commit.parent_ids().map(|id| id.to_string()).collect();

    CommitSummary {
        oid: oid_str,
        short_oid,
        author_name: author.name().unwrap_or("Unknown").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer_name: committer.name().unwrap_or("Unknown").to_string(),
        committer_time: committer.when().seconds(),
        summary,
        parent_oids,
    }
}

pub fn decode_commit_message(bytes: &[u8], encoding: Option<&str>) -> String {
    if bytes.is_empty() {
        return "Empty commit message".to_string();
    }

    if let Some(enc) = encoding {
        if enc.eq_ignore_ascii_case("gbk") || enc.eq_ignore_ascii_case("gb2312") {
            // Lossy decode or simple fallback
            return String::from_utf8_lossy(bytes).to_string();
        }
    }

    String::from_utf8(bytes.to_vec())
        .unwrap_or_else(|_| String::from_utf8_lossy(bytes).to_string())
}

pub fn get_commit_detail(repo: &Repository, oid_str: &str) -> Result<CommitDetail, MiniGitError> {
    let oid = Oid::from_str(oid_str).map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let oid_s = commit.id().to_string();
    let short_oid = oid_s.chars().take(7).collect();
    let author = commit.author();
    let committer = commit.committer();

    let raw_msg = commit.message_bytes();
    let message = decode_commit_message(raw_msg, commit.message_encoding());
    let summary = message.lines().next().unwrap_or("").to_string();

    let parent_oids: Vec<String> = commit.parent_ids().map(|id| id.to_string()).collect();
    let is_root = parent_oids.is_empty();
    let is_merge = parent_oids.len() > 1;

    let files = get_commit_changed_files(repo, &commit)?;

    Ok(CommitDetail {
        oid: oid_s,
        short_oid,
        author_name: author.name().unwrap_or("Unknown").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        author_tz_offset: author.when().offset_minutes(),
        committer_name: committer.name().unwrap_or("Unknown").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        committer_time: committer.when().seconds(),
        committer_tz_offset: committer.when().offset_minutes(),
        message,
        summary,
        parent_oids,
        is_root,
        is_merge,
        files,
    })
}

pub fn get_commit_changed_files(
    repo: &Repository,
    commit: &Commit,
) -> Result<Vec<ChangedFile>, MiniGitError> {
    let current_tree = commit
        .tree()
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let parent_tree = if commit.parent_count() > 0 {
        // Base is first parent
        let p = commit
            .parent(0)
            .map_err(|e| MiniGitError::Other(e.message().to_string()))?;
        Some(p.tree().map_err(|e| MiniGitError::Other(e.message().to_string()))?)
    } else {
        // Root commit: base is empty tree
        None
    };

    let mut diff_opts = git2::DiffOptions::new();
    let mut diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&current_tree), Some(&mut diff_opts))
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true);
    find_opts.rename_threshold(50);
    find_opts.rename_limit(1000);
    find_opts.copies(false); // Disable copy detection
    let _ = diff.find_similar(Some(&mut find_opts));

    let stats = diff.stats().ok();
    let (total_additions, total_deletions) = stats
        .map(|s| (s.insertions() as u32, s.deletions() as u32))
        .unwrap_or((0, 0));

    let mut files = Vec::new();
    let num_deltas = diff.deltas().len();

    for i in 0..num_deltas {
        if let Some(delta) = diff.get_delta(i) {
            let old_file = delta.old_file();
            let new_file = delta.new_file();

            let path = new_file
                .path()
                .or_else(|| old_file.path())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            let old_path = if delta.status() == git2::Delta::Renamed {
                old_file.path().map(|p| p.to_string_lossy().replace('\\', "/"))
            } else {
                None
            };

            let status_str = match delta.status() {
                git2::Delta::Added => "A",
                git2::Delta::Deleted => "D",
                git2::Delta::Modified => "M",
                git2::Delta::Renamed => "R",
                git2::Delta::Typechange => "T",
                _ => "M",
            }
            .to_string();

            files.push(ChangedFile {
                path,
                old_path,
                status: status_str,
                staged_status: None,
                unstaged_status: None,
                additions: total_additions,
                deletions: total_deletions,
            });
        }
    }

    Ok(files)
}

pub fn search_commits(
    repo: &Repository,
    query: SearchQuery,
    cancel_flag: Arc<AtomicBool>,
    max_scan: usize,
    batch_size: usize,
    start_skip: usize,
) -> Result<SearchProgress, MiniGitError> {
    let mut walk = repo
        .revwalk()
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    walk.set_sorting(Sort::TIME)
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    if let Some(refname) = &query.refname {
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

    let q_text = query.text.trim().to_lowercase();
    let is_hex_prefix = q_text.len() >= 4 && q_text.chars().all(|c| c.is_ascii_hexdigit());

    let mut scanned = 0usize;
    let mut matched = 0usize;
    let mut results = Vec::new();
    let mut is_done = false;

    let mut current_idx = 0usize;

    for oid_res in walk {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(MiniGitError::TaskCancelled("搜索已被取消".to_string()));
        }

        let oid = match oid_res {
            Ok(o) => o,
            Err(_) => break,
        };

        if current_idx < start_skip {
            current_idx += 1;
            continue;
        }

        scanned += 1;
        current_idx += 1;

        if let Ok(commit) = repo.find_commit(oid) {
            // Author filter
            if let Some(author_sub) = &query.author_contains {
                let author_name = commit.author().name().unwrap_or("").to_lowercase();
                if !author_name.contains(&author_sub.to_lowercase()) {
                    continue;
                }
            }

            let oid_str = oid.to_string();
            let mut matches = false;

            // Hash prefix match
            if is_hex_prefix && oid_str.starts_with(&q_text) {
                matches = true;
            }

            if !matches {
                let msg = commit.message().unwrap_or("").to_lowercase();
                if msg.contains(&q_text) {
                    matches = true;
                }
            }

            if matches {
                matched += 1;
                results.push(commit_to_summary(&commit));
                if results.len() >= batch_size {
                    break;
                }
            }
        }

        if scanned >= max_scan {
            break;
        }
    }

    if results.len() < batch_size {
        is_done = true;
    }

    Ok(SearchProgress {
        search_id: "".to_string(),
        scanned_count: scanned,
        matched_count: matched,
        results,
        is_done,
    })
}

pub fn get_unpushed_commits(
    repo: &Repository,
    limit: usize,
) -> Result<UnpushedCommits, MiniGitError> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(UnpushedCommits { commits: Vec::new(), total: 0, truncated: false }),
    };

    let head_oid = match head.target() {
        Some(oid) => oid,
        None => return Ok(UnpushedCommits { commits: Vec::new(), total: 0, truncated: false }),
    };

    let mut revwalk = repo
        .revwalk()
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    revwalk
        .set_sorting(Sort::TIME)
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;
    revwalk
        .push(head_oid)
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    let mut has_remote_or_upstream = false;

    // 1. Check if current branch has an upstream tracking branch configured
    if head.is_branch() {
        if let Some(branch_name) = head.shorthand() {
            if let Ok(branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
                if let Ok(upstream) = branch.upstream() {
                    if let Some(target) = upstream.get().target() {
                        let _ = revwalk.hide(target);
                        has_remote_or_upstream = true;
                    }
                }
            }
        }
    }

    // 2. If no upstream on branch, check remote tracking branches
    if !has_remote_or_upstream {
        let mut found_matching_remote = false;
        if let Some(branch_name) = head.shorthand() {
            if let Ok(remotes) = repo.remotes() {
                for remote_name in remotes.iter().flatten() {
                    let remote_ref = format!("refs/remotes/{}/{}", remote_name, branch_name);
                    if let Ok(r) = repo.find_reference(&remote_ref) {
                        if let Some(target) = r.target() {
                            let _ = revwalk.hide(target);
                            found_matching_remote = true;
                            has_remote_or_upstream = true;
                        }
                    }
                }
            }
        }

        // 3. Fallback: hide all remote tracking branches
        if !found_matching_remote {
            if let Ok(references) = repo.references_glob("refs/remotes/*") {
                for r in references.flatten() {
                    if let Some(target) = r.target() {
                        let _ = revwalk.hide(target);
                        has_remote_or_upstream = true;
                    }
                }
            }
        }
    }

    // If repository has no remotes and no upstream at all, return empty list
    if !has_remote_or_upstream {
        return Ok(UnpushedCommits { commits: Vec::new(), total: 0, truncated: false });
    }

    let mut commits = Vec::new();
    let mut total: u32 = 0;

    for oid_res in revwalk {
        let oid = match oid_res {
            Ok(id) => id,
            Err(_) => break,
        };
        total = total.saturating_add(1);
        // 超过 limit 后只继续计数，不再构造摘要
        if commits.len() >= limit {
            continue;
        }
        if let Ok(commit) = repo.find_commit(oid) {
            commits.push(commit_to_summary(&commit));
        }
    }

    let truncated = total as usize > commits.len();
    Ok(UnpushedCommits { commits, total, truncated })
}

