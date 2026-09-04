import { describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import TextDedup from '@/tools/text-dedup/TextDedup.vue';
import TextJoin from '@/tools/text-join/TextJoin.vue';
import TextProcessor from '@/tools/text-processor/TextProcessor.vue';
import TextSplit from '@/tools/text-split/TextSplit.vue';

// TextProcessor 使用 useRoute 读取 ?pipeline= 启动 target；单测无真实路由，提供最小 query 与 router。
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

const mountWithPlugins = (component: Parameters<typeof mount>[0]) =>
  mount(component, {
    global: {
      plugins: [createPinia()],
    },
  });

const findCheckboxByLabel = (wrapper: VueWrapper<any>, labelText: string) => {
  const labels = wrapper.findAll('label');
  const target = labels.find((label) => label.text().includes(labelText));

  expect(target, `未找到标签：${labelText}`).toBeTruthy();

  const checkbox = target!.find('input[type="checkbox"]');
  expect(checkbox.exists(), `标签 ${labelText} 下未找到复选框`).toBe(true);

  return checkbox;
};

describe('自动复制默认状态', () => {
  it('文本去重默认勾选自动复制', () => {
    const wrapper = mountWithPlugins(TextDedup);

    const checkbox = findCheckboxByLabel(wrapper, 'tools.text_dedup.auto_copy');

    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });

  it('文本合并默认勾选自动复制', () => {
    const wrapper = mountWithPlugins(TextJoin);

    const checkbox = findCheckboxByLabel(wrapper, 'tools.text_join.auto_copy');

    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });

  it('文本分割默认勾选自动复制', () => {
    const wrapper = mountWithPlugins(TextSplit);

    const checkbox = findCheckboxByLabel(wrapper, 'tools.text_split.auto_copy');

    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });

  it('文本处理默认勾选自动复制', () => {
    const wrapper = mountWithPlugins(TextProcessor);

    const checkbox = findCheckboxByLabel(wrapper, 'tools.text_processor.auto_copy');

    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });
});
