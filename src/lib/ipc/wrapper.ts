import { logContext } from '@/lib/logger';

/**
 * IPC 命令包装函数 - 自动记录调用耗时和超时情况
 * @param commandName 命令名称
 * @param invoke 实际的异步命令执行函数
 * @param timeoutMs 超时时间（毫秒），超过此时间记为 WARN，默认 30000ms
 * @returns 命令执行结果
 */
export const wrapIpcCommand = async <T>(
  commandName: string,
  invoke: () => Promise<T>,
  timeoutMs: number = 30000,
): Promise<T> => {
  const startTime = performance.now();
  const timeoutId = setTimeout(() => {
    const elapsed = (performance.now() - startTime).toFixed(0);
    logContext('warn', 'IPC', 'timeout', `Command ${commandName} pending for ${elapsed}ms (timeout: ${timeoutMs}ms)`);
  }, timeoutMs);

  try {
    const result = await invoke();
    clearTimeout(timeoutId);
    const duration = performance.now() - startTime;

    // 记录耗时信息
    if (duration > 1000) {
      logContext('warn', 'IPC', commandName, `Slow command: ${duration.toFixed(0)}ms`);
    } else if (duration > 100) {
      logContext('debug', 'IPC', commandName, `Executed: ${duration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = performance.now() - startTime;
    logContext('error', 'IPC', commandName, `Failed after ${duration.toFixed(0)}ms`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * 批量包装 IPC 调用 - 用于一个对象中的多个 IPC 函数
 * @param commands IPC 命令对象，键为命令名，值为异步函数
 * @returns 包装后的命令对象
 */
export const wrapIpcCommands = <T extends Record<string, (...args: any[]) => Promise<any>>>(
  commands: T,
): T => {
  const wrapped = {} as T;

  for (const [key, fn] of Object.entries(commands)) {
    wrapped[key as keyof T] = ((...args: any[]) => {
      return wrapIpcCommand(key, () => fn(...args));
    }) as any;
  }

  return wrapped;
};
