import { describe, expect, it } from 'vitest';
import { timestampTool } from '../index';

describe('timestampTool matcher', () => {
  it('10 位秒级时间戳返回满分并携带原文', () => {
    const result = timestampTool.match('1704067200');

    expect(result).toEqual({ toolId: 'timestamp', score: 100, matchedData: '1704067200' });
  });

  it('13 位毫秒级时间戳返回满分', () => {
    const result = timestampTool.match('1775044800000');

    expect(result?.score).toBe(100);
    expect(result?.matchedData).toBe('1775044800000');
  });

  it('输入带首尾空白时先去除再匹配', () => {
    expect(timestampTool.match('  1704067200  ')?.score).toBe(100);
  });

  it('位数不符不匹配', () => {
    expect(timestampTool.match('123456789')).toBeNull();
    expect(timestampTool.match('12345678901')).toBeNull();
    expect(timestampTool.match('123456789012')).toBeNull();
    expect(timestampTool.match('12345678901234')).toBeNull();
  });

  it('日期字符串与普通文本不匹配', () => {
    expect(timestampTool.match('2024-01-01')).toBeNull();
    expect(timestampTool.match('hello')).toBeNull();
    expect(timestampTool.match('')).toBeNull();
    expect(timestampTool.match('   ')).toBeNull();
  });
});
