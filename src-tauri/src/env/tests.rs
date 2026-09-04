use super::{normalize_preview_request, validate_env_key, PreviewEnvWriteRequest};

#[test]
fn accepts_valid_environment_keys_and_trims_whitespace() {
    for (input, expected) in [
        ("PATH", "PATH"),
        (" _JAVA_HOME ", "_JAVA_HOME"),
        ("A1", "A1"),
        ("lower_case", "lower_case"),
    ] {
        assert_eq!(validate_env_key(input).unwrap(), expected);
    }
}

#[test]
fn normalizes_preview_request_key_before_platform_dispatch() {
    let request = PreviewEnvWriteRequest {
        key: "  APP_HOME  ".into(),
        value: "C:\\Program Files\\App".into(),
        targets: vec!["profile".into()],
    };

    let normalized = normalize_preview_request(request).unwrap();

    assert_eq!(normalized.key, "APP_HOME");
    assert_eq!(normalized.value, "C:\\Program Files\\App");
    assert_eq!(normalized.targets, vec!["profile"]);
}
#[test]
fn rejects_invalid_environment_keys() {
    for input in ["", "   ", "1BAD", "A-B", "A B", "PATH=value", "中文"] {
        assert!(
            validate_env_key(input).is_err(),
            "expected {input:?} to be rejected"
        );
    }
}
