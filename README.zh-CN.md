<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Open-Toolbox" />

# Open-Toolbox

### 30 个开发者工具，一个快捷键搞定

不用再翻收藏夹找那个在线 JSON 格式化了。`Alt+Space` 唤起，粘贴，完事 —— 全程离线、原生、12 MB。

[![Release](https://img.shields.io/github/v/release/Planck812/openToolBox?style=flat-square&color=6366f1)](https://github.com/Planck812/openToolBox/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Planck812/openToolBox/total?style=flat-square&color=22c55e)](https://github.com/Planck812/openToolBox/releases)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Stars](https://img.shields.io/github/stars/Planck812/openToolBox?style=flat-square&color=eab308)](https://github.com/Planck812/openToolBox/stargazers)

[English](README.md) · **中文** · [日本語](README.ja.md) · [Deutsch](README.de.md) · [更新日志](CHANGELOG.md)

### [⬇️  下载 Windows 版](https://github.com/Planck812/openToolBox/releases/latest)

<!-- 把演示 GIF 放到 docs/images/demo.gif，然后取消下面一行的注释。
<img src="docs/images/demo.gif" alt="Open-Toolbox 演示" width="720" />
-->

</div>

---

## 为什么用 Open-Toolbox？

|  | |
|---|---|
| ⚡ **即开即用** | 任何界面下 `Alt+Space` 唤起，自动读取剪贴板，还没输完就已经推荐好对应工具。 |
| 🔒 **完全离线** | JWT、密码、接口报文都留在本机。无需账号，无遥测，不发一个请求。 |
| 🪶 **原生轻量** | Rust + Tauri 2，不是 Electron。安装包约 12 MB，空闲内存个位数 MB。 |
| 🧩 **30 个工具一个窗口** | 文本、JSON、加解密、截图、OCR、便利贴，不用再开一排标签页。 |
| 🌍 **多语言界面** | 内置简体中文与 English，运行时随时切换。 |

## 工具清单

<table>
<tr><td valign="top" width="25%">

**📝 文本处理**
- 文本拆分
- 文本合并
- 文本去重
- 文本处理器
- 文本对比
- 正则实验室
- 格式转换

</td><td valign="top" width="25%">

**🔧 数据与格式**
- JSON 查看
- JSON Diff
- 时间戳转换
- Base64
- 二维码生成
- 图片查看

</td><td valign="top" width="25%">

**⚙️ 开发工具**
- UUID 生成
- 哈希计算
- JWT 解析
- TOTP 双因素
- Curl 执行器
- AES 加解密
- 环境变量设置
- 端口占用杀手
- Mermaid 预览
- 计算器

</td><td valign="top" width="25%">

**🚀 效率工具**
- 全平台截图（选区 / 控件 / 滚动长图）
- OCR 文字识别
- 便利贴
- 备忘录
- 密码夹
- 计时中心
- 久坐提醒

</td></tr>
</table>

## 全局快捷键

| 动作 | 默认 | 可配置 |
|---|---|---|
| 唤起主窗口 | `Alt+Space` | ✅ 设置页 |
| 全平台截图 | `Ctrl+Shift+S` | ✅ 设置页 |
| 贴出便利贴 | `Ctrl+Shift+T` | ✅ 设置页 |

## 安装

**Windows** —— 从 [Releases](https://github.com/Planck812/openToolBox/releases/latest) 下载安装包。Windows 10 可能需要额外安装 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 11 已内置）。

**macOS / Linux** —— 目前需自行源码构建，预编译包在计划中。

## 从源码构建

需要 **Node.js ≥ 18**（建议 20 LTS）与 **Rust stable**。

```bash
npm install
npm run tauri dev      # 开发模式（Rust 编译 + 前端热更新）
npm run tauri build    # 生产打包
```

其他命令：

```bash
npm run dev            # 仅前端，localhost:1420
npm run build          # vue-tsc 类型检查 + 前端构建
npm test               # Vitest 单元测试
npm run test:desktop   # WebdriverIO 桌面 E2E
cargo test --manifest-path src-tauri/Cargo.toml
```

平台构建依赖：**Windows** WebView2 运行时 · **macOS** Xcode Command Line Tools · **Linux** webkit2gtk-4.1、libappindicator、librsvg（见 [Tauri v2 前置要求](https://tauri.app/start/prerequisites/)）。

> `tauri dev` / `tauri build` 会自动下载 OCR 语言包。网络不通时可先手动执行 `node scripts/fetch-tessdata.mjs`。

## 架构

- **前端** —— Vue 3 `<script setup>` + Pinia + Vue Router + vue-i18n（zh-CN / en-US）。工具通过 `src/tools/registry.ts` 可插拔注册，纯逻辑（引擎/模型）与 UI 分离。
- **后端** —— Tauri 2（Rust），按域拆分模块：`ocr/`（Tesseract）、`sticky/`（便利贴）、`env/`（环境变量注册表）、`element_detect/`（UIA 控件识别）、`screenshot_shared/` / `screenshot_universal/`（截图、贴图、滚动长截图）。
- **辅助窗口** —— 截图覆盖层、贴图、便利贴各自是独立 WebView 窗口，配最小权限 capability。
- **安全** —— 前端仅经 `@tauri-apps/*` 插件调用原生能力；命令执行收敛为参数数组直调，不经 shell。

## 添加新工具

工具以 `src/tools/<kebab-case>/` 为功能模块，含 `index.ts`（注册元数据与匹配逻辑）、纯逻辑引擎文件、`*.vue` 组件。

1. 建目录 `src/tools/my-tool/`，写 `index.ts` 导出 `Tool` 对象：

   ```ts
   export const myTool: Tool = {
     metadata: {
       id: 'my-tool',
       name: 'tools.my_tool.name',        // i18n 键，勿放中文原文
       description: 'tools.my_tool.description',
       icon: /* lucide-vue-next 图标 */,
       keywords: ['my', 'tool'],          // 搜索关键词，中英文均可
     },
     component: () => import('./MyTool.vue'),
     match: (input) => { /* 返回 ToolMatchResult 或 null */ },
   };
   ```

2. 在 `src/tools/registry.ts` 导入并加入 `tools` 数组。
3. 在 `src/locales/zh-CN.json` 与 `en-US.json` **同时**补 `tools.my_tool.name` / `description` 键（两文件键结构必须一致）。
4. 为引擎/模型纯逻辑补 Vitest 单测。

参考 `src/tools/calculator/`、`src/tools/text-split/` 的最小实现。涉及原生能力（截图、全局快捷键、文件、命令）时，命令调用走 `src/lib/ipc/` 的类型化封装。

## OCR 语言包（tessdata）

OCR 工具依赖 Tesseract 语言包（`chi_sim` / `chi_sim_vert` / `eng`，约 47 MB，Apache-2.0 许可）。语言包**不随仓库提交**，由 `scripts/fetch-tessdata.mjs` 幂等下载到 `src-tauri/tessdata/` 与 `src-tauri/tessdata_fast/`（均已 gitignore）。来源：[tessdata](https://github.com/tesseract-ocr/tessdata) / [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)。

## 测试策略

- **前端单测** —— Vitest，覆盖工具引擎（计算器 / JWT / 哈希 / TOTP / 正则等）与关键组件（HomeView / 设置页 / 快捷键）。
- **Rust 单测** —— `cargo test`，覆盖历史清单事务、贴图、滚动拼接、OCR 预处理等纯逻辑。
- **桌面 E2E** —— WebdriverIO 驱动 release 桌面产物，覆盖 `app-launch`、`jwt`、`memo`、`text-diff` 等主链路。

## 参与贡献

欢迎提 Issue 和 PR，请先看 [CONTRIBUTING.md](CONTRIBUTING.md) 与[行为准则](CODE_OF_CONDUCT.md)。安全问题请走 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © Open-Toolbox contributors

<div align="center">

**如果 Open-Toolbox 每天帮你少点几次鼠标，点个 ⭐ 就是最好的支持。**

</div>
