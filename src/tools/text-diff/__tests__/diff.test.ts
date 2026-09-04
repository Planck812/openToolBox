import { describe, expect, it } from 'vitest';
import { buildTextDiff, type DiffLine } from '../diff';
import { textDiffTool } from '../index';

const getTypes = (lines: DiffLine[]) => lines.map((line) => line.type);

describe('buildTextDiff', () => {
  it('相同文本返回 equal 行', () => {
    const lines = buildTextDiff('alpha\nbeta', 'alpha\nbeta');
    expect(getTypes(lines)).toEqual(['equal', 'equal']);
    expect(lines[0]).toMatchObject({
      leftLineNumber: 1,
      rightLineNumber: 1,
      leftText: 'alpha',
      rightText: 'alpha',
      leftPlaceholder: false,
      rightPlaceholder: false,
    });
  });

  it('能识别新增与删除行', () => {
    const added = buildTextDiff('alpha', 'alpha\nbeta');
    expect(getTypes(added)).toEqual(['equal', 'add']);
    expect(added[1]).toMatchObject({
      type: 'add',
      leftLineNumber: null,
      rightLineNumber: 2,
      rightText: 'beta',
      leftPlaceholder: true,
      rightPlaceholder: false,
    });

    const removed = buildTextDiff('alpha\nbeta', 'alpha');
    expect(getTypes(removed)).toEqual(['equal', 'remove']);
    expect(removed[1]).toMatchObject({
      type: 'remove',
      leftLineNumber: 2,
      rightLineNumber: null,
      leftText: 'beta',
      leftPlaceholder: false,
      rightPlaceholder: true,
    });
  });

  it('能将相邻删除与新增折算为 modify，并生成词级高亮', () => {
    const lines = buildTextDiff('hello world', 'hello brave world');
    expect(getTypes(lines)).toEqual(['modify']);
    expect(lines[0]).toMatchObject({
      type: 'modify',
      leftPlaceholder: false,
      rightPlaceholder: false,
    });
    expect(lines[0].leftTokens).toEqual([
      { text: 'hello', type: 'equal' },
      { text: ' ', type: 'equal' },
      { text: 'world', type: 'equal' },
    ]);
    expect(lines[0].rightTokens).toEqual([
      { text: 'hello', type: 'equal' },
      { text: ' ', type: 'equal' },
      { text: 'brave', type: 'add' },
      { text: ' ', type: 'add' },
      { text: 'world', type: 'equal' },
    ]);
  });

  it('单侧为空时应保留 add/remove，而不是误折叠为 modify', () => {
    expect(buildTextDiff('', 'a')).toMatchObject([
      { type: 'add', leftPlaceholder: true, rightPlaceholder: false, rightText: 'a' },
    ]);
    expect(buildTextDiff('a', '')).toMatchObject([
      { type: 'remove', leftPlaceholder: false, rightPlaceholder: true, leftText: 'a' },
    ]);
  });

  it('等长多行替换时应逐行配对为连续 modify', () => {
    const lines = buildTextDiff('a\nb', 'x\ny');
    expect(lines.map((line) => line.type)).toEqual(['modify', 'modify']);
    expect(lines[0]).toMatchObject({ leftLineNumber: 1, rightLineNumber: 1 });
    expect(lines[1]).toMatchObject({ leftLineNumber: 2, rightLineNumber: 2 });
  });

  it('忽略空白时仅比较规范化值，但保留原始展示文本', () => {
    const lines = buildTextDiff('Alpha  Beta', 'Alpha Beta', { ignoreWhitespace: true });
    expect(getTypes(lines)).toEqual(['equal']);
    expect(lines[0]).toMatchObject({ leftText: 'Alpha  Beta', rightText: 'Alpha Beta' });
  });

  it('忽略大小写时按小写比较，但保留原文', () => {
    const lines = buildTextDiff('Hello', 'hello', { ignoreCase: true });
    expect(getTypes(lines)).toEqual(['equal']);
    expect(lines[0]).toMatchObject({ leftText: 'Hello', rightText: 'hello' });
  });
});

describe('textDiffTool.match', () => {
  it('对多行文本给出文本对比推荐', () => {
    expect(textDiffTool.match('line-1\nline-2')).toEqual({
      toolId: 'text-diff',
      score: 72,
      matchedData: { lines: 2 },
    });
  });

  it('单行短文本不主动匹配', () => {
    expect(textDiffTool.match('hello')).toBeNull();
  });
});

