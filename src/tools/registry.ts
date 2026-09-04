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
  portKillerTool,
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
  screenshotUniversalTool,
  ocrTool,
  stickyManagerTool,
  sedentaryReminderTool,
  timerCenterTool,
  aesTool,
  promptManagerTool,
];

export const getToolById = (id: string) => tools.find(t => t.metadata.id === id);
