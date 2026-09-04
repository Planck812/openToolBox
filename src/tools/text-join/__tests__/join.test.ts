import { describe, expect, it } from 'vitest';
import { joinTextLines } from '../index';

const baseOptions = {
  delimiter: ',',
  defaultDelimiter: ',',
  enableQuote: false,
  quoteChar: '"' as const,
};

describe('joinTextLines', () => {
  it('按分隔符合并多行', () => {
    const result = joinTextLines('a\nb\nc', baseOptions);
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.text).toBe('a,b,c');
  });

  it('delimiter 为空时回退到 defaultDelimiter', () => {
    const result = joinTextLines('a\nb', { ...baseOptions, delimiter: '' });
    expect(result.text).toBe('a,b');
  });

  it('支持自定义前缀', () => {
    const result = joinTextLines('a\nb', { ...baseOptions, prefix: 'x' });
    expect(result.items).toEqual(['xa', 'xb']);
    expect(result.text).toBe('xa,xb');
  });

  it('enableQuote 时用双引号包裹并转义内部引号', () => {
    const result = joinTextLines('a\nhe"llo', { ...baseOptions, enableQuote: true });
    expect(result.text).toBe('"a","he\\"llo"');
  });

  it('enableQuote 时支持单引号 quoteChar', () => {
    const result = joinTextLines('a\nb', {
      ...baseOptions,
      enableQuote: true,
      quoteChar: "'",
    });
    expect(result.text).toBe("'a','b'");
  });

  it('跳过空行', () => {
    const result = joinTextLines('a\n\nb', baseOptions);
    expect(result.items).toEqual(['a', 'b']);
  });

  it('空输入返回空结果', () => {
    const result = joinTextLines('  ', baseOptions);
    expect(result.items).toEqual([]);
    expect(result.text).toBe('');
  });
});
