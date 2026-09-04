fn main() {
    tauri_build::build();

    // Windows 测试目标嵌入 comctl32 v6 manifest：`cargo test` 生成的测试 exe 默认无
    // manifest，一旦测试链接 tauri 运行时（如 tauri-specta 导出测试）就会因 comctl32
    // v5.82 缺 v6 导出函数而 STATUS_ENTRYPOINT_NOT_FOUND 启动失败。见 win-test.manifest 注释。
    #[cfg(target_os = "windows")]
    {
        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("win-test.manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
    }
}
