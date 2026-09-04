import { describe, expect, it } from 'vitest';
import { dedupLines } from '../index';

describe('dedupLines', () => {
  it('keepOrder 下保留首次出现并去重', () => {
    const result = dedupLines('a\nb\na\nc', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.total).toBe(4);
    expect(result.removed).toBe(1);
  });

  it('ignoreCase 时忽略大小写去重', () => {
    const result = dedupLines('Apple\napple\nBANANA', {
      trimLine: false,
      ignoreCase: true,
      removeEmpty: false,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual(['Apple', 'BANANA']);
    expect(result.removed).toBe(1);
  });

  it('trimLine 时先去除行首尾空白再比较', () => {
    const result = dedupLines(' a \n a\nb', {
      trimLine: true,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual(['a', 'b']);
  });

  it('removeEmpty 时跳过空行', () => {
    const result = dedupLines('a\n\n\nb', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: true,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual(['a', 'b']);
  });

  it('sortOutput 时按字典序输出', () => {
    const result = dedupLines('b\na\nc', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: true,
      keepOrder: true,
    });
    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('keepOrder=false 时保留最后一次出现的顺序', () => {
    const result = dedupLines('a\nb\na', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: false,
      keepOrder: false,
    });
    expect(result.items).toEqual(['b', 'a']);
  });

  it('keepOrder=false 且 sortOutput=true 时仍按字典序排序', () => {
    const result = dedupLines('b\na\nb', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: true,
      keepOrder: false,
    });
    expect(result.items).toEqual(['a', 'b']);
  });

  it('CRLF 换行会被归一化为 LF', () => {
    const result = dedupLines('a\r\nb\r\na', {
      trimLine: false,
      ignoreCase: false,
      removeEmpty: false,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual(['a', 'b']);
    expect(result.total).toBe(3);
  });

  it('空字符串输入按一个空行统计', () => {
    // '' split('\n') 得到 ['']，removeEmpty 移除后 items 为空，removed 计 1。
    const result = dedupLines('', {
      trimLine: true,
      ignoreCase: false,
      removeEmpty: true,
      sortOutput: false,
      keepOrder: true,
    });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
  });
});
