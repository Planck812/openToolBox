import { logToFile } from '@/lib/logger';

/** 相同错误在窗口期内只上报一次，避免 errorHandler 与 unhandledrejection 对同一错误重复记录/打扰。 */
const RECENT_ERROR_WINDOW_MS = 2000;
const recentErrorAt = new Map<string, number>();

const errorSignature = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  // 用消息 + 前几行栈帧做指纹，尽量还原原始错误栈又控制指纹大小
  return `${message}\n${stack.split('\n').slice(0, 4).join('\n')}`;
};

export interface GlobalErrorHandlerOptions {
  /** 出错时额外回调（如主窗口弹 toast）。仅记录日志之外的副作用由调用方决定。 */
  onError?: (message: string) => void;
}

/**
 * 注册全局错误边界：Vue `app.config.errorHandler` + `unhandledrejection`。
 * 返回两个处理函数，分别赋给 app.config.errorHandler 与 window 的 'unhandledrejection'。
 * 主窗口与辅助窗口（贴图/便利贴/计时/久坐等精简入口）复用同一实现：只记录日志，
 * 是否弹 toast 由 `onError` 决定。
 */
export const installGlobalErrorHandler = (options: GlobalErrorHandlerOptions = {}) => {
  const reportGlobalError = (source: string, err: unknown, info?: string) => {
    const key = errorSignature(err);
    const now = Date.now();
    const last = recentErrorAt.get(key);
    if (last !== undefined && now - last < RECENT_ERROR_WINDOW_MS) return;
    // 防止指纹表无限增长（只保留最近 200 个）
    if (recentErrorAt.size >= 200) {
      const oldest = recentErrorAt.keys().next().value;
      if (oldest !== undefined) recentErrorAt.delete(oldest);
    }
    recentErrorAt.set(key, now);

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    // 只记录、不 catch 后再 throw（避免触发 errorHandler 自身形成循环）；logToFile 失败也要静默。
    void logToFile('error', `[global] ${source}${info ? ` (${info})` : ''}`, { message, stack }).catch(() => {});

    options.onError?.(message);
  };

  const handleError = (err: unknown, _instance: unknown, info: string) => {
    reportGlobalError('unhandled error', err, info);
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    reportGlobalError('unhandledrejection', event.reason);
  };

  return { handleError, handleUnhandledRejection };
};
