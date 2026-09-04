import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadStoreMock, storeGetMock, storeSetMock, storeSaveMock } = vi.hoisted(() => ({
  loadStoreMock: vi.fn(),
  storeGetMock: vi.fn(),
  storeSetMock: vi.fn(),
  storeSaveMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: loadStoreMock,
}));

import { loadNotes, saveNotes } from '../note-storage';

const SAMPLE_NOTES = [
  {
    id: 'note-1',
    title: '周会',
    content: '确认上线窗口',
    pinned: false,
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
  },
];

describe('memo note storage adapter', () => {
  beforeEach(() => {
    loadStoreMock.mockReset();
    storeGetMock.mockReset();
    storeSetMock.mockReset();
    storeSaveMock.mockReset();
    loadStoreMock.mockReturnValue({
      get: storeGetMock,
      set: storeSetMock,
      save: storeSaveMock,
    });
  });

  it('loadNotes 从 memo-notes.json 读取便签数组', async () => {
    storeGetMock.mockResolvedValue(SAMPLE_NOTES);

    await expect(loadNotes()).resolves.toEqual(SAMPLE_NOTES);
    expect(loadStoreMock).toHaveBeenCalledWith(
      'memo-notes.json',
      expect.objectContaining({ autoSave: false }),
    );
    expect(storeGetMock).toHaveBeenCalledWith('notes');
  });

  it('loadNotes 在 store 无数据时返回空数组', async () => {
    storeGetMock.mockResolvedValue(undefined);
    await expect(loadNotes()).resolves.toEqual([]);

    storeGetMock.mockResolvedValue('not-an-array');
    await expect(loadNotes()).resolves.toEqual([]);
  });

  it('saveNotes 写入便签数组并触发持久化', async () => {
    await saveNotes(SAMPLE_NOTES);

    expect(storeSetMock).toHaveBeenCalledWith('notes', SAMPLE_NOTES);
    expect(storeSaveMock).toHaveBeenCalledTimes(1);
  });
});
