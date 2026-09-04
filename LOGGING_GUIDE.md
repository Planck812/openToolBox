# Open-Toolbox 日志系统使用指南

## 📋 概述

本项目已集成全面的日志系统，用于帮助用户和开发者快速定位卡死、性能问题等故障。

**日志会输出到：**
- **开发模式**：浏览器控制台（F12 打开）
- **生产模式**：Tauri 日志文件目录
  - **Windows**: `%APPDATA%/open-toolbox/logs/open-toolbox.log`
  - **macOS**: `~/Library/Logs/open-toolbox/open-toolbox.log`
  - **Linux**: `~/.config/open-toolbox/logs/open-toolbox.log`

---

## 🎯 快速定位卡死原因

### 1. 导出日志

当用户遇到卡死，按以下步骤导出日志：
- Windows: 打开 `%APPDATA%/open-toolbox/logs/`
- macOS/Linux: 在文件管理器中进入上述日志目录
- 将 `open-toolbox.log` 文件复制给开发者

### 2. 关键字搜索

在日志文件中按以下顺序搜索：

```
优先级 1: 搜索 "ERROR"
  ❌ 任何错误都可能导致卡死或异常

优先级 2: 搜索 "[PERF]" 或 "WARN"
  ⚠️  性能警告，可能是卡死的根本原因

优先级 3: 搜索时间戳
  🕐 从卡死前 30 秒开始看，查看完整操作链路
```

### 3. 性能指标阈值参考

| 操作 | 正常 | 警告 | 严重 | 记录内容 |
|------|------|------|------|---------|
| 工具加载 | < 100ms | 100-500ms | > 500ms | 工具 ID、加载时间 |
| 搜索过滤 | < 50ms | 50-200ms | > 200ms | 搜索词、匹配数、耗时 |
| OCR 识别 | < 2s | 2-5s | > 5s | 图像大小、模式、置信度 |
| IPC 调用 | < 100ms | 100-500ms | > 500ms | 命令名、耗时 |
| 截图操作 | < 500ms | 500ms-2s | > 2s | 操作类型、记录数、耗时 |
| 帧率卡顿 | 60fps | 30-60fps | < 30fps | 每帧耗时 |

---

## 📊 日志格式说明

### 标准日志格式

```
[ISO-8601时间戳] [LEVEL] [module] operation: message {optional-context}

示例：
2026-08-17T10:23:45.123Z [INFO] [OCR] recognize: OCR recognition started: mode=best imageSize=45628
2026-08-17T10:23:46.500Z [WARN] [PERF] Tool matching slow: query="ocr" matched=1 tools duration=120.34ms
2026-08-17T10:24:00.000Z [ERROR] [IPC] timeout: Command ocr_recognize_png pending for 30000ms
```

### 日志级别

- **[INFO]** - 关键操作开始/完成（正常流程）
- **[WARN]** - 性能警告、超时等问题
- **[ERROR]** - 错误或异常
- **[DEBUG]** - 调试信息（开发模式启用）
- **[PERF]** - 性能指标标签

---

## 🔍 常见卡死场景定位

### 场景 1: 选择工具时卡死

**搜索日志**：`Tool switching` 或 `Loading tool`

**检查内容**：
```
[INFO] store: setActiveTool: from=home to=ocr-tool duration=2.34ms
[INFO] ToolView: resolveToolComponent: Loading tool: ocr-tool
[DEBUG] ToolView: resolveToolComponent: Component loading started: ocr-tool
```

**可能原因**：
- ❌ 工具组件加载失败 → 搜索 `Component load failed`
- ❌ 工具搜索过慢 → 搜索 `[PERF]` + `Tool matching slow`
- ❌ 状态更新阻塞 → 搜索 `Frame drop detected`

---

### 场景 2: OCR 识别时卡死

**搜索日志**：`OCR` 或 `recognition`

**检查内容**：
```
[INFO] OCR: recognize: OCR recognition started: mode=best
[DEBUG] OCR: recognize: Image converted to DataURL duration=12.34ms
[INFO] OCR: recognize: OCR recognition completed: text_length=256 confidence=95.3% backend_duration=1250 total_duration=1270ms
```

**可能原因**：
- ⚠️ OCR 耗时 > 5s → 搜索 `Slow OCR recognition`
- ⚠️ 后端无响应 → 搜索 `timeout: ocr_recognize_png pending for`
- ⚠️ 引擎初始化卡顿 → 搜索 `[ocr] engine acquired` + 耗时

---

### 场景 3: 历史记录加载时卡死

**搜索日志**：`Screenshot` + `loadList` 或 `loadThumbnails`

**检查内容**：
```
[DEBUG] Screenshot: loadList: Loading history records
[INFO] Screenshot: loadList: History loaded: 128 records duration=234.56ms
[DEBUG] Screenshot: loadThumbnails: Loading 128 thumbnails
[DEBUG] Screenshot: loadThumbnails: Thumbnails loaded: 128 items duration=3456ms
```

**可能原因**：
- ⚠️ 记录列表加载 > 1s → 搜索 `History load failed`
- ⚠️ 缩略图加载过慢 → 搜索 `Slow thumbnail load`
- ⚠️ 单条缩略图卡顿 → 搜索 `thumbnail load skipped`

---

### 场景 4: 搜索/过滤卡死

**搜索日志**：`Tool matching` 或 `Tool filtering`

**检查内容**：
```
[DEBUG] [PERF] Tool matching: query="json" matched=3 tools duration=45.23ms
[WARN] [PERF] Tool filtering slow: query="test" filtered=12 tools duration=120.45ms
```

**可能原因**：
- ⚠️ 搜索耗时 > 200ms → 工具库过大或搜索算法低效
- ⚠️ 搜索输入频繁变化 → 多次触发搜索，检查输入防抖

---

## 🛠️ 开发者调试

### 启用性能日志

在开发模式下自动启用详细性能日志。生产环境可通过环境变量启用：

```bash
# 启用详细性能日志
VITE_ENABLE_PERF_LOG=true npm run tauri dev
```

### 控制台调试

在浏览器开发者工具中：

```javascript
// 查看所有 PERF 日志
console.table(
  document.body.innerText.split('\n').filter(l => l.includes('[PERF]'))
)

// 导出日志到文件
const logs = Array.from(document.body.innerText.split('\n'));
copy(JSON.stringify(logs, null, 2));
```

### 后端日志

Rust 后端使用标准 `log` crate，日志格式：

```
[ocr] recognition started: mode=best imageSize=45628
[ocr] recognition completed: mode=best text_length=256 confidence=95.1% ocr_duration=1250ms
[WARN] [ocr] slow recognition: mode=best total=3500ms
```

---

## 📝 IPC 命令超时监控

所有 Tauri IPC 命令已包装，自动记录：
- 命令名称
- 执行耗时
- 超时警告（30s）

```javascript
// IPC 包装器示例日志
[DEBUG] [IPC] ocr_recognize_png: Executed: 1250.23ms
[WARN] [IPC] timeout: Command ocr_recognize_png pending for 30000ms (timeout: 30000ms)
[ERROR] [IPC] ocr_recognize_png: Failed after 1500.45ms
```

---

## 🚀 性能优化建议

基于日志分析，常见优化方向：

| 问题 | 日志特征 | 优化方向 |
|------|--------|--------|
| 工具加载慢 | `Component loading started` 耗时 > 1s | 代码分割、懒加载 |
| 搜索慢 | `Tool matching slow` > 200ms | 搜索算法优化、缓存 |
| OCR 卡顿 | `slow recognition` > 3s | 图像预处理、模式选择 |
| 截图卡顿 | `Slow thumbnail load` > 500ms | 异步加载、缩略图缓存 |
| 帧率卡顿 | `Frame drop detected` > 50ms | 防止大量重渲染、虚拟滚动 |

---

## 📞 反馈给开发者

完整的故障报告应包含：

1. **卡死时的操作**：「点击 OCR 工具后卡死」
2. **卡死时长**：「10 秒后应用响应」
3. **日志片段**：
   ```
   [关键错误日志片段，5-10 行]
   [操作前后各 30 秒的日志]
   ```
4. **系统信息**：Windows 10/11、内存、磁盘空间

---

## 📦 日志配置

### 日志级别

生产环境默认：`INFO` 级别（仅记录重要信息）
开发环境默认：`DEBUG` 级别（记录详细信息）

### 日志大小

- 单个日志文件：最多 5MB
- 超出后自动轮转（保留最新的 3 个文件）
- 旧日志自动删除

### 日志内容

- ✅ 性能指标、操作流程
- ✅ 错误和异常
- ❌ 用户敏感数据（密码、密钥）
- ❌ 第三方 API 密钥

---

## 🎓 更多信息

- [日志系统源码](src/lib/logger.ts)
- [IPC 包装器](src/lib/ipc/wrapper.ts)
- [应用架构文档](CLAUDE.md)
