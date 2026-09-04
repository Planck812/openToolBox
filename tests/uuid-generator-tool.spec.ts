import { createPinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UuidGenerator from '@/tools/uuid-generator/UuidGenerator.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

const mountView = () =>
  mount(UuidGenerator, {
    global: {
      plugins: [createPinia()],
    },
  });

describe('UUID 生成页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('首次挂载会静默生成 10 条 UUID', async () => {
    const wrapper = mountView();
    const output = wrapper.get('textarea');
    await flushPromises();

    expect((output.element as HTMLTextAreaElement).value.trim().split('\n')).toHaveLength(10);
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('切换大写后结果会同步转为大写', async () => {
    const wrapper = mountView();
    const output = wrapper.get('textarea');
    const uppercaseCheckbox = wrapper.findAll('input[type="checkbox"]')[0];
    await flushPromises();

    await uppercaseCheckbox.setValue(true);
    const firstLine = (output.element as HTMLTextAreaElement).value.trim().split('\n')[0];
    expect(firstLine).toBe(firstLine.toUpperCase());
  });

  it('去掉连字符后输出不再包含短横线', async () => {
    const wrapper = mountView();
    const output = wrapper.get('textarea');
    const removeHyphenCheckbox = wrapper.findAll('input[type="checkbox"]')[1];
    await flushPromises();

    await removeHyphenCheckbox.setValue(true);
    expect((output.element as HTMLTextAreaElement).value).not.toContain('-');
  });

  it('数量输入会被限制在 1 到 500 之间', async () => {
    const wrapper = mountView();
    const countInput = wrapper.get('input[type="number"]');

    await countInput.setValue('700');
    expect((countInput.element as HTMLInputElement).value).toBe('500');

    await countInput.setValue('0');
    expect((countInput.element as HTMLInputElement).value).toBe('1');
  });

  it('点击生成和复制结果会写入剪贴板', async () => {
    const wrapper = mountView();
    const buttons = wrapper.findAll('button');

    await buttons.find((item) => item.text().includes('tools.uuid_generator.generate'))!.trigger('click');
    await flushPromises();
    await buttons.find((item) => item.text().includes('tools.uuid_generator.copy_result'))!.trigger('click');

    expect(writeTextMock).toHaveBeenCalledTimes(2);
    const lastCall = writeTextMock.mock.calls[writeTextMock.mock.calls.length - 1];
    expect(lastCall[0].trim().split('\n').length).toBeGreaterThan(0);
  });

  it('清空后会重置结果和数量', async () => {
    const wrapper = mountView();
    const output = wrapper.get('textarea');
    const countInput = wrapper.get('input[type="number"]');
    const clearButton = wrapper.findAll('button').find((item) => item.text().includes('tools.uuid_generator.clear'))!;

    await countInput.setValue('20');
    await clearButton.trigger('click');

    expect((output.element as HTMLTextAreaElement).value).toBe('');
    expect((countInput.element as HTMLInputElement).value).toBe('10');
  });
});
