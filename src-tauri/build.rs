fn main() {
    tauri_build::build();

    // 久坐提醒的平台门控别名。该功能唯一的平台相关点是「读取系统空闲时长」
    // （Windows `GetLastInputInfo` / macOS `CGEventSourceSecondsSinceLastEventType`），
    // 其余配置、视频、弹窗窗口逻辑都是跨平台的。
    // Linux 暂无空闲检测实现，故不纳入；将来补上只需在此处加一个平台。
    // 密码夹身份验证用到 LocalAuthentication（LAContext）。该框架不会被默认链接，
    // 不显式声明时运行期取不到 LAContext 类，验证会按 fail-closed 直接拒绝 ——
    // 表现为密码夹在 macOS 上完全无法打开，且编译期无任何提示。
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=LocalAuthentication");

    // 全平台截图的门控别名。macOS 端实现存在已知缺陷，暂时停用；
    // Windows 与 Linux(X11) 不受影响。
    // 该门禁同时覆盖截图工具本身、全局截图快捷键、贴图（pin）托盘项与恢复快捷键 ——
    // 只关工具入口不够：快捷键独立于工具注册表，仍会触发同一段代码。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    println!("cargo::rustc-check-cfg=cfg(screenshot_supported)");
    if target_os != "macos" {
        println!("cargo::rustc-cfg=screenshot_supported");
    }

    // 便利贴的门控别名。macOS 端实现存在已知缺陷，暂时停用；
    // 覆盖工具入口与两个全局快捷键（便利贴 / 单便利贴）。
    println!("cargo::rustc-check-cfg=cfg(sticky_supported)");
    if target_os != "macos" {
        println!("cargo::rustc-cfg=sticky_supported");
    }

    println!("cargo::rustc-check-cfg=cfg(sedentary_supported)");
    if matches!(target_os.as_str(), "windows" | "macos") {
        println!("cargo::rustc-cfg=sedentary_supported");
    }

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
