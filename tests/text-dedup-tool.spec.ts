import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TextDedup from '@/tools/text-dedup/TextDedup.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

const mountView = (props?: { initialData?: string }) =>
  mount(TextDedup, {
    props,
    global: {
      plugins: [createPinia()],
    },
  });

describe('文本去重页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('默认按忽略大小写和去空行规则去重', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('A\na\n\nb');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.dedup'))!.trigger('click');
    await flushPromises();

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('A\nb');
    expect(writeTextMock).toHaveBeenCalledWith('A\nb');
  });

  it('关闭忽略大小写后会保留大小写差异', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');
    const ignoreCaseCheckbox = wrapper.findAll('input[type="checkbox"]')[2];

    await ignoreCaseCheckbox.setValue(false);
    await inputArea.setValue('A\na');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.dedup'))!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('A\na');
  });

  it('开启排序后会按字母顺序输出', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');
    const sortCheckbox = wrapper.findAll('input[type="checkbox"]')[5];

    await sortCheckbox.setValue(true);
    await inputArea.setValue('c\na\nb');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.dedup'))!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('a\nb\nc');
  });

  it('支持 initialData 预填并手动去重', async () => {
    const wrapper = mountView({ initialData: 'x\nx\ny' });
    const [, outputArea] = wrapper.findAll('textarea');

    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.dedup'))!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('x\ny');
  });

  it('支持复制结果与清空输入输出', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('1\n1');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.dedup'))!.trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.copy_result'))!.trigger('click');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_dedup.clear'))!.trigger('click');

    expect(writeTextMock).toHaveBeenCalledWith('1');
    expect((inputArea.element as HTMLTextAreaElement).value).toBe('');
    expect((outputArea.element as HTMLTextAreaElement).value).toBe('');
  });
});
