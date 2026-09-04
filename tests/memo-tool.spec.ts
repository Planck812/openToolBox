import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MemoTool from '@/tools/memo/MemoTool.vue';

const loadNotesMock = vi.fn();
const saveNotesMock = vi.fn();

vi.mock('@/tools/memo/note-storage', () => ({
  loadNotes: () => loadNotesMock(),
  saveNotes: (notes: unknown[]) => saveNotesMock(notes),
}));

describe('备忘录工具', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    loadNotesMock.mockReset();
    saveNotesMock.mockReset();
  });

  it('创建、编辑并自动保存便签', async () => {
    loadNotesMock.mockResolvedValue([]);
    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.get('[data-testid="memo-create-button"]').trigger('click');
    await wrapper.get('[data-testid="memo-title-input"]').setValue('周会');
    await wrapper.get('[data-testid="memo-content-input"]').setValue('确认上线窗口');
    await flushPromises();

    expect(saveNotesMock).toHaveBeenCalled();
    expect(wrapper.text()).toContain('周会');
    expect(wrapper.text()).toContain('确认上线窗口');
  });

  it('支持搜索与置顶排序', async () => {
    loadNotesMock.mockResolvedValue([
      {
        id: 'a',
        title: '采购',
        content: '苹果',
        pinned: false,
        createdAt: '2026-03-31T09:00:00.000Z',
        updatedAt: '2026-03-31T09:00:00.000Z',
      },
      {
        id: 'b',
        title: '会议',
        content: '发版',
        pinned: true,
        createdAt: '2026-03-31T10:00:00.000Z',
        updatedAt: '2026-03-31T10:00:00.000Z',
      },
    ]);

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    const items = wrapper.findAll('[data-testid="memo-list-item"]');
    expect(items[0].text()).toContain('会议');

    await wrapper.get('[data-testid="memo-search-input"]').setValue('苹果');
    await flushPromises();

    const filteredItems = wrapper.findAll('[data-testid="memo-list-item"]');
    expect(filteredItems).toHaveLength(1);
    expect(filteredItems[0].text()).toContain('采购');
  });

  it('左侧搜索区与右侧标题区使用一致的顶部表单节奏', async () => {
    loadNotesMock.mockResolvedValue([
      {
        id: 'a',
        title: '测试',
        content: '内容',
        pinned: false,
        createdAt: '2026-03-31T09:00:00.000Z',
        updatedAt: '2026-03-31T09:00:00.000Z',
      },
    ]);

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();

    const searchSection = wrapper.get('[data-testid="memo-search-section"]');
    const titleSection = wrapper.get('[data-testid="memo-title-section"]');

    expect(searchSection.classes()).toContain('gap-3');
    expect(titleSection.classes()).toContain('gap-3');
    expect(searchSection.text()).toContain('tools.memo.search_label');
    expect(titleSection.text()).toContain('tools.memo.title_label');
  });

  it('渲染月份列表并包含全部项', async () => {
    loadNotesMock.mockResolvedValue([
      {
        id: 'a',
        title: '二月',
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'b',
        title: '三月',
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();

    const monthItems = wrapper.findAll('[data-testid="memo-month-item"]');
    expect(monthItems[0].text()).toContain('tools.memo.month_all');
    expect(monthItems[1].text()).toContain('2026-03');
    expect(monthItems[2].text()).toContain('2026-02');
  });

  it('切换月份后只显示对应月份便签', async () => {
    loadNotesMock.mockResolvedValue([
      {
        id: 'a',
        title: '二月',
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'b',
        title: '三月',
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.findAll('[data-testid="memo-month-item"]')[1].trigger('click');
    await flushPromises();

    const noteItems = wrapper.findAll('[data-testid="memo-list-item"]');
    expect(noteItems).toHaveLength(1);
    expect(noteItems[0].text()).toContain('三月');
  });

  it('分页固定每页显示 3 条并支持翻页', async () => {
    loadNotesMock.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        id: `${index + 1}`,
        title: `便签${index + 1}`,
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
    );

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();

    expect(wrapper.findAll('[data-testid="memo-list-item"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="memo-pagination"]').text()).toContain('1 / 3');
    await wrapper.get('[data-testid="memo-next-page"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="memo-list-item"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="memo-pagination"]').text()).toContain('2 / 3');
  });

  it('删除当前页最后一条后会回退到上一页', async () => {
    loadNotesMock.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `${index + 1}`,
        title: `便签${index + 1}`,
        content: '',
        pinned: false,
        createdAt: '',
        updatedAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
    );

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.get('[data-testid="memo-next-page"]').trigger('click');
    await flushPromises();
    await wrapper.findAll('[title="tools.memo.delete"]')[0].trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="memo-pagination"]').text()).toContain('1 / 1');
  });

  it('月份筛选与搜索叠加后仍然只展示交集结果', async () => {
    loadNotesMock.mockResolvedValue([
      {
        id: 'a',
        title: '采购',
        content: '苹果',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'b',
        title: '会议',
        content: '苹果',
        pinned: false,
        createdAt: '',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const wrapper = mount(MemoTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.findAll('[data-testid="memo-month-item"]')[1].trigger('click');
    await wrapper.get('[data-testid="memo-search-input"]').setValue('苹果');
    await flushPromises();

    const noteItems = wrapper.findAll('[data-testid="memo-list-item"]');
    expect(noteItems).toHaveLength(1);
    expect(noteItems[0].text()).toContain('采购');
  });
});
