import { curlStorageLoad, curlStorageSave } from '@/lib/ipc/pwdbox';
import type { CurlSavedItem } from './curl-model';

const KEY = 'items';

/**
 * 读取 Curl 请求历史。
 *
 * 数据由 Rust 侧 AES-256-GCM 加密落盘（与 pwd-box 共用加密实现，独立主密钥），
 * 旧 plugin-store 明文文件会在首次读取时被 Rust 侧自动迁移为密文。
 * 返回值为 `{"items":[...]}` 的 JSON 字符串，由调用方解析。
 */
export const loadCurlItems = async (): Promise<CurlSavedItem[]> => {
  const raw = await curlStorageLoad();
  if (raw === null) return [];
  const parsed = JSON.parse(raw) as { items?: unknown };
  return Array.isArray(parsed?.items) ? (parsed.items as CurlSavedItem[]) : [];
};

/**
 * 加密并落盘 Curl 请求历史。
 */
export const saveCurlItems = async (items: CurlSavedItem[]): Promise<void> => {
  await curlStorageSave(JSON.stringify({ [KEY]: items }));
};
