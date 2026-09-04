//! tauri-specta 试点绑定生成测试。
//!
//! 为什么放在集成测试而不是 lib 单元测试：`collect_commands!` 会连带链接 tauri 运行时
//! （wry/tao），Windows 上无 manifest 的测试 exe 会因 comctl32 v5.82 缺 v6 导出函数而
//! `STATUS_ENTRYPOINT_NOT_FOUND` 启动失败。build.rs 通过 `cargo:rustc-link-arg-tests`
//! 给集成测试目标嵌入 `win-test.manifest`（声明 common-controls v6 依赖），故本测试可
//! 正常启动。
//!
//! 本测试是「绑定漂移门禁」：先快照当前已提交的 `src/lib/ipc/bindings.ts`，再触发导出
//! （`export_specta_bindings` 会写回该文件），随后读回并逐字节比对；不一致即 panic。
//! 这样 Rust 命令签名一旦改变而 `bindings.ts` 未同步提交，CI 即失败，前端 vue-tsc
//! 也不会再按旧类型蒙混过关，避免运行期 IPC 参数错位。

use open_toolbox_lib::export_specta_bindings;
use std::path::Path;

/// 读取文件并归一化行尾（去掉 `\r`），避免 Windows checkout 的 autocrlf 转换造成逐字节假阳性。
fn read_normalized(path: &Path) -> Vec<u8> {
    std::fs::read(path)
        .expect("读取 bindings.ts 失败")
        .into_iter()
        .filter(|&byte| byte != b'\r')
        .collect()
}

#[test]
fn exports_specta_bindings() {
    let bindings_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/ipc/bindings.ts");

    // 先快照已提交内容；导出会写回 bindings.ts，随后读回再比对。
    let committed = read_normalized(&bindings_path);

    export_specta_bindings().expect("specta 导出 TS 绑定失败");

    let regenerated = read_normalized(&bindings_path);

    assert_eq!(
        committed,
        regenerated,
        "bindings.ts 与 Rust 命令签名漂移：本测试已重新生成 `src/lib/ipc/bindings.ts`，请审查并一并提交"
    );
}
