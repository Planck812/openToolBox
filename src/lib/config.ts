/**
 * 应用配置统一读写层（localStorage）。
 * 全部配置 key 见 config-keys.ts；读写统一走本文件的 safe 函数，
 * 内部 try/catch：非法 JSON、存储异常一律回退默认值，不向调用方抛错。
 */
export const CONFIG_SCHEMA_VERSION = 1;

export function safeGetString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeSetString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function safeGetJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeSetJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * 配置 schema 迁移钩子：随 CONFIG_SCHEMA_VERSION 升级在此执行迁移。
 * 当前无实际迁移，恒返回 true。
 */
export function migrateConfig(): boolean {
  return true;
}
