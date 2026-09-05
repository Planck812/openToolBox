import { computed, toRaw } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomeView from '@/views/HomeView.vue';
import { useAppStore } from '@/store/app';

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn().mockResolvedValue(''),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

/** 确保「所有工具」区块处于展开状态。若未展开则点击标题展开。 */
const expandAllTools = async (wrapper: ReturnType<typeof mount>) => {
  if (wrapper.find('[data-testid="tool-grid"]').exists()) {
    return;
  }
  await wrapper.get('[data-testid="all-tools-toggle"]').trigger('click');
  await flushPromises();
};

describe('HomeView', () => {
  beforeEach(() => {
    routerPushMock.mockReset();
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('渲染精密命令台首页结构并保留工具入口', () => {
    const wrapper = mount(HomeView, {
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.get('[data-testid="home-shell"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="home-search-panel"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="home-workbench"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid^="tool-card-"]').length).toBeGreaterThan(0);
  });

  it('默认推荐工具限制为六个，并使用紧凑工具卡布局', () => {
    const wrapper = mount(HomeView, {
      global: {
        plugins: [createPinia()],
      },
    });
    const recommendedGrid = wrapper.get('[data-testid="tool-grid-recommended"]');
    const recommendedCards = recommendedGrid.findAll('[data-nav-section="recommended"]');

    expect(recommendedCards.length).toBeLessThanOrEqual(6);
    expect(recommendedGrid.classes()).toEqual(expect.arrayContaining([
      'grid-cols-1',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      'xl:grid-cols-4',
      'min-[1440px]:grid-cols-5',
      '2xl:grid-cols-6',
    ]));
    expect(recommendedCards.every((card) => card.classes().includes('tool-card'))).toBe(true);
    expect(recommendedCards.every((card) => card.find('.tool-icon').exists())).toBe(true);
    expect(recommendedGrid.find('.feature-card').exists()).toBe(false);
    expect(recommendedGrid.find('.feature-arrow').exists()).toBe(false);
    expect(recommendedGrid.find('[data-testid^="favorite-tool-"]').exists()).toBe(false);
  });
  it('强匹配推荐结果超过六个时只显示前六个', () => {
    const pinia = createPinia();
    const store = useAppStore(pinia);
    Object.defineProperty(toRaw(store), 'matchedTools', {
      configurable: true,
      enumerable: true,
      value: computed(() => [
        { toolId: 'json-viewer', score: 100 },
        { toolId: 'timestamp', score: 90 },
        { toolId: 'text-split', score: 80 },
        { toolId: 'text-join', score: 70 },
        { toolId: 'text-dedup', score: 60 },
        { toolId: 'text-processor', score: 50 },
        { toolId: 'qrcode-gen', score: 40 },
      ]),
    });

    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const recommendedCards = wrapper.findAll('[data-testid="tool-grid-recommended"] [data-nav-section="recommended"]');

    expect(recommendedCards).toHaveLength(6);
    expect(recommendedCards.map((card) => card.attributes('data-nav-item'))).toEqual([
      'json-viewer',
      'timestamp',
      'text-split',
      'text-join',
      'text-dedup',
      'text-processor',
    ]);
  });

  it('强力工具区块默认展示文本处理/备忘录/密码夹/提示词库四个入口', () => {
    const wrapper = mount(HomeView, {
      global: {
        plugins: [createPinia()],
      },
    });
    const strongCards = wrapper.findAll('[data-testid="tool-grid-strong"] [data-nav-section="strongTools"]');

    expect(strongCards.map((card) => card.attributes('data-nav-item'))).toEqual([
      'text-processor',
      'memo',
      'pwd-box',
      'prompt-manager',
    ]);
  });

  it('自定义面板可勾选工具并实时更新强力工具与持久化', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await wrapper.get('[data-testid="strong-tools-customize-button"]').trigger('click');
    expect(wrapper.find('[data-testid="strong-tools-editor"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="strong-tool-option-memo"]').classes()).toContain('is-picked');
    expect(wrapper.get('[data-testid="strong-tool-option-json-viewer"]').classes()).not.toContain('is-picked');

    await wrapper.get('[data-testid="strong-tool-option-json-viewer"]').trigger('click');
    await wrapper.get('[data-testid="strong-tool-option-memo"]').trigger('click');
    await flushPromises();

    expect(store.strongToolIds).toContain('json-viewer');
    expect(store.strongToolIds).not.toContain('memo');
    expect(JSON.parse(localStorage.getItem('home.strongToolIds') ?? '[]')).toEqual(store.strongToolIds);

    await wrapper.get('[data-testid="strong-tools-editor-done"]').trigger('click');
    expect(wrapper.find('[data-testid="strong-tools-editor"]').exists()).toBe(false);

    const strongCards = wrapper.findAll('[data-testid="tool-grid-strong"] [data-nav-section="strongTools"]');
    expect(strongCards.map((card) => card.attributes('data-nav-item'))).not.toContain('memo');
    expect(strongCards.map((card) => card.attributes('data-nav-item'))).toContain('json-viewer');
  });

  it('清空全部强力工具后展示空状态提示', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await wrapper.get('[data-testid="strong-tools-customize-button"]').trigger('click');
    for (const id of ['text-processor', 'memo', 'pwd-box', 'prompt-manager']) {
      await wrapper.get(`[data-testid="strong-tool-option-${id}"]`).trigger('click');
    }
    await flushPromises();

    expect(store.strongToolIds).toEqual([]);
    expect(wrapper.find('[data-testid="tool-grid-strong"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="strong-tools-empty"]').exists()).toBe(true);
  });

  it('恢复默认按钮还原四个默认入口并持久化', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    await wrapper.get('[data-testid="strong-tools-customize-button"]').trigger('click');
    await wrapper.get('[data-testid="strong-tool-option-text-processor"]').trigger('click');
    await flushPromises();
    expect(store.strongToolIds).not.toContain('text-processor');

    await wrapper.get('[data-testid="strong-tools-editor-reset"]').trigger('click');
    await flushPromises();

    expect(store.strongToolIds).toEqual(['text-processor', 'memo', 'pwd-box', 'prompt-manager']);
    expect(JSON.parse(localStorage.getItem('home.strongToolIds') ?? '[]')).toEqual([
      'text-processor',
      'memo',
      'pwd-box',
      'prompt-manager',
    ]);
  });

  it('所有工具默认展开，点击标题可收起与再次展开', async () => {
    const wrapper = mount(HomeView, {
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.find('[data-testid="tool-grid"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="all-tools-toggle"]').attributes('aria-expanded')).toBe('true');

    await wrapper.get('[data-testid="all-tools-toggle"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-grid"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="all-tools-toggle"]').attributes('aria-expanded')).toBe('false');

    await wrapper.get('[data-testid="all-tools-toggle"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-grid"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="all-tools-toggle"]').attributes('aria-expanded')).toBe('true');
  });

  it('点击侧边栏分类后只展示对应分类工具', async () => {
    const wrapper = mount(HomeView, {
      global: {
        plugins: [createPinia()],
      },
    });

    await wrapper.find('textarea').setValue('1');
    await wrapper.findAll('button').find((button) => button.text() === 'home.category.security')!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('home.category.security');
    expect(wrapper.find('[data-testid="tool-card-jwt-tool"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-card-pwd-box"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-card-json-diff"]').exists()).toBe(false);
  });

  it('工具卡星标可加入我的收藏并在侧边栏收藏中展示', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await expandAllTools(wrapper);

    await wrapper.get('[data-testid="favorite-tool-json-viewer"]').trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'home.sidebar.favorites')!.trigger('click');
    await flushPromises();

    expect(store.favoriteToolIds).toEqual(['json-viewer']);
    expect(wrapper.text()).toContain('home.sidebar.favorites');
    expect(wrapper.find('[data-testid="tool-card-json-viewer"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-card-timestamp"]').exists()).toBe(false);
  });

  it('点击星标收藏不会触发工具跳转', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await expandAllTools(wrapper);

    wrapper
      .get('[data-testid="favorite-tool-json-viewer"] svg')
      .element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 16, clientY: 16, bubbles: true }));
    await wrapper.get('[data-testid="favorite-tool-json-viewer"]').trigger('click');
    await flushPromises();

    expect(store.favoriteToolIds).toEqual(['json-viewer']);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('所有工具会把已收藏工具优先展示并保留未收藏工具原始顺序', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await expandAllTools(wrapper);
    const getAllToolIds = () =>
      wrapper.findAll('[data-nav-section="allTools"]').map((node) => node.attributes('data-nav-item'));

    expect(getAllToolIds().slice(0, 3)).toEqual(['json-viewer', 'timestamp', 'text-split']);

    await wrapper.get('[data-testid="favorite-tool-text-split"]').trigger('click');
    await flushPromises();

    expect(store.favoriteToolIds).toEqual(['text-split']);
    expect(getAllToolIds().slice(0, 3)).toEqual(['text-split', 'json-viewer', 'timestamp']);
  });

  it('所有工具支持拖拽自定义排序并让自定义顺序优先于收藏置顶', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await expandAllTools(wrapper);
    const getAllToolIds = () =>
      wrapper.findAll('[data-nav-section="allTools"]').map((node) => node.attributes('data-nav-item'));
    const targetElement = wrapper.get('[data-testid="tool-card-json-viewer"]').element;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(),
    });
    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetElement);

    await wrapper.get('[data-testid="favorite-tool-json-viewer"]').trigger('click');
    const sourceElement = wrapper.get('[data-testid="tool-card-text-split"]').element;
    sourceElement.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true })
    );
    sourceElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 40, bubbles: true }));
    sourceElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 40, bubbles: true }));
    await flushPromises();

    expect(store.favoriteToolIds).toEqual(['json-viewer']);
    expect(store.homeToolOrderIds.slice(0, 3)).toEqual(['text-split', 'json-viewer', 'timestamp']);
    expect(getAllToolIds().slice(0, 3)).toEqual(['text-split', 'json-viewer', 'timestamp']);
    expect(JSON.parse(localStorage.getItem('home.toolOrderIds') ?? '[]').slice(0, 3)).toEqual([
      'text-split',
      'json-viewer',
      'timestamp',
    ]);

    elementFromPointSpy.mockRestore();
  });

  it('打开工具后会写入最近使用并可从侧边栏查看', async () => {
    const pinia = createPinia();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await expandAllTools(wrapper);

    await wrapper.get('[data-testid="tool-card-json-viewer"]').trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'home.sidebar.recent')!.trigger('click');
    await flushPromises();

    expect(store.recentToolIds[0]).toBe('json-viewer');
    expect(wrapper.text()).toContain('home.sidebar.recent');
    expect(wrapper.find('[data-testid="tool-card-json-viewer"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-card-timestamp"]').exists()).toBe(false);
  });
});
