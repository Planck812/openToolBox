import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import RegexLab from '../RegexLab.vue';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(),
}));

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ showToast: vi.fn() }),
}));

describe('RegexLab mount', () => {
  it('renders core controls', async () => {
    const wrapper = mount(RegexLab, {
      props: {
        // 默认示例文案已迁移到 i18n（tests/setup.ts 的 t mock 返回 key，
        // 不再包含真实邮箱），这里提供会命中默认 pattern 的初始文本来渲染匹配列表。
        initialData: { text: 'alice@example.com' },
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="regex-pattern-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="regex-test-text"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="regex-status"]').exists()).toBe(true);
    expect((wrapper.find('[data-testid="regex-pattern-input"]').element as HTMLInputElement).value).toContain('@');
    expect(wrapper.find('[data-testid="regex-matches-list"]').exists()).toBe(true);
    expect(wrapper.html().length).toBeGreaterThan(200);
    wrapper.unmount();
  });

  it('puts free-form clipboard text into test area, not pattern', async () => {
    const wrapper = mount(RegexLab, {
      props: {
        initialData: '这是一段普通剪贴板文本，不是正则表达式',
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    const patternInput = wrapper.find('[data-testid="regex-pattern-input"]').element as HTMLInputElement;
    const testArea = wrapper.find('[data-testid="regex-test-text"]').element as HTMLTextAreaElement;
    expect(patternInput.value).not.toContain('剪贴板');
    expect(testArea.value).toContain('剪贴板');
    wrapper.unmount();
  });
});
