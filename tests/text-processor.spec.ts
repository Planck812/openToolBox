import { describe, expect, it } from 'vitest';
import { processText, removeEscapes, textProcessorTool } from '@/tools/text-processor';

describe('文本处理去除转义', () => {
  it('可以还原完整 JSON 字符串值中的转义内容', () => {
    const input = '"{\\"name\\":\\"Alice\\",\\"age\\":18}"';

    expect(processText(input, 'remove_escape')).toBe('{"name":"Alice","age":18}');
  });

  it('可以逐层还原多次转义后的 JSON 字符串', () => {
    const input = '"\\"{\\\\\\"a\\\\\\":{\\\\\\"b\\\\\\":1}}\\""';

    expect(processText(input, 'remove_escape')).toBe('{"a":{"b":1}}');
  });

  it('可以还原直接复制出的转义 JSON 片段', () => {
    const input = '{\\"enabled\\":true,\\"message\\":\\"hello\\nworld\\"}';

    expect(removeEscapes(input)).toBe('{"enabled":true,"message":"hello\nworld"}');
  });

  it('对已是正常 JSON 的文本保持原样返回', () => {
    const input = '{"name":"Alice","age":18}';

    expect(processText(input, 'remove_escape')).toBe(input);
  });

  it('会为带明显转义序列的内容推荐去除转义预设', () => {
    const matched = textProcessorTool.match('{\\"id\\":123,\\"status\\":\\"ok\\"}');

    const data = matched?.matchedData;
    if (data && typeof data === 'object' && 'presetType' in data) {
      expect(data.presetType).toBe('remove_escape');
    } else {
      throw new Error('expected matchedData.presetType');
    }
  });
});
