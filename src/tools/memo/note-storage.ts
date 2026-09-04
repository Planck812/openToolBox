import { load } from '@tauri-apps/plugin-store';
import type { MemoNote } from './note-model';

const STORE_FILE = 'memo-notes.json';
const NOTES_KEY = 'notes';

/**
 * 从本地 store 读取备忘录列表。
 */
export const loadNotes = async (): Promise<MemoNote[]> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  const saved = await store.get<MemoNote[]>(NOTES_KEY);
  return Array.isArray(saved) ? saved : [];
};

/**
 * 将备忘录列表写回本地 store。
 * @param notes 当前备忘录列表
 */
export const saveNotes = async (notes: MemoNote[]): Promise<void> => {
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
  await store.set(NOTES_KEY, notes);
  await store.save();
};

