import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TextSplit from '@/tools/text-split/TextSplit.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

const mountView = (props?: { initialData?: string }) =>
  mount(TextSplit, {
    props,
    global: {
      plugins: [createPinia()],
    },
  });

describe('文本分割页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('支持使用默认逗号分隔并自动复制结果', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('a,b,c');
    const convertButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_split.convert'));
    await convertButton!.trigger('click');
    await flushPromises();

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('a\nb\nc');
    expect(writeTextMock).toHaveBeenCalledWith('a\nb\nc');
  });

  it('支持切换为制表符分隔', async () => {
    const wrapper = mountView();
    const delimiterInput = wrapper.get('input');
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await delimiterInput.setValue('\t');
    await inputArea.setValue('foo\tbar\tbaz');
    const convertButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_split.convert'));
    await convertButton!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('foo\nbar\nbaz');
  });

  it('支持通过 initialData 静默预填并直接产出结果', async () => {
    const wrapper = mountView({ initialData: 'left,right' });
    const [, outputArea] = wrapper.findAll('textarea');
    await flushPromises();

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('left\nright');
  });

  it('关闭自动复制后不再写入剪贴板', async () => {
    const wrapper = mountView();
    const checkbox = wrapper.findAll('input[type="checkbox"]')[0];
    const [inputArea] = wrapper.findAll('textarea');

    await checkbox.setValue(false);
    await inputArea.setValue('x,y');
    const convertButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_split.convert'));
    await convertButton!.trigger('click');
    await flushPromises();

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('支持复制结果与一键清空', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('1,2');
    const buttons = wrapper.findAll('button');
    await buttons.find((item) => item.text().includes('tools.text_split.convert'))!.trigger('click');
    await flushPromises();
    await buttons.find((item) => item.text().includes('tools.text_split.copy_result'))!.trigger('click');
    await buttons.find((item) => item.text().includes('tools.text_split.clear'))!.trigger('click');

    expect(writeTextMock).toHaveBeenCalledWith('1\n2');
    expect((inputArea.element as HTMLTextAreaElement).value).toBe('');
    expect((outputArea.element as HTMLTextAreaElement).value).toBe('');
  });
});
