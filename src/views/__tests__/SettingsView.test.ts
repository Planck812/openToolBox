import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/views/SettingsView.vue';
import { useAppStore } from '@/store/app';

const { routerPushMock, routeQuery } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  routeQuery: { query: {} },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
  useRoute: () => routeQuery,
}));

const universalInputSelector = 'input[placeholder="common.universal_screenshot_shortcut_placeholder"]';

/**
 * 点击左侧导航中的「全平台截图」子项，切到 shortcut-screenshot 区块后再定位输入框。
 * 导航子项以 button 渲染，文案为 common.universal_screenshot_shortcut_label。
 */
async function goToScreenshotShortcut(wrapper: ReturnType<typeof mount>) {
  const navItem = wrapper.findAll('button').find((b) => b.text() === 'common.universal_screenshot_shortcut_label');
  expect(navItem).toBeDefined();
  await navItem!.trigger('click');
  await flushPromises();
}

describe('SettingsView', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    routerPushMock.mockReset();
    routeQuery.query = {};
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it('渲染快捷键区块（主页唤起、窗口唤起、全平台截图）', () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.text()).toContain('common.home_shortcut_label');
    expect(wrapper.text()).toContain('common.show_shortcut_label');
    expect(wrapper.text()).toContain('common.universal_screenshot_shortcut_label');
  });

  it('通过 query.section 直达指定设置区块（托盘「设置快捷键」入口）', () => {
    routeQuery.query = { section: 'shortcut-screenshot' };
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    // 无需点击导航，输入框直接挂载
    const input = wrapper.find(universalInputSelector);
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+S');
  });

  it('通过 query.section 直达单便利贴区块并显示默认值', () => {
    routeQuery.query = { section: 'shortcut-single-sticky' };
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const input = wrapper.find('input[placeholder="common.single_sticky_shortcut_placeholder"]');
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+E');
  });

  it('通过 query.section 直达恢复全部贴图交互区块并显示默认值', () => {
    routeQuery.query = { section: 'shortcut-pin-recovery' };
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    const input = wrapper.find('input[placeholder="common.pin_recovery_shortcut_placeholder"]');
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+P');
  });

  it('通过 query.section 直达工具快捷键列表并可录制', async () => {
    routeQuery.query = { section: 'shortcut-tools' };
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    const recorder = wrapper.find('input[placeholder="common.tool_shortcuts_placeholder"]');
    expect(recorder.exists()).toBe(true);

    await recorder.trigger('keydown', { key: '1', ctrlKey: true, altKey: true }); // Ctrl+Alt+1

    const entries = Object.entries(store.toolShortcuts);
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('Ctrl+Alt+1');
  });

  it('通过 query.section 直达文本管线快捷键列表并可录制', async () => {
    routeQuery.query = { section: 'shortcut-pipelines' };
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();

    const recorder = wrapper.find('input[placeholder="common.tool_shortcuts_placeholder"]');
    expect(recorder.exists()).toBe(true);

    await recorder.trigger('keydown', { key: '2', ctrlKey: true, altKey: true }); // Ctrl+Alt+2

    const entries = Object.entries(store.pipelineShortcuts);
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('Ctrl+Alt+2');
  });

  it('全平台截图快捷键输入框初始值为默认 Ctrl+Shift+S', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });

    await goToScreenshotShortcut(wrapper);

    const input = wrapper.find(universalInputSelector);
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+S');
  });

  it('按下组合键后标记 dirty，保存后写入 store 并返回首页', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await goToScreenshotShortcut(wrapper);
    const input = wrapper.find(universalInputSelector);

    await input.trigger('keydown', { key: 'k', ctrlKey: true, shiftKey: true });

    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+K');

    const saveButton = wrapper.findAll('button').find((btn) => btn.text() === 'common.screenshot_shortcut_save')!;
    expect(saveButton.attributes('disabled')).toBeUndefined();
    expect(saveButton.classes()).not.toContain('is-disabled');

    await saveButton.trigger('click');
    await flushPromises();

    expect(store.universalScreenshotShortcut).toBe('Ctrl+Shift+K');
    expect(localStorage.getItem('settings.universalScreenshotShortcut')).toBe('Ctrl+Shift+K');
    expect(routerPushMock).toHaveBeenCalledWith('/');
  });

  it('Backspace 清空后保存会回退到默认值', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    await goToScreenshotShortcut(wrapper);
    const input = wrapper.find(universalInputSelector);

    await input.trigger('keydown', { key: 'Backspace' });
    expect((input.element as HTMLInputElement).value).toBe('');

    const saveButton = wrapper.findAll('button').find((btn) => btn.text() === 'common.screenshot_shortcut_save')!;
    await saveButton.trigger('click');
    await flushPromises();

    expect(store.universalScreenshotShortcut).toBe('Ctrl+Shift+S');
    expect(localStorage.getItem('settings.universalScreenshotShortcut')).toBe('Ctrl+Shift+S');
  });

  it('恢复默认按钮将全平台截图快捷键重置为默认并同步输入框', async () => {
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [pinia],
      },
    });
    const store = useAppStore();
    store.setUniversalScreenshotShortcut('Ctrl+Alt+K');
    await flushPromises();

    await goToScreenshotShortcut(wrapper);

    const input = wrapper.find(universalInputSelector);
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Alt+K');

    const resetButton = wrapper.findAll('button').find((btn) => btn.text() === 'common.screenshot_shortcut_reset')!;
    await resetButton.trigger('click');
    await flushPromises();

    expect(store.universalScreenshotShortcut).toBe('Ctrl+Shift+S');
    expect((input.element as HTMLInputElement).value).toBe('Ctrl+Shift+S');
  });
});
