import { describe, expect, it } from 'vitest';
import {
  buildMonthOptions,
  clampPage,
  createNote,
  deleteNoteById,
  filterNotesByMonth,
  getNoteDisplayTitle,
  getNoteMonthKey,
  paginateNotes,
  searchNotes,
  sortNotes,
  toggleNotePinned,
  updateNote,
} from '../memo/note-model';
import { getToolById } from '../registry';

describe('memo note model', () => {
  it('createNote 创建默认字段完整的新便签', () => {
    const now = '2026-03-31T10:00:00.000Z';
    const note = createNote(now, 'note-1');

    expect(note).toEqual({
      id: 'note-1',
      title: '',
      content: '',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('updateNote 更新标题正文并刷新更新时间', () => {
    const note = createNote('2026-03-31T10:00:00.000Z', 'note-1');

    const updated = updateNote(note, {
      title: '会议纪要',
      content: '第一行',
    }, '2026-03-31T11:00:00.000Z');

    expect(updated.title).toBe('会议纪要');
    expect(updated.content).toBe('第一行');
    expect(updated.updatedAt).toBe('2026-03-31T11:00:00.000Z');
  });

  it('toggleNotePinned 切换置顶并刷新更新时间', () => {
    const note = createNote('2026-03-31T10:00:00.000Z', 'note-1');

    const updated = toggleNotePinned(note, '2026-03-31T12:00:00.000Z');

    expect(updated.pinned).toBe(true);
    expect(updated.updatedAt).toBe('2026-03-31T12:00:00.000Z');
  });

  it('sortNotes 按置顶优先和更新时间倒序排序', () => {
    const notes = [
      {
        id: 'a',
        title: '',
        content: '',
        pinned: false,
        createdAt: '2026-03-31T09:00:00.000Z',
        updatedAt: '2026-03-31T09:00:00.000Z',
      },
      {
        id: 'b',
        title: '',
        content: '',
        pinned: true,
        createdAt: '2026-03-31T08:00:00.000Z',
        updatedAt: '2026-03-31T08:00:00.000Z',
      },
      {
        id: 'c',
        title: '',
        content: '',
        pinned: false,
        createdAt: '2026-03-31T10:00:00.000Z',
        updatedAt: '2026-03-31T10:00:00.000Z',
      },
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual(['b', 'c', 'a']);
  });

  it('searchNotes 根据标题与正文筛选', () => {
    const notes = [
      {
        id: 'a',
        title: '采购清单',
        content: '苹果 香蕉',
        pinned: false,
        createdAt: '2026-03-31T09:00:00.000Z',
        updatedAt: '2026-03-31T09:00:00.000Z',
      },
      {
        id: 'b',
        title: '会议',
        content: '确定发版时间',
        pinned: false,
        createdAt: '2026-03-31T10:00:00.000Z',
        updatedAt: '2026-03-31T10:00:00.000Z',
      },
    ];

    expect(searchNotes(notes, '香蕉').map((note) => note.id)).toEqual(['a']);
    expect(searchNotes(notes, '会议').map((note) => note.id)).toEqual(['b']);
  });

  it('deleteNoteById 删除目标便签', () => {
    const notes = [createNote('2026-03-31T10:00:00.000Z', 'a'), createNote('2026-03-31T10:00:00.000Z', 'b')];
    expect(deleteNoteById(notes, 'a').map((note) => note.id)).toEqual(['b']);
  });

  it('getNoteDisplayTitle 对空标题返回占位文本', () => {
    expect(getNoteDisplayTitle({ title: '' }, '无标题便签')).toBe('无标题便签');
    expect(getNoteDisplayTitle({ title: '临时记录' }, '无标题便签')).toBe('临时记录');
  });

  it('getNoteMonthKey 返回 YYYY-MM 格式月份键', () => {
    expect(getNoteMonthKey('2026-03-31T10:00:00.000Z')).toBe('2026-03');
  });

  it('buildMonthOptions 返回全部 + 按更新时间倒序的月份列表与数量', () => {
    const notes = [
      { id: 'a', title: '', content: '', pinned: false, createdAt: '', updatedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'b', title: '', content: '', pinned: false, createdAt: '', updatedAt: '2026-03-02T00:00:00.000Z' },
      { id: 'c', title: '', content: '', pinned: false, createdAt: '', updatedAt: '2026-03-03T00:00:00.000Z' },
    ];

    expect(buildMonthOptions(notes)).toEqual([
      { key: 'all', count: 3 },
      { key: '2026-03', count: 2 },
      { key: '2026-02', count: 1 },
    ]);
  });

  it('filterNotesByMonth 支持 all 与指定月份过滤', () => {
    const notes = [
      { id: 'a', title: '', content: '', pinned: false, createdAt: '', updatedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'b', title: '', content: '', pinned: false, createdAt: '', updatedAt: '2026-03-02T00:00:00.000Z' },
    ];

    expect(filterNotesByMonth(notes, 'all').map((note) => note.id)).toEqual(['a', 'b']);
    expect(filterNotesByMonth(notes, '2026-03').map((note) => note.id)).toEqual(['b']);
  });

  it('paginateNotes 按页码与每页数量切片', () => {
    const notes = Array.from({ length: 5 }, (_, index) => ({
      id: `${index + 1}`,
      title: '',
      content: '',
      pinned: false,
      createdAt: '',
      updatedAt: `2026-03-0${index + 1}T00:00:00.000Z`,
    }));

    expect(paginateNotes(notes, 2, 2).map((note) => note.id)).toEqual(['3', '4']);
  });

  it('clampPage 在页码越界时回退到合法范围', () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(4, 3)).toBe(3);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(5, 0)).toBe(1);
  });
});

describe('memo tool registry', () => {
  it('registers memo tool metadata', () => {
    const tool = getToolById('memo');

    expect(tool?.metadata.name).toBe('tools.memo.name');
    expect(tool?.metadata.description).toBe('tools.memo.description');
  });
});
