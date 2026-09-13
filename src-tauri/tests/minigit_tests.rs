use open_toolbox_lib::minigit::repo::validate_repo;
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
        open_toolbox_lib::minigit::MiniGitError::NotRepoRoot(_) => {}
        other => panic!("Expected NotRepoRoot error, got {:?}", other),
    }
}
