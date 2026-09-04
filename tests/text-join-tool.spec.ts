import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TextJoin from '@/tools/text-join/TextJoin.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

const mountView = (props?: { initialData?: string }) =>
  mount(TextJoin, {
    props,
    global: {
      plugins: [createPinia()],
    },
  });

describe('文本合并页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('使用默认逗号分隔合并多行文本', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('a\nb\nc');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.merge'))!.trigger('click');
    await flushPromises();

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('a,b,c');
    expect(writeTextMock).toHaveBeenCalledWith('a,b,c');
  });

  it('支持切换为竖线分隔', async () => {
    const wrapper = mountView();
    const inputs = wrapper.findAll('input');
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputs[0].setValue('|');
    await inputArea.setValue('x\ny');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.merge'))!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('x|y');
  });

  it('支持双引号包裹输出', async () => {
    const wrapper = mountView();
    const checkbox = wrapper.findAll('input[type="checkbox"]')[0];
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await checkbox.setValue(true);
    await inputArea.setValue('foo\nbar');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.merge'))!.trigger('click');

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('"foo","bar"');
  });

  it('支持通过 initialData 静默生成结果', async () => {
    const wrapper = mountView({ initialData: 'left\nright' });
    const [, outputArea] = wrapper.findAll('textarea');
    await flushPromises();

    expect((outputArea.element as HTMLTextAreaElement).value).toBe('left,right');
  });

  it('支持复制结果与清空内容', async () => {
    const wrapper = mountView();
    const [inputArea, outputArea] = wrapper.findAll('textarea');

    await inputArea.setValue('1\n2');
    const mergeButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.merge'))!;
    const copyButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.copy_result'))!;
    const clearButton = wrapper.findAll('button').find((item) => item.text().includes('tools.text_join.clear'))!;

    await mergeButton.trigger('click');
    await flushPromises();
    await copyButton.trigger('click');
    await clearButton.trigger('click');

    expect(writeTextMock).toHaveBeenCalledWith('1,2');
    expect((inputArea.element as HTMLTextAreaElement).value).toBe('');
    expect((outputArea.element as HTMLTextAreaElement).value).toBe('');
  });
});
