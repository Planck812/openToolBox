//! WebView2 启动参数一致性。
//!
//! `additional_browser_args` 进的是进程级的 `CoreWebView2Environment`。同一 user data
//! 目录下用不同参数创建第二个环境会以 `ERROR_INVALID_STATE` 失败，表现为某个窗口毫无
//! 征兆地打不开。主窗口的参数写在 `tauri.conf.json`，其余九个窗口用 Rust 常量，
//! 两者必须逐字节相同——这个测试就是守着这条不变量，别让某一侧被单独改掉。

use std::path::Path;

#[test]
fn webview_browser_args_match_tauri_conf() {
    let conf_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&conf_path).expect("读取 tauri.conf.json 失败");
    let conf: serde_json::Value = serde_json::from_str(&raw).expect("解析 tauri.conf.json 失败");

    let from_conf = conf["app"]["windows"][0]["additionalBrowserArgs"]
        .as_str()
        .expect("主窗口缺少 additionalBrowserArgs；它必须与 WEBVIEW_BROWSER_ARGS 一致");

    assert_eq!(
        from_conf,
        open_toolbox_lib::WEBVIEW_BROWSER_ARGS,
        "tauri.conf.json 的 additionalBrowserArgs 与 WEBVIEW_BROWSER_ARGS 不一致，\
         运行时会有窗口因环境参数冲突而创建失败"
    );
}

/// wry 默认会传 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，
/// 而自定义参数是整体替换而非追加。漏掉这段会把迷你菜单和 SmartScreen 重新打开，
/// 属于静默回归，单独锁一道。
#[test]
fn webview_browser_args_keep_wry_defaults() {
    assert!(
        open_toolbox_lib::WEBVIEW_BROWSER_ARGS
            .contains("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"),
        "自定义参数必须原样带上 wry 的默认值，否则等同于把它们关掉"
    );
}
