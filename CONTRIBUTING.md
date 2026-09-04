# 贡献指南

感谢你愿意为 Open-Toolbox 贡献！请先阅读本指南，让协作更顺畅。

## 环境准备

按 [README](README.md#环境要求) 安装依赖：Node.js ≥ 18、Rust stable，以及各平台构建依赖。

```bash
npm install
```

> 首次 `npm run tauri dev` 会自动下载 OCR 语言包（见 [OCR 语言包](README.md#ocr-语言包tessdata)）。网络不可用时可手动执行 `node scripts/fetch-tessdata.mjs`。

## 开发与验证

```bash
npm run dev            # 前端热更新
npm run tauri dev      # 完整桌面开发模式
npm run build          # vue-tsc 类型检查 + 前端构建
npm test               # Vitest 单元测试
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust 单测
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
```

提交前请确保以上全部通过。

## 如何提交改动

1. **Fork** 本仓库并基于 `main` 创建功能分支。
2. 写代码时遵循仓库既有风格：
   - 前端：Vue 3 `<script setup>` + TypeScript 严格模式；
   - Rust：edition 2021，遵循 `clippy -D warnings`。
3. 新增工具请参考 [CLAUDE.md](CLAUDE.md) 中「Adding a New Tool」的注册流程。
4. 为改动补充/更新单元测试。
5. 提交信息遵循语义化提交（如 `feat(ocr): ...`、`fix(sticky): ...`）。
6. 发起 Pull Request，描述改动动机与验证结果。CI 会自动跑前端构建/测试/lint 与 Rust check/test/clippy。

## Issue 规范

- Bug 请使用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.md)，尽量附带复现步骤、系统版本、日志。
- 功能建议请使用 [Feature 模板](.github/ISSUE_TEMPLATE/feature_request.md)。

## 行为准则

请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，参与即表示同意其中约定。
