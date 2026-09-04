import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/store/app';
import TextDiff from '../TextDiff.vue';

describe('TextDiff', () => {
  let pinia: ReturnType<typeof createPinia>;

  const mountView = () =>
    mount(TextDiff, {
      global: {
        plugins: [pinia],
      },
    });

  const getWorkspaceChildTestIds = (wrapper: ReturnType<typeof mountView>) =>
    Array.from(wrapper.get('[data-testid="text-diff-workspace"]').element.children).map((child) =>
      (child as HTMLElement).getAttribute('data-testid')
    );
  const getWorkspaceClasses = (wrapper: ReturnType<typeof mountView>) =>
    wrapper.get('[data-testid="text-diff-workspace"]').classes();
  const getStage = (wrapper: ReturnType<typeof mountView>) => wrapper.get('[data-testid="text-diff-stage"]');

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it('默认展示单一主编辑舞台，workspace 下不再挂左右输入区和独立结果区', () => {
    const wrapper = mountView();
    const stage = getStage(wrapper);

    expect(wrapper.find('[data-testid="text-diff-workspace"]').exists()).toBe(true);
    expect(stage.exists()).toBe(true);
    expect(wrapper.find('[data-testid="text-diff-left-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="text-diff-right-input"]').exists()).toBe(true);
    expect(getWorkspaceClasses(wrapper)).toEqual(expect.arrayContaining(['grid', 'lg:grid-cols-2']));
    expect(getWorkspaceChildTestIds(wrapper)).toEqual(['text-diff-stage']);
    expect(wrapper.find('[data-testid="toggle-only-changes"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('tools.text_diff.result_title');
    expect(stage.find('[data-testid="text-diff-empty-state"]').exists()).toBe(false);
    expect(stage.find('[data-testid="text-diff-shared-lines"]').exists()).toBe(false);
    const [leftInput, rightInput] = wrapper.findAll('textarea');
    expect((leftInput.element as HTMLTextAreaElement).placeholder).toBe('tools.text_diff.left_placeholder');
    expect((rightInput.element as HTMLTextAreaElement).placeholder).toBe('tools.text_diff.right_placeholder');
  });

  it('输入新增行后共享 diff 行与左右输入层都位于同一个主编辑舞台', async () => {
    const wrapper = mountView();
    const stage = getStage(wrapper);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('alpha');
    await right.setValue('alpha\nbeta');

    expect(getWorkspaceClasses(wrapper)).toEqual(expect.arrayContaining(['grid', 'lg:grid-cols-2']));
    expect(getWorkspaceChildTestIds(wrapper)).toEqual(['text-diff-stage']);

    const sharedLines = stage.get('[data-testid="text-diff-shared-lines"]');
    expect(sharedLines.element.parentElement).not.toBe(wrapper.get('[data-testid="text-diff-workspace"]').element);
    expect(sharedLines.element.closest('[data-testid="text-diff-stage"]')).toBe(stage.element);
    expect(wrapper.get('[data-testid="text-diff-left-input"]').element.closest('[data-testid="text-diff-stage"]')).toBe(stage.element);
    expect(wrapper.get('[data-testid="text-diff-right-input"]').element.closest('[data-testid="text-diff-stage"]')).toBe(stage.element);

    const rows = sharedLines.findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].attributes('data-line-type')).toBe('add');
    expect(rows[1].find('[data-testid="left-placeholder"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="diff-line-left-cell"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="diff-line-right-cell"]').exists()).toBe(true);
  });

  it('输入修改行后会在共享行容器中保留左右 token 高亮', async () => {
    const wrapper = mountView();
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('hello old world');
    await right.setValue('hello new world');

    const rows = wrapper.get('[data-testid="text-diff-shared-lines"]').findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-line-type')).toBe('modify');
    expect(rows[0].find('[data-testid="diff-line-left-cell"] .diff-token-remove').text()).toContain('old');
    expect(rows[0].find('[data-testid="diff-line-right-cell"] .diff-token-add').text()).toContain('new');
  });

  it('深色模式下工作区根节点依赖全局 html.dark 而非本地 is-dark class', () => {
    const store = useAppStore();
    store.setThemeMode('dark');

    const wrapper = mountView();

    expect(wrapper.get('[data-testid="text-diff-workspace"]').classes()).toEqual(
      expect.arrayContaining(['text-diff-workspace'])
    );
    expect(wrapper.get('[data-testid="text-diff-workspace"]').classes()).not.toContain('is-dark');
    expect(wrapper.find('.text-diff-page.is-dark').exists()).toBe(false);
  });

  it('左右滚动容器连续滚动时会同步到最新位置', async () => {
    const wrapper = mountView();
    const leftScroll = wrapper.get('[data-testid="text-diff-left-input"]');
    const rightScroll = wrapper.get('[data-testid="text-diff-right-input"]');

    expect(leftScroll.exists()).toBe(true);
    expect(rightScroll.exists()).toBe(true);

    (leftScroll.element as HTMLTextAreaElement).scrollTop = 120;
    await leftScroll.trigger('scroll');
    expect((rightScroll.element as HTMLTextAreaElement).scrollTop).toBe(120);

    (leftScroll.element as HTMLTextAreaElement).scrollTop = 240;
    await leftScroll.trigger('scroll');

    expect((rightScroll.element as HTMLTextAreaElement).scrollTop).toBe(240);
  });

  it('被镜像侧回流较小实际值时不会把源侧错误回拉', async () => {
    const wrapper = mountView();
    const leftScroll = wrapper.get('[data-testid="text-diff-left-input"]');
    const rightScroll = wrapper.get('[data-testid="text-diff-right-input"]');
    const rightElement = rightScroll.element as HTMLTextAreaElement;
    let rightScrollTop = 0;

    Object.defineProperty(rightElement, 'scrollTop', {
      configurable: true,
      get: () => rightScrollTop,
      set: (value: number) => {
        rightScrollTop = value >= 240 ? 120 : value;
      },
    });

    (leftScroll.element as HTMLTextAreaElement).scrollTop = 240;
    await leftScroll.trigger('scroll');
    expect(rightElement.scrollTop).toBe(120);

    await rightScroll.trigger('scroll');

    expect((leftScroll.element as HTMLTextAreaElement).scrollTop).toBe(240);
  });

  it('聚焦哪一侧，哪一侧输入层应恢复可见输入状态', async () => {
    const wrapper = mountView();
    const [seedLeft, seedRight] = wrapper.findAll('textarea');
    await seedLeft.setValue('hello old world');
    await seedRight.setValue('hello new world');

    const [leftInput, rightInput] = wrapper.findAll('textarea');

    await leftInput.trigger('focus');
    expect(leftInput.classes()).toContain('is-active');
    expect(rightInput.classes()).not.toContain('is-active');
    expect(wrapper.find('[data-testid="diff-line-left-cell"]').classes()).toContain('is-muted-by-input');

    await rightInput.trigger('focus');
    expect(rightInput.classes()).toContain('is-active');
    expect(wrapper.find('[data-testid="diff-line-right-cell"]').classes()).toContain('is-muted-by-input');

    await rightInput.trigger('blur');
    expect(rightInput.classes()).not.toContain('is-active');
    expect(wrapper.find('[data-testid="diff-line-right-cell"]').classes()).not.toContain('is-muted-by-input');
  });

  it('交换左右文本后会互换输入内容', async () => {
    const wrapper = mountView();
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('left');
    await right.setValue('right');

    await wrapper.get('[data-testid="swap-button"]').trigger('click');

    const [nextLeft, nextRight] = wrapper.findAll('textarea');
    expect((nextLeft.element as HTMLTextAreaElement).value).toBe('right');
    expect((nextRight.element as HTMLTextAreaElement).value).toBe('left');
  });
});
