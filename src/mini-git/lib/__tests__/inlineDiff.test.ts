import { describe, it, expect } from 'vitest';
import { computeInlineDiff } from '../inlineDiff';

describe('inlineDiff computeInlineDiff', () => {
  it('returns empty highlights for identical strings', () => {
    const result = computeInlineDiff('const x = 1;', 'const x = 1;');
    expect(result.oldHighlights).toEqual([]);
    expect(result.newHighlights).toEqual([]);
  });

  it('detects changed tokens within a code line', () => {
    const oldStr = 'const userCount = 10;';
    const newStr = 'const userCount = 20;';
    const result = computeInlineDiff(oldStr, newStr);

    expect(result.oldHighlights.length).toBe(1);
    const oldChunk = oldStr.slice(result.oldHighlights[0].start, result.oldHighlights[0].end);
    expect(oldChunk).toBe('10');

    expect(result.newHighlights.length).toBe(1);
    const newChunk = newStr.slice(result.newHighlights[0].start, result.newHighlights[0].end);
    expect(newChunk).toBe('20');
  });

  it('handles empty old or new strings', () => {
    const res1 = computeInlineDiff('', 'hello world');
    expect(res1.oldHighlights).toEqual([]);
    expect(res1.newHighlights).toEqual([{ start: 0, end: 11 }]);

    const res2 = computeInlineDiff('goodbye', '');
    expect(res2.oldHighlights).toEqual([{ start: 0, end: 7 }]);
    expect(res2.newHighlights).toEqual([]);
  });

  it('skips computation if either string exceeds 10,000 characters', () => {
    const longOld = 'a'.repeat(10001);
    const normalNew = 'abc';
    const result = computeInlineDiff(longOld, normalNew);
    expect(result.oldHighlights).toEqual([]);
    expect(result.newHighlights).toEqual([]);
  });

  it('correctly highlights insertion within a line', () => {
    const oldStr = 'function test() {}';
    const newStr = 'function test(param: string) {}';
    const result = computeInlineDiff(oldStr, newStr);

    expect(result.oldHighlights).toEqual([]);
    expect(result.newHighlights.length).toBe(1);
    const addedChunk = newStr.slice(result.newHighlights[0].start, result.newHighlights[0].end);
    expect(addedChunk).toBe('param: string');
  });
});
