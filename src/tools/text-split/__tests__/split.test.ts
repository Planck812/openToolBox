import { describe, expect, it } from 'vitest';
import { splitTextToList } from '../index';

const baseOptions = { delimiter: ',', defaultDelimiter: ',' };

describe('splitTextToList', () => {
  it('按逗号拆分为单列', () => {
    const result = splitTextToList('a,b,c', baseOptions);
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.text).toBe('a\nb\nc');
  });

  it('支持分号分隔', () => {
    const result = splitTextToList('a;b;c', { delimiter: ';', defaultDelimiter: ';' });
    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('空格分隔时按任意连续空白拆分', () => {
    const result = splitTextToList('a b  c', { delimiter: ' ', defaultDelimiter: ' ' });
    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('多行各自拆分并扁平合并', () => {
    const result = splitTextToList('a,b\nc,d', baseOptions);
    expect(result.items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('trim 每个片段并过滤空片段', () => {
    const result = splitTextToList(' a ,  b,,c ', baseOptions);
    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('跳过空行', () => {
    const result = splitTextToList('a\n\nb', baseOptions);
    expect(result.items).toEqual(['a', 'b']);
  });

  it('delimiter 为空时回退到 defaultDelimiter', () => {
    const result = splitTextToList('a,b', { delimiter: '', defaultDelimiter: ',' });
    expect(result.items).toEqual(['a', 'b']);
  });

  it('空输入返回空结果', () => {
    const result = splitTextToList('  ', baseOptions);
    expect(result.items).toEqual([]);
    expect(result.text).toBe('');
  });
});
