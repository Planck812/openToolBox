import { describe, expect, it } from 'vitest';
import { computeStats } from '../stats';

describe('computeStats', () => {
  it('counts mixed Chinese/English text correctly', () => {
    const stats = computeStats('Hello 世界\n你好 world 123');

    expect(stats.chars).toBe(21);
    expect(stats.charsNoSpace).toBe(17);
    expect(stats.words).toBe(5);
    expect(stats.lines).toBe(2);
    expect(stats.paragraphs).toBe(1);
    expect(stats.chineseChars).toBe(4);
  });

  it('handles empty string', () => {
    const stats = computeStats('');
    expect(stats.chars).toBe(0);
    expect(stats.charsNoSpace).toBe(0);
    expect(stats.words).toBe(0);
    expect(stats.lines).toBe(1);
    expect(stats.paragraphs).toBe(0);
    expect(stats.chineseChars).toBe(0);
    expect(stats.topChars).toEqual([]);
    expect(stats.longestLine).toEqual({ text: '', length: 0 });
  });

  it('counts paragraphs separated by blank lines', () => {
    expect(computeStats('a\nb').paragraphs).toBe(1);
    expect(computeStats('a\n\nb').paragraphs).toBe(2);
    expect(computeStats('a\n\n\nb').paragraphs).toBe(2);
  });

  it('computes topN character frequency in descending order', () => {
    const stats = computeStats('aabbbc', { topN: 2 });
    expect(stats.topChars).toEqual([
      { char: 'b', count: 3 },
      { char: 'a', count: 2 },
    ]);
  });

  it('ignores whitespace in character frequency', () => {
    const stats = computeStats('a a  \n', { ignoreWhitespace: true });
    expect(stats.topChars).toEqual([{ char: 'a', count: 2 }]);
  });

  it('ignores case in character frequency', () => {
    const stats = computeStats('aA', { ignoreCase: true });
    expect(stats.topChars).toEqual([{ char: 'a', count: 2 }]);
  });

  it('finds the longest line', () => {
    const stats = computeStats('aa\nbbbbb\nc');
    expect(stats.longestLine).toEqual({ text: 'bbbbb', length: 5 });
    expect(stats.lines).toBe(3);
  });
});
