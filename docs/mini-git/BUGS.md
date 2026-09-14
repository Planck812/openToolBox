# Mini-Git 缺陷清单

| 项目 | 内容 |
| --- | --- |
| 来源 | 对照 `PRD.md` / `DESIGN.md` / `TEST-CASES.md` 审阅现有实现 |
| 代码基线 | 分支 `minigit`，`70242f4` + 未提交改动 |
| 文档版本 | v1.0 |
| 最后更新 | 2026-09-14 |

> 按修复优先级排列。每条含：现象、位置、根因、修复方向、验证方式。
> 标注 ⚠ 的是会导致 CI 失败或功能在运行时不可用的。

---

## B-1 ⚠ 仓库所有权校验未关闭，只读挂载 / 网络共享下仓库无法打开

**现象**
仓库位于只读挂载卷、网络共享（SMB / NFS）、容器绑定挂载或跨子系统路径时，`mg_validate_repo` 与 `mg_open_session` 直接失败，报仓库损坏。

**位置**
全模块缺失。`src-tauri/src/lib.rs:742` 处只 `app.manage(SessionManager::new())`，没有任何 libgit2 全局选项初始化。

**根因**
libgit2 的 `git_repository__validate_ownership` 默认为 `true`，`git_repository_open_ext` 会调用 `validate_ownership()`，仓库不属于当前用户时直接拒绝打开并报 `repository path ... is not owned by current user`。这不是性能问题，是**根本打不开**。

**修复方向**
在应用初始化时一次性关闭该校验，位置与 `app.manage(...)` 同处即可：

```rust
// 本模块纯读，不做任何写入；关闭所有权校验以支持只读挂载、
// 网络共享与容器绑定挂载下的仓库。注意这是进程全局开关。
unsafe { git2::opts::set_verify_owner_validation(false) }
    .map_err(|e| /* 记录日志，不阻断启动 */)?;
```

需在代码注释中标明该开关是**进程全局**的。

**验证**
- Windows：`icacls <repo> /deny "$env:USERNAME":(OI)(CI)(W,D) /T` 后打开仓库应成功；回滚用 `/remove:d`
- Unix：`chmod -R a-w <repo>` 后打开仓库应成功

对应需求 `NFR-3.2`、验收标准 `AC-8.1`。

---

## B-2 ⚠ `mg_unpushed_commits` 注册缺失，非 Windows 平台 CI 失败

**现象**
- Windows：CI 通过，但前端调用该命令报「命令不存在」
- macOS / Linux：`cargo test` 的绑定漂移门禁**直接失败**

**位置**

| 文件 | 行 | 状态 |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | 252–271 `minigit_commands!`（运行时分发） | **缺失** |
| `src-tauri/src/lib.rs` | 406–425 `specta_commands!` 非 Windows 分支 | **缺失** |
| `src-tauri/src/lib.rs` | 567 `specta_commands!` Windows 分支 | 已有 |
| `src/lib/ipc/bindings.ts` | 373 | 已生成 `mgUnpushedCommits` |

**根因**
命令有**三处并列**的注册点，三者无先后依赖，必须同步维护：运行时分发宏链一处，类型导出的两个平台分支各一处。当前只加了 Windows 的类型导出分支。

`src-tauri/tests/specta_bindings.rs` 是逐字节比对**当前平台**导出产物与已提交 `bindings.ts` 的漂移门禁——它管不到运行时宏链，也管不到另一平台分支。在 Windows 上导出含该命令，与已提交文件一致故通过；在非 Windows 上导出不含该命令，与已提交文件不一致故失败。

**修复方向**
1. 在 `minigit_commands!` 与非 Windows 的 `specta_commands!` 两处补上 `minigit::mg_unpushed_commits`
2. 新增一个一致性断言测试：以单一命令名清单为真值源，断言三处集合完全相等，任缺一处即失败，并接入 CI 的 Rust job
3. CI 的 Rust job 需在 Linux 或 macOS 上也执行一次绑定导出验证——绑定仅在调试构建启动时导出，团队若全在单一平台开发，另一平台的分支永不被验证，这正是本缺陷的成因

**验证**
在非 Windows 平台执行 `cargo test --test specta_bindings` 应通过；前端调用该命令不再报命令不存在。

---

## B-3 ⚠ 能力配置缺少外部打开权限，两项功能运行时被拒

**现象**
「在默认程序中打开文件」与「外部链接交由系统浏览器打开」在运行时被 ACL 拒绝。

**位置**
`src-tauri/capabilities/minigit.json`

**根因**
权限清单中没有任何 `opener` 相关条目。另有两项与设计不符：

| 现状 | 问题 |
| --- | --- |
| `clipboard-manager:allow-read-text` | 设计只需写入权限；测试中读取剪贴板走调试构建的测试桥，不通过生产权限 |
| `core:default` | 过宽，与「不复用宿主默认配置」的意图相悖 |

**修复方向**
- 补 `opener` 的打开文件与打开 URL 权限
- 移除 `clipboard-manager:allow-read-text`
- 把 `core:default` 收敛为实际需要的最小集合

**注意**：能力配置**只约束核心命令与插件命令，不约束应用自定义命令**（见 B-7）。收紧它不能替代窗口标签守卫。

对应需求 `FR-4.11`、`FR-10.5`，验收标准 `AC-8.3`。

---

## B-4 ⚠ `session.rs` 中 11 处 `.lock().unwrap()` 会终止宿主进程

**现象**
任一处互斥锁中毒（持锁线程 panic）后，后续 `unwrap()` 触发 panic。宿主 release 配置为 `panic = "abort"`，**整个 Open-Toolbox 进程立即终止**，连带关闭便利贴、贴图、计时器等无关窗口。

**位置**
`src-tauri/src/minigit/session.rs` 第 65、91、94、97、102、152、183、237、254、271、287 行。

**根因**
`src-tauri/Cargo.toml` 的 `[profile.release]` 含 `panic = "abort"`，没有展开机制，任何 panic 都是进程级终止。而 Mini-Git 解析的是用户机器上任意状态的仓库，触发 panic 的概率高于其他模块。

**修复方向**
两条路径，需先做决策：

| 方案 | 内容 | 代价 |
| --- | --- | --- |
| A（推荐，改动小） | 全部 `.lock().unwrap()` 改为在中毒时恢复内部数据或返回错误码，不 panic | 需新增一个「会话状态异常」错误码 |
| B（更彻底） | release 改为展开型 panic，工作线程捕获后转错误码 | 影响宿主全局配置，二进制体积略增 |

无论选哪条，都应在模块顶部加 lint 声明拦截同类问题：

```rust
#![cfg_attr(not(test), deny(
    clippy::unwrap_used, clippy::expect_used, clippy::panic,
    clippy::indexing_slicing, clippy::todo, clippy::unimplemented
))]
```

并接入 `cargo clippy -D warnings`。lint 比文本扫描可靠——能区分注释与测试代码并给出行号。

**注意其边界**：lint 只覆盖本模块源码，覆盖不到 `git2` 绑定层内部的 panic（如选项构造函数中的断言）。那部分只能靠「损坏仓库接口级测试」覆盖。

对应需求 `NFR-5.5`。

---

## B-5 目录列举的两处性能问题（同一处重写可一并解决）

**现象**
大仓库中展开目录明显卡顿。条目数越多、索引越大，劣化越明显。

**位置**
`src-tauri/src/minigit/tree.rs:89-97`（跟踪判定）与 `tree.rs:111`（忽略判定）

**根因**

*其一*：目录的 `is_tracked` 判定用 `idx.iter().any(|e| p.starts_with(&prefix))` 线性扫描整个索引。5000 条目的目录 × 2 万文件的索引 ≈ 1 亿次字符串比较。

*其二*：`repo.status_should_ignore()` 逐条目调用。该接口每次调用都会**重建整条忽略规则栈**（加载路径链上的各级忽略文件），5000 次调用即重建 5000 次。

**修复方向**
两者合并为**单次状态查询**解决：

```rust
let mut opts = StatusOptions::new();
opts.pathspec(format!("{}/", dir_rel))   // 尾部斜杠必须有，否则不按目录前缀剪枝
    .disable_pathspec_match(true)         // 字面量语义，配合上一条生效
    .recurse_untracked_dirs(false)
    .recurse_ignored_dirs(false)
    .include_ignored(true)                // 同一次调用拿到本级忽略集合
    .include_untracked(true)
    .update_index(false)                  // 只读约束
    .no_refresh(true);
let statuses = repo.statuses(Some(&mut opts))?;
```

一次调用同时得到本级的条目状态与忽略集合。

**附带收益**：「已跟踪文件即使命中忽略规则也不隐藏」变成白送的——libgit2 本就不会把已跟踪文件报为忽略项，无需额外的索引查找修正，第一处问题一并消失。

**两处注意**
1. **根目录是例外**：路径限定对根目录等于没有剪枝，一次根目录列举就是全仓扫描。根目录应只返回条目与忽略判定，状态留给工作区状态扫描异步填充。
2. 目录的忽略判定路径**必须带尾部斜杠**，否则只匹配目录的规则会漏判。

*若保留逐条目方案*：目录的跟踪判定至少应改用 `index.find_prefix("dir/")`（索引内二分）替代线性扫描。

**次要问题**：`tree.rs:111` 的 `.unwrap_or(false)` 吞掉了判定错误，失败时静默当作未忽略。

对应需求 `FR-3.7`、`CN-5`，性能指标 `NFR-1.4a` / `NFR-1.4b`。

---

## B-6 常驻窗口模块的三处隐患

**位置**
`src-tauri/src/resident/mod.rs`

| # | 行 | 问题 |
| --- | --- | --- |
| 1 | 5–9、`lib.rs:754` | 非 mini-git 工具生成 `resident-<toolId>` 标签，而全局窗口事件分支只匹配 `"main" \|\| "mini-git"`。第二个常驻工具会落入 `macos_overlay::restore_window_class` 兜底分支，既拿不到「拦截关闭 + 隐藏」，还会被当作浮层处理 |
| 2 | 42–48 | 模块内注册了一份 per-window `CloseRequested` 处理（`prevent_close` + `hide`），与 `lib.rs:754` 的全局处理**重复**。目前两者行为等价故无可见故障，但改动其一时会踩坑 |
| 3 | 33 | `inner_size(1400.0, 900.0)` 写死，未接屏幕适配。`lib.rs` 的 `fit_main_window_to_screen` 硬编码只处理主窗口。13 寸笔记本（逻辑分辨率约 1470×956）上窗口会顶满屏并贴边 |

**修复方向**
1. 全局事件分支改为**按标签前缀匹配**（`"main"` 或以 `resident-` 开头或等于 `"mini-git"`），而非枚举具体标签
2. 移除模块内的重复注册，统一由全局处理器承担
3. 把 `fit_main_window_to_screen` 提取为通用函数 `fit_window_to_screen(window, min_w, min_h)`，常驻窗口构建路径调用它

**顺带**：窗口尺寸与位置目前只有恢复侧的设想，没有保存侧——需补变更监听与持久化写入，否则 `FR-8.8`「尺寸与位置在会话间保持」不成立。

---

## B-7 命令缺少窗口标签守卫

**现象**
宿主任意窗口（主窗口、快速唤起、便利贴、贴图）都能调用 `mg_*` 与 `resident_*` 命令，绕开「仓库资源仅经受限协议暴露」的前提。

**位置**
`src-tauri/src/minigit/mod.rs` 全部命令；`src-tauri/src/resident/commands.rs` 全部命令。

**根因**
Tauri 2 的能力配置**只约束核心命令与插件命令，不约束应用自己注册的 `#[tauri::command]`**。宿主现状即为证据：`capabilities/sticky.json` 未授予任何应用命令权限，便利贴前端照样能调用其自定义命令。

因此收紧 `capabilities/minigit.json`（B-3）**不构成**自定义命令的边界。

**修复方向**
全部命令接收 `webview: tauri::Webview<R>` 参数，函数体首行统一调用守卫：

```rust
fn guard_minigit_window<R: Runtime>(webview: &Webview<R>) -> Result<(), MiniGitError> {
    if webview.label() != "mini-git" {
        return Err(MiniGitError::Other("非法调用来源".into()));
    }
    Ok(())
}
```

该参数不进入 specta 签名，前端无感知。

**建议尽早做**：守卫要给每个命令加参数并改签名与 `spawn_blocking` 闭包结构，二十余个命令写完再统一补是返工。

配套新增静态审计：模块内每个 `#[tauri::command]` 函数体首行必须是该守卫调用。

---

## B-8 提交游标一次性物化全部提交标识

**现象**
`mg_log_open` 在大仓库上阻塞数秒；会话期间常驻较大内存（10 万提交约 2 MB 的 OID 数组）。

**位置**
`src-tauri/src/minigit/session.rs:13` 的 `ActiveWalk.oids: Vec<Oid>`，配合 `current_offset` 做分页。

**评估**
**这不是明确的缺陷，优先级最低。** 理由：libgit2 的 `Sort::TIME` 会置 `limited = 1`，第一次 `next()` 本就要跑完 `limit_list` 解析整个可达历史——增量游标与一次性物化在**时间成本上差别不大**。当前方案还有一个优点：分页是纯数组索引，`walked` 恒定，天然满足「翻页耗时不随页码增长」。

真正的代价只有两项：内存常驻，以及 `mg_log_open` 的阻塞时长。

**若要优化**
保留增量遍历器，游标与仓库句柄同在一个工作线程的栈帧内（句柄先声明、游标表后声明，析构顺序才正确），**不能封进同一个结构体**——游标类型带对句柄的借用，自引用结构在类型系统上不成立。

在实测 `mg_log_open` 于 10 万提交仓库上的实际耗时之前，不建议改动。

---

## 附：已确认无问题的项

审阅中核查过、结论为正确实现的部分，避免重复排查：

| 项 | 结论 |
| --- | --- |
| `git2` 依赖配置 | `default-features = false` + `vendored-libgit2`，完全正确。关闭默认特性去掉了 HTTPS 与 SSH 传输层，依赖审计可通过；显式 vendored 避免链接到系统版本导致行为漂移 |
| `update_index(false)` | `repo.rs:125` 与 `status.rs:11` 两处均显式关闭，符合只读约束 |
| 仓库打开方式 | `repo.rs:54` 用 `open_ext` + `NO_SEARCH`。`repo.rs:37` 的 `Repository::discover` 仅用于诊断「选中的是子目录」以给出准确报错，不用于实际打开，用法正确 |
| 对象数据库新鲜度 | `session.rs:110` 的 `get_repo()` 每次调用都 `Repository::open` 新句柄，**不存在句柄常驻导致的数据陈旧问题**。代价是每次命令多一次 open（毫秒级），换来结果永远最新，取舍合理 |
| 前端分层 | 六个纯函数库（模糊匹配、自然排序、行配对、行内差异、Markdown 净化、引用分组）均不依赖组件，各自带表驱动单测，与设计一致 |
