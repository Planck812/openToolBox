import {
  debug as tauriLogDebug,
  error as tauriLogError,
  info as tauriLogInfo,
  warn as tauriLogWarn,
} from '@tauri-apps/plugin-log';

export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

const IS_DEV = import.meta.env.MODE === 'development';
const ENABLE_PERF_LOG = import.meta.env.VITE_ENABLE_PERF_LOG === 'true' || IS_DEV;

/**
 * 日志辅助函数 - 输出到控制台。
 * 历史问题：此前会额外写 Tauri 日志与用户文档目录 testLog.txt，污染生产环境，已移除。
 */
export const logToFile = async (level: LogLevel, message: string, data?: unknown): Promise<void> => {
  let fullMessage = message;
  if (data) {
    try {
      fullMessage = `${message} ${JSON.stringify(data)}`;
    } catch {
      // 循环引用等无法序列化的数据兜底，避免日志函数本身抛错。
      fullMessage = `${message} [unserializable data]`;
    }
  }
  switch (level) {
    case 'error':
      console.error(fullMessage);
      break;
    case 'warn':
      console.warn(fullMessage);
      break;
    case 'debug':
      console.debug(fullMessage);
      break;
    default:
      console.log(fullMessage);
  }
  // 生产日志落盘：转发到后端 tauri-plugin-log（写入 app_log_dir），release 下可见。
  try {
    const fn =
      level === 'error' ? tauriLogError : level === 'warn' ? tauriLogWarn : level === 'debug' ? tauriLogDebug : tauriLogInfo;
    await fn(fullMessage);
  } catch {
    // 无 log 权限或非 Tauri 环境时静默忽略，不影响业务
  }
};

/**
 * 性能计时日志 - 记录操作耗时，自动判断是否超过阈值
 * @param operation 操作名称
 * @param startTime 开始时间（performance.now()）
 * @param thresholdMs 警告阈值，超过此值记为 WARN
 * @param context 额外上下文信息
 */
export const logPerformance = async (
  operation: string,
  startTime: number,
  thresholdMs: number = 100,
  context?: Record<string, unknown>
): Promise<number> => {
  const duration = performance.now() - startTime;
  const level: LogLevel = duration > thresholdMs ? 'warn' : 'debug';
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  await logToFile(level, `[PERF] ${operation}: ${duration.toFixed(2)}ms${contextStr}`);
  return duration;
};

/**
 * 上下文日志 - 包含模块名和操作名的结构化日志
 * @param level 日志级别
 * @param module 模块名（如 'ocr', 'screenshot', 'store'）
 * @param operation 操作名
 * @param message 日志消息
 * @param data 额外数据
 */
export const logContext = async (
  level: LogLevel,
  module: string,
  operation: string,
  message: string,
  data?: unknown
): Promise<void> => {
  const timestamp = new Date().toISOString();
  const fullMessage = `[${timestamp}] [${module}] ${operation}: ${message}`;
  await logToFile(level, fullMessage, data);
};

/**
 * 条件日志 - 仅在启用性能日志时输出（开发或设置 VITE_ENABLE_PERF_LOG=true）
 */
export const logIfEnabled = async (level: LogLevel, message: string, data?: unknown): Promise<void> => {
  if (ENABLE_PERF_LOG) {
    await logToFile(level, message, data);
  }
};
