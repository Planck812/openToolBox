use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "code", content = "message")]
pub enum MiniGitError {
    NotGitRepo(String),
    NotRepoRoot(String),
    BareRepo(String),
    PathNotFound(String),
    AccessDenied(String),
    MacosPermissionDenied(String),
    RepoCorrupted(String),
    RepoNotFound(String),
    ReadFileFailed(String),
    FileTooLarge(String),
    BinaryFile(String),
    DiffTimeout(String),
    DiffTooLarge(String),
    ListDirFailed(String),
    ShortcutConflict(String),
    ShortcutRegisterFailed(String),
    ConfigSaveFailed(String),
    ConfigCorrupted(String),
    ExternalLinkConfirm(String),
    SessionNotFound(String),
    CursorNotFound(String),
    TaskCancelled(String),
    Other(String),
}

impl std::fmt::Display for MiniGitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MiniGitError::NotGitRepo(msg) => write!(f, "{}", msg),
            MiniGitError::NotRepoRoot(msg) => write!(f, "{}", msg),
            MiniGitError::BareRepo(msg) => write!(f, "{}", msg),
            MiniGitError::PathNotFound(msg) => write!(f, "{}", msg),
            MiniGitError::AccessDenied(msg) => write!(f, "{}", msg),
            MiniGitError::MacosPermissionDenied(msg) => write!(f, "{}", msg),
            MiniGitError::RepoCorrupted(msg) => write!(f, "{}", msg),
            MiniGitError::RepoNotFound(msg) => write!(f, "{}", msg),
            MiniGitError::ReadFileFailed(msg) => write!(f, "{}", msg),
            MiniGitError::FileTooLarge(msg) => write!(f, "{}", msg),
            MiniGitError::BinaryFile(msg) => write!(f, "{}", msg),
            MiniGitError::DiffTimeout(msg) => write!(f, "{}", msg),
            MiniGitError::DiffTooLarge(msg) => write!(f, "{}", msg),
            MiniGitError::ListDirFailed(msg) => write!(f, "{}", msg),
            MiniGitError::ShortcutConflict(msg) => write!(f, "{}", msg),
            MiniGitError::ShortcutRegisterFailed(msg) => write!(f, "{}", msg),
            MiniGitError::ConfigSaveFailed(msg) => write!(f, "{}", msg),
            MiniGitError::ConfigCorrupted(msg) => write!(f, "{}", msg),
            MiniGitError::ExternalLinkConfirm(msg) => write!(f, "{}", msg),
            MiniGitError::SessionNotFound(msg) => write!(f, "{}", msg),
            MiniGitError::CursorNotFound(msg) => write!(f, "{}", msg),
            MiniGitError::TaskCancelled(msg) => write!(f, "{}", msg),
            MiniGitError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for MiniGitError {}

impl From<git2::Error> for MiniGitError {
    fn from(err: git2::Error) -> Self {
        MiniGitError::Other(err.message().to_string())
    }
}

impl From<std::io::Error> for MiniGitError {
    fn from(err: std::io::Error) -> Self {
        MiniGitError::Other(err.to_string())
    }
}
