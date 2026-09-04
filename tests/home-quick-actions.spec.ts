import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomeView from '@/views/HomeView.vue';
import { getTimestampQuickResults } from '@/tools/timestamp/quick-results';
import { useAppStore } from '@/store/app';

const { pushMock, readTextMock, writeTextMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  readTextMock: vi.fn(),
  writeTextMock: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: readTextMock,
  writeText: writeTextMock,
}));

describe('首页快捷处理区', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    pushMock.mockReset();
    readTextMock.mockReset();
    writeTextMock.mockReset();
    readTextMock.mockResolvedValue('');
    writeTextMock.mockResolvedValue(undefined);
  });

  it('初始为单输入栏，点击快速分隔后切换为输入/结果双栏', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    expect(wrapper.findAll('textarea')).toHaveLength(1);

    await wrapper.find('textarea').setValue('sku1,sku2,sku3');
    const splitButton = wrapper.findAll('button').find((button) => button.text() === 'tools.text_split.quick_split');

    expect(splitButton).toBeTruthy();

    await splitButton!.trigger('click');
    await flushPromises();

    const textareas = wrapper.findAll('textarea');
    expect(textareas).toHaveLength(2);
    expect((textareas[0].element as HTMLTextAreaElement).value).toBe('sku1,sku2,sku3');
    expect((textareas[1].element as HTMLTextAreaElement).value).toBe('sku1\nsku2\nsku3');
    expect(writeTextMock).toHaveBeenCalledWith('sku1\nsku2\nsku3');
    expect(wrapper.text()).toContain('tools.text_processor.output_title');
  });

  it('切换不同快捷按钮时会在首页结果栏内刷新处理结果', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    await wrapper.find('textarea').setValue('hello%20world');

    const decodeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.text_processor.quick_url_decode');

    expect(decodeButton).toBeTruthy();

    await decodeButton!.trigger('click');
    await flushPromises();

    const textareas = wrapper.findAll('textarea');
    expect(textareas).toHaveLength(2);
    expect((textareas[1].element as HTMLTextAreaElement).value).toBe('hello world');
    expect(wrapper.text()).toContain('tools.text_processor.quick_url_decode');
    expect(writeTextMock).toHaveBeenCalledWith('hello world');
  });

  it('时间戳输入时展示四行快速结果', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await flushPromises();

    const results = getTimestampQuickResults('1672531200');
    const resultRows = wrapper.findAll('[data-nav-section="timestampResults"]');

    expect(resultRows).toHaveLength(results.length);
    expect(resultRows.map((row) => row.text())).toEqual(results);
  });

  it('默认选中第一个与输入不相同的时间结果', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await flushPromises();

    const selectedRow = wrapper.find('[data-nav-section="timestampResults"][data-nav-selected="true"]');
    expect(selectedRow.exists()).toBe(true);
    expect(selectedRow.text()).not.toBe('1672531200');
  });

  it('选中的时间结果行使用琥珀描边和工作台背景', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await flushPromises();

    const selectedRow = wrapper.find('[data-nav-section="timestampResults"][data-nav-selected="true"]');
    expect(selectedRow.exists()).toBe(true);
    expect(selectedRow.classes()).toContain('is-selected');
  });

  it('点击结果行会复制对应时间值', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await flushPromises();

    const results = getTimestampQuickResults('1672531200');
    const targetRow = wrapper.findAll('[data-nav-section="timestampResults"]')[1];
    await targetRow.trigger('click');
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledWith(results[1]);
  });

  it('结果区上下移动后 Enter 会复制当前值', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await textarea.trigger('focus');
    await flushPromises();

    const firstResult = wrapper.find('[data-nav-section="timestampResults"]');
    await firstResult.trigger('focus');
    await flushPromises();

    await wrapper.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    const results = getTimestampQuickResults('1672531200');
    const highlighted = wrapper.find('[data-nav-section="timestampResults"][data-nav-selected="true"]');
    expect(highlighted.exists()).toBe(true);
    expect(highlighted.text()).toBe(results[2]);

    await wrapper.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledWith(results[2]);
  });

  it('输入切回普通文本后结果区消失', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('1672531200');
    await flushPromises();

    expect(wrapper.find('[data-nav-section="timestampResults"]').exists()).toBe(true);

    await textarea.setValue('normal text');
    await flushPromises();

    expect(wrapper.findAll('[data-nav-section="timestampResults"]').length).toBe(0);
    expect(wrapper.findAll('textarea').length).toBe(1);
  });

  it('输入区按 Enter 不会触发工具打开或快捷操作', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('{"example":1}');
    await textarea.trigger('focus');
    await flushPromises();

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.element.dispatchEvent(enterEvent);
    await flushPromises();

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('搜索框按 Enter 不会直接打开工具：首次回车提交到所有工具区并高亮', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const searchInput = wrapper.find('input');
    await searchInput.setValue('json');
    await searchInput.trigger('focus');
    await flushPromises();

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    searchInput.element.dispatchEvent(enterEvent);
    await flushPromises();

    // 首次回车拦截默认行为并提交到所有工具区（高亮首项），不直接打开工具
    expect(enterEvent.defaultPrevented).toBe(true);
    const allToolsSection = wrapper.find('[data-nav-selected="true"][data-nav-section="allTools"]');
    expect(allToolsSection.exists()).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('Tab 切换到快捷操作区按 Enter 会执行当前按钮', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('sku1,sku2,sku3');
    await flushPromises();

    const splitButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'tools.text_split.quick_split');
    expect(splitButton).toBeTruthy();

    await textarea.trigger('focus');
    await flushPromises();

    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    const quickSection = wrapper.find('[data-nav-selected="true"][data-nav-section="quickActions"]');
    expect(quickSection.exists()).toBe(true);
    expect(quickSection.text()).toContain('tools.text_split.quick_split');

    // 在根层级再触发 Enter，确保默认由首页级 keydown 处理
    await wrapper.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(writeTextMock).toHaveBeenCalledWith('sku1\nsku2\nsku3');
    wrapper.unmount();
  });

  it('快捷区高亮后继续在输入框输入会回到输入区且 Enter 不执行快捷操作', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('sku1,sku2,sku3');
    await textarea.trigger('focus');
    await flushPromises();

    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();

    const quickSection = wrapper.find('[data-nav-selected="true"][data-nav-section="quickActions"]');
    expect(quickSection.exists()).toBe(true);

    await textarea.setValue('sku1,sku2,sku3,sku4');
    await flushPromises();

    const inputSection = wrapper.find('[data-nav-selected="true"][data-nav-section="input"]');
    expect(inputSection.exists()).toBe(true);

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.element.dispatchEvent(enterEvent);
    await flushPromises();

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(writeTextMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('推荐工具区按 Enter 会打开当前选中工具', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await flushPromises();
    const searchInput = wrapper.find('.search-input');
    await searchInput.setValue('{"example":1}');
    await flushPromises();

    const firstMatch = store.matchedTools[0];
    expect(firstMatch).toBeTruthy();

    const textarea = wrapper.find('textarea');
    await textarea.trigger('focus');
    await flushPromises();

    // 主输入框编辑态 ↑/↓ 不再跨区导航；改用 Tab 依次移到快捷操作区、推荐工具区
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    await wrapper.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(pushMock).toHaveBeenCalledWith(`/tool/${firstMatch.toolId}`);
    wrapper.unmount();
  });

  it('所有工具区按 Enter 会打开当前选中工具', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.trigger('focus');
    await flushPromises();

    const firstTool = store.filteredTools[0];
    expect(firstTool).toBeTruthy();

    // 「所有工具」默认折叠，先展开让它进入键盘导航分区
    await wrapper.get('[data-testid="all-tools-toggle"]').trigger('click');
    await flushPromises();

    // 主输入框编辑态 ↑/↓ 不再跨区导航；改用 Tab 依次移到快捷操作区、强力工具区、所有工具区
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    await wrapper.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(pushMock).toHaveBeenCalledWith(`/tool/${firstTool.metadata.id}`);
    wrapper.unmount();
  });

  it('所有工具区不随搜索关键词过滤，始终展示完整工具列表', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await flushPromises();
    store.searchQuery = 'text';
    await flushPromises();

    const initialCards = wrapper.findAll('[data-nav-section="allTools"]');
    expect(initialCards.length).toBeGreaterThan(1);
    store.searchQuery = 'json-viewer';
    await flushPromises();

    const cardsAfterSearch = wrapper.findAll('[data-nav-section="allTools"]');
    expect(cardsAfterSearch).toHaveLength(initialCards.length);
    expect(wrapper.find('[data-testid="tool-grid-empty"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('home.empty.all');
    wrapper.unmount();
  });

  it('在输入区编辑态按 ArrowDown 不跨区导航（保留光标移动）', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.trigger('focus');
    await flushPromises();

    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    textarea.element.dispatchEvent(downEvent);
    await flushPromises();

    // 主输入框编辑态 ↑/↓ 不拦截默认行为（光标可上下移动），也不跨区导航
    expect(downEvent.defaultPrevented).toBe(false);
    const inputSection = wrapper.find('[data-nav-selected="true"][data-nav-section="input"]');
    expect(inputSection.exists()).toBe(true);
    const quickSection = wrapper.find('[data-nav-selected="true"][data-nav-section="quickActions"]');
    expect(quickSection.exists()).toBe(false);
    wrapper.unmount();
  });

  it('在快捷操作区按 ArrowDown 会跳到推荐工具区', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const searchInput = wrapper.find('.search-input');
    await searchInput.setValue('{"example":1}');
    await flushPromises();

    const textarea = wrapper.find('textarea');
    await textarea.trigger('focus');
    await flushPromises();

    // 主输入框编辑态 ↑/↓ 不再跨区导航；先用 Tab 移出输入区到快捷操作区
    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();

    const quickSection = wrapper.find('[data-nav-selected="true"][data-nav-section="quickActions"]');
    expect(quickSection.exists()).toBe(true);

    await wrapper.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    const recommendedSection = wrapper.find('[data-nav-selected="true"][data-nav-section="recommended"]');
    expect(recommendedSection.exists()).toBe(true);
    expect(recommendedSection.text()).toContain('tools.json_viewer.name');
    wrapper.unmount();
  });

  it('在推荐工具区按 ArrowDown 会跨区跳到所有工具区', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    // 「所有工具」默认折叠，先展开让它进入键盘导航分区
    await wrapper.get('[data-testid="all-tools-toggle"]').trigger('click');
    await flushPromises();
    const textarea = wrapper.find('textarea');
    await textarea.setValue('{"example":1}');
    await textarea.trigger('focus');
    await flushPromises();

    await textarea.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    // 中途可能经过快捷操作区/强力工具区，连续向下直到高亮落在所有工具区
    for (let i = 0; i < 5; i += 1) {
      if (wrapper.find('[data-nav-selected="true"][data-nav-section="allTools"]').exists()) {
        break;
      }
      await wrapper.trigger('keydown', { key: 'ArrowDown' });
      await flushPromises();
    }

    const allToolsSection = wrapper.find('[data-nav-selected="true"][data-nav-section="allTools"]');
    expect(allToolsSection.exists()).toBe(true);
    expect(allToolsSection.text()).toContain('tools.json_viewer.name');
    wrapper.unmount();
  });

  it('在输入区连续按 Tab 会依次跳到快捷操作区和推荐工具区', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(HomeView, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();
    const searchInput = wrapper.find('.search-input');
    await searchInput.setValue('{"example":1}');
    await flushPromises();

    const textarea = wrapper.find('textarea');
    await textarea.trigger('focus');
    await flushPromises();

    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();

    const quickSection = wrapper.find('[data-nav-selected="true"][data-nav-section="quickActions"]');
    expect(quickSection.exists()).toBe(true);

    await textarea.trigger('keydown', { key: 'Tab' });
    await flushPromises();

    const recommendedSection = wrapper.find('[data-nav-selected="true"][data-nav-section="recommended"]');
    expect(recommendedSection.exists()).toBe(true);
    expect(recommendedSection.text()).toContain('tools.json_viewer.name');
    wrapper.unmount();
  });
});
