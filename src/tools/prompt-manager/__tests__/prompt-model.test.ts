import { describe, expect, it } from 'vitest';

import {
  collectTags,
  createPrompt,
  filterPromptsByTag,
  parseTagsInput,
  removePromptById,
  searchPrompts,
  sortPrompts,
  togglePromptPinned,
  updatePrompt,
  type PromptItem,
} from '../prompt-model';
import { presetPrompts } from '../preset-prompts';

const buildPrompt = (overrides: Partial<PromptItem> = {}): PromptItem => ({
  id: 'prompt-1',
  title: '标题',
  content: '内容',
  tags: [],
  sourceUrl: '',
  pinned: false,
  preset: false,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  ...overrides,
});

describe('prompt model', () => {
  it('createPrompt 生成带时间戳的用户提示词', () => {
    const prompt = createPrompt(
      { title: '写作', content: '帮我润色', tags: ['写作'], sourceUrl: 'https://example.com' },
      '2026-08-21T01:00:00.000Z',
      'id-1',
    );

    expect(prompt).toMatchObject({
      id: 'id-1',
      title: '写作',
      content: '帮我润色',
      tags: ['写作'],
      sourceUrl: 'https://example.com',
      pinned: false,
      preset: false,
      createdAt: '2026-08-21T01:00:00.000Z',
      updatedAt: '2026-08-21T01:00:00.000Z',
    });
  });

  it('updatePrompt 更新字段并刷新 updatedAt', () => {
    const prompt = buildPrompt();
    const next = updatePrompt(prompt, { title: '新标题' }, '2026-08-21T02:00:00.000Z');

    expect(next.title).toBe('新标题');
    expect(next.updatedAt).toBe('2026-08-21T02:00:00.000Z');
    expect(prompt.title).toBe('标题');
  });

  it('togglePromptPinned 切换置顶', () => {
    const prompt = buildPrompt();
    expect(togglePromptPinned(prompt, '2026-08-21T03:00:00.000Z').pinned).toBe(true);
    expect(togglePromptPinned({ ...prompt, pinned: true }, '2026-08-21T03:00:00.000Z').pinned).toBe(false);
  });

  it('removePromptById 只移除目标项', () => {
    const prompts = [buildPrompt({ id: 'a' }), buildPrompt({ id: 'b' })];
    expect(removePromptById(prompts, 'a').map((item) => item.id)).toEqual(['b']);
  });

  it('sortPrompts 置顶优先，其余按更新时间倒序', () => {
    const sorted = sortPrompts([
      buildPrompt({ id: 'old', updatedAt: '2026-08-20T00:00:00.000Z' }),
      buildPrompt({ id: 'new', updatedAt: '2026-08-21T00:00:00.000Z' }),
      buildPrompt({ id: 'pinned', pinned: true, updatedAt: '2026-08-19T00:00:00.000Z' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('searchPrompts 匹配标题、内容与标签', () => {
    const prompts = [
      buildPrompt({ id: 'title-hit', title: '决策助手' }),
      buildPrompt({ id: 'content-hit', content: '用于写周报' }),
      buildPrompt({ id: 'tag-hit', tags: ['学习'] }),
    ];

    expect(searchPrompts(prompts, '决策').map((item) => item.id)).toEqual(['title-hit']);
    expect(searchPrompts(prompts, '周报').map((item) => item.id)).toEqual(['content-hit']);
    expect(searchPrompts(prompts, '学习').map((item) => item.id)).toEqual(['tag-hit']);
    expect(searchPrompts(prompts, '')).toHaveLength(3);
  });

  it('collectTags 汇总去重并按中文排序', () => {
    const tags = collectTags([
      buildPrompt({ tags: ['决策', '学习'] }),
      buildPrompt({ tags: ['学习', '写作'] }),
    ]);

    expect(tags).toEqual(['决策', '写作', '学习']);
  });

  it('filterPromptsByTag 支持 all 与具体标签', () => {
    const prompts = [
      buildPrompt({ id: 'a', tags: ['学习'] }),
      buildPrompt({ id: 'b', tags: ['决策'] }),
    ];

    expect(filterPromptsByTag(prompts, 'all')).toHaveLength(2);
    expect(filterPromptsByTag(prompts, '学习').map((item) => item.id)).toEqual(['a']);
  });

  it('parseTagsInput 支持中英文逗号、顿号与空白分隔并去重', () => {
    expect(parseTagsInput('写作，决策、 学习  决策')).toEqual(['写作', '决策', '学习']);
    expect(parseTagsInput('   ')).toEqual([]);
  });
});

describe('preset prompts', () => {
  it('内置 12 条经典提示词且字段完整', () => {
    expect(presetPrompts).toHaveLength(12);
    presetPrompts.forEach((prompt) => {
      expect(prompt.preset).toBe(true);
      expect(prompt.id).toMatch(/^preset-/);
      expect(prompt.title.trim()).not.toBe('');
      expect(prompt.content.trim()).not.toBe('');
      expect(prompt.tags.length).toBeGreaterThan(0);
      expect(prompt.sourceUrl).toContain('x.com/Khazix0918');
    });
  });

  it('内置提示词 ID 唯一', () => {
    const ids = new Set(presetPrompts.map((prompt) => prompt.id));
    expect(ids.size).toBe(presetPrompts.length);
  });
});
