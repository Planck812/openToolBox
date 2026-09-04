import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JsonDiff from '@/tools/json-diff/JsonDiff.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

describe('JSON 对比页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('支持通过 initialData 一次性填充左右两侧 JSON', async () => {
    const wrapper = mount(JsonDiff, {
      props: {
        initialData: '{\n  "a": 1\n}\n---\n{\n  "a": 2\n}',
      },
    });

    const textareas = wrapper.findAll('textarea');
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain('"a": 1');
    expect((textareas[1].element as HTMLTextAreaElement).value).toContain('"a": 2');
  });

  it('相同 JSON 对比后显示一致结论', async () => {
    const wrapper = mount(JsonDiff);
    const textareas = wrapper.findAll('textarea');

    await textareas[0].setValue('{"a":1}');
    await textareas[1].setValue('{"a":1}');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.json_diff.compare_btn'))!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('tools.json_diff.overall_title');
    expect(wrapper.text()).toContain('tools.json_diff.overall_identical');
  });

  it('差异 JSON 对比后展示字段路径与变更类型', async () => {
    const wrapper = mount(JsonDiff);
    const textareas = wrapper.findAll('textarea');

    await textareas[0].setValue('{"user":{"name":"old"}}');
    await textareas[1].setValue('{"user":{"name":"new"}}');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.json_diff.compare_btn'))!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('/user/name');
    expect(wrapper.text()).toContain('VALUE_MISMATCH');
  });

  it('非法 JSON 会展示解析错误', async () => {
    const wrapper = mount(JsonDiff);
    const textareas = wrapper.findAll('textarea');

    await textareas[0].setValue('{');
    await textareas[1].setValue('{}');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.json_diff.compare_btn'))!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toMatch(/Expected property name|Unexpected end of JSON input/);
  });

  it('复制结果 JSON 时会写入剪贴板', async () => {
    const wrapper = mount(JsonDiff);
    const textareas = wrapper.findAll('textarea');

    await textareas[0].setValue('{"a":1}');
    await textareas[1].setValue('{"a":2}');
    await wrapper.findAll('button').find((item) => item.text().includes('tools.json_diff.compare_btn'))!.trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((item) => item.text().includes('tools.json_diff.copy_result_json'))!.trigger('click');

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0][0]).toContain('"overall"');
    expect(writeTextMock.mock.calls[0][0]).toContain('"diffs"');
  });
});
