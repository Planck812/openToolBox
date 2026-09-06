import { jsonViewerTool } from './json-viewer';
import { timestampTool } from './timestamp';
import { textSplitTool } from './text-split';
import { textJoinTool } from './text-join';
import { jsonDiffTool } from './json-diff';
import { textProcessorTool } from './text-processor';
import { qrcodeGenTool } from './qrcode-gen';
import { imageBase64Tool } from './image-base64';
import { imageViewerTool } from './image-viewer';
import { textDiffTool } from './text-diff';
import { textDedupTool } from './text-dedup';
import { portKillerTool } from './port-killer';
import { calculatorTool } from './calculator';
import { mermaidPreviewTool } from './mermaid-preview';
import { uuidGeneratorTool } from './uuid-generator';
import { memoTool } from './memo';
import { jwtTool } from './jwt-tool';
import { pwdBoxTool } from './pwd-box';
import { curlRunnerTool } from './curl-runner';
import { hashTool } from './hash-tool';
import { regexLabTool } from './regex-lab';
import { formatConvertTool } from './format-convert';
import { totp2faTool } from './totp-2fa';
import { envSetterTool } from './env-setter';
import { screenshotUniversalTool } from './screenshot-universal';
import { ocrTool } from './ocr-tool';
import { stickyManagerTool } from './sticky-manager';
import { sedentaryReminderTool } from './sedentary-reminder';
import { timerCenterTool } from './timer-center';
import { aesTool } from './aes-tool';
import { promptManagerTool } from './prompt-manager';
import type { Tool } from './interface';

/**
 * 仅 Windows 可用的工具，在其他平台的构建产物中整体剔除。
 *
 * - `port-killer`：实现完全依赖 Windows 专有命令（`netstat -ano` 的参数形式、
 *   `tasklist` / `taskkill` / `wmic`），且 shell 白名单里写死了
 *   `C:\Windows\System32\*.exe` 路径。在 macOS / Linux 上点开必然报错，
 *   与其让用户看到一个用不了的入口，不如不提供。
 *
 * `__IS_WINDOWS__` 由 vite.config.ts 在编译期替换为字面量，因此非 Windows
 * 产物里这些工具的代码会被 tree-shake 掉，而不只是隐藏入口。
 */
const windowsOnlyTools: Tool[] = __IS_WINDOWS__ ? [portKillerTool] : [];

/**
 * 在 macOS 上停用的工具。
 *
 * - `screenshot-universal` / `sticky-manager`：macOS 端实现存在已知缺陷，
 *   暂不提供，避免用户踩坑。
 *   与之配套的全局截图快捷键、贴图相关托盘项与快捷键在 Rust 侧一并按
 *   `screenshot_supported` 门禁关闭（见 build.rs）—— 只摘工具入口不够：
 *   快捷键独立于工具注册表，仍会触发同一段有问题的代码。
 *   Linux（X11）实现不受影响，故不用 `__IS_WINDOWS__` 取反判断。
 */
const nonMacosTools: Tool[] = __IS_MACOS__ ? [] : [screenshotUniversalTool, stickyManagerTool];

export const tools: Tool[] = [
  jsonViewerTool,
  timestampTool,
  textSplitTool,
  textJoinTool,
  jsonDiffTool,
  textProcessorTool,
  qrcodeGenTool,
  imageViewerTool,
  imageBase64Tool,
  textDiffTool,
  textDedupTool,
  ...windowsOnlyTools,
  calculatorTool,
  mermaidPreviewTool,
  uuidGeneratorTool,
  memoTool,
  jwtTool,
  pwdBoxTool,
  curlRunnerTool,
  hashTool,
  regexLabTool,
  formatConvertTool,
  totp2faTool,
  envSetterTool,
  ...nonMacosTools,
  ocrTool,
  sedentaryReminderTool,
  timerCenterTool,
  aesTool,
  promptManagerTool,
];

export const getToolById = (id: string) => tools.find(t => t.metadata.id === id);
