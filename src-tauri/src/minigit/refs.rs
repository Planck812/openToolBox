use git2::{ReferenceType, Repository};
use super::error::MiniGitError;
use super::types::{RefInfo, Refs};

pub fn list_refs(repo: &Repository) -> Result<Refs, MiniGitError> {
    let head_ref = repo.head().ok();
    let head_target = head_ref.as_ref().and_then(|h| h.target());
    let head_name = head_ref.as_ref().and_then(|h| h.name().map(|s| s.to_string()));
    let is_detached = repo.head_detached().unwrap_or(false);

    let mut local_branches = Vec::new();
    let mut remote_branches = Vec::new();
    let mut tags = Vec::new();

    let references = repo
        .references()
        .map_err(|e| MiniGitError::Other(e.message().to_string()))?;

    for ref_res in references {
        let reference = match ref_res {
            Ok(r) => r,
            Err(_) => continue,
        };

        let full_name = match reference.name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        let short_name = reference.shorthand().unwrap_or(&full_name).to_string();
        let target_oid = match reference.kind() {
            Some(ReferenceType::Direct) => reference.target().map(|o| o.to_string()),
            Some(ReferenceType::Symbolic) => reference
                .resolve()
                .ok()
                .and_then(|r| r.target().map(|o| o.to_string())),
            None => None,
        };

        let is_head = !is_detached && head_name.as_ref() == Some(&full_name);

        if full_name.starts_with("refs/heads/") {
            local_branches.push(RefInfo {
                name: full_name,
                short_name,
                target_oid,
                is_head,
                is_tag: false,
            });
        } else if full_name.starts_with("refs/remotes/") {
            // Remove "refs/remotes/" from short name if necessary, e.g. "origin/main"
            let rel_name = full_name.strip_prefix("refs/remotes/").unwrap_or(&short_name).to_string();
            remote_branches.push(RefInfo {
                name: full_name,
                short_name: rel_name,
                target_oid,
                is_head: false,
                is_tag: false,
            });
        } else if full_name.starts_with("refs/tags/") {
            tags.push(RefInfo {
                name: full_name,
                short_name,
                target_oid,
                is_head: false,
                is_tag: true,
            });
        }
    }

    let head_info = if is_detached {
        head_target.map(|oid| RefInfo {
            name: "HEAD".to_string(),
            short_name: oid.to_string().chars().take(7).collect(),
            target_oid: Some(oid.to_string()),
            is_head: true,
            is_tag: false,
        })
    } else {
        head_ref.map(|h| {
            let name = h.name().unwrap_or("HEAD").to_string();
            let short = h.shorthand().unwrap_or("HEAD").to_string();
            RefInfo {
                name,
                short_name: short,
                target_oid: head_target.map(|o| o.to_string()),
                is_head: true,
                is_tag: false,
            }
        })
    };

    Ok(Refs {
        local_branches,
        remote_branches,
        tags,
        head: head_info,
    })
}
