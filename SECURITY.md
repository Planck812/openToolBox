# 安全策略（Security Policy）

## 报告安全漏洞（Reporting a Vulnerability）

如果发现安全相关漏洞（如命令注入、任意文件读写、信息泄露等），**请勿**直接在公开 Issue 中披露，优先走私有渠道：

- **推荐**：使用 GitHub 的 **Security Advisory** 功能（仓库 → Security → Report a vulnerability）提交，说明漏洞类型、影响范围与复现步骤。
- 备选：通过邮件或 Issue（标记 `security`）联系维护者。

我们会在收到报告后尽快确认并修复，修复后统一发布公告。修复完成前请对漏洞细节保密。

## 适用范围

本项目为本地桌面应用，漏洞关注点包括但不限于：

- 前端 WebView 到原生能力的 IPC 越权
- 命令执行（`@tauri-apps/plugin-shell`）的参数注入
- `asset` 协议 / capability 配置越权
- 读取用户文件、剪贴板等敏感数据的非预期暴露

## 安全承诺

- 前端仅通过 `@tauri-apps/*` 插件调用原生能力
- 命令执行收敛为参数数组直调（不经 cmd shell）
- 各辅助窗口使用最小权限 capability
