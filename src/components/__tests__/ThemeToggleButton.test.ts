import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeToggleButton from '@/components/ThemeToggleButton.vue';
import { useAppStore } from '@/store/app';

describe('ThemeToggleButton', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it('点击胶囊按钮后会切换主题并更新可访问标签', async () => {
    const store = useAppStore();
    const wrapper = mount(ThemeToggleButton, {
      global: {
        plugins: [pinia],
      },
    });
    const toggle = wrapper.get('[data-testid="theme-toggle"]');

    expect(store.themeMode).toBe('dark');
    expect(toggle.attributes('aria-label')).toBe('common.switch_to_light');
    expect(toggle.text()).toBe('');

    await toggle.trigger('click');

    expect(store.themeMode).toBe('light');
    expect(toggle.attributes('aria-label')).toBe('common.switch_to_dark');
    expect(toggle.text()).toBe('');
  });
});
