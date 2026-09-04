import { load } from '@tauri-apps/plugin-store';
import type { PromptItem } from './prompt-model';

const STORE_FILE = 'prompt-library.json';
const PROMPTS_KEY = 'prompts';
const DELETED_PRESET_IDS_KEY = 'deletedPresetIds';

/**
 * 从本地 store 读取用户自建的提示词列表。
 */
export const loadUserPrompts = async (): Promise<PromptItem[]> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  const saved = await store.get<PromptItem[]>(PROMPTS_KEY);
  return Array.isArray(saved) ? saved : [];
};

/**
 * 将用户自建的提示词列表写回本地 store。
 */
export const saveUserPrompts = async (prompts: PromptItem[]): Promise<void> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  await store.set(PROMPTS_KEY, prompts);
  await store.save();
};

/**
 * 读取被用户删除的内置提示词 ID 列表。
 * 内置提示词保存在源码里，删除只是记录"不再展示"。
 */
export const loadDeletedPresetIds = async (): Promise<string[]> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  const saved = await store.get<string[]>(DELETED_PRESET_IDS_KEY);
  return Array.isArray(saved) ? saved : [];
};

export const saveDeletedPresetIds = async (ids: string[]): Promise<void> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  await store.set(DELETED_PRESET_IDS_KEY, ids);
  await store.save();
};
