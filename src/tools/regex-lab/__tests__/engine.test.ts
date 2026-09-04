import { describe, expect, it } from 'vitest';
import {
  compileRegex,
  findMatches,
  normalizeFlags,
  parseRegexLiteral,
  replacePreview,
} from '../engine';
import { matchRegexLabInput } from '../index';

describe('regex-lab engine', () => {
  it('normalizes flags: unique + ordered + filters invalid', () => {
    expect(normalizeFlags('igigx')).toBe('gi');
    expect(normalizeFlags(['y', 'u', 'm', 'm'])).toBe('muy');
    expect(normalizeFlags('')).toBe('');
  });

  it('compiles valid regex and reports invalid patterns', () => {
    const ok = compileRegex('\\d+', 'gi');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.regex.source).toBe('\\d+');
      expect(ok.flags).toBe('gi');
    }

    const empty = compileRegex('', 'g');
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error).toBe('tools.regex_lab.empty_pattern');
    }

    const bad = compileRegex('(', 'g');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.length).toBeGreaterThan(0);
    }
  });

  it('finds matches with index, capture groups and named groups', () => {
    const result = findMatches('(?<word>\\w+)', 'g', 'hi there');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      index: 0,
      match: 'hi',
      groups: ['hi'],
      namedGroups: { word: 'hi' },
    });
    expect(result.matches[1]).toMatchObject({
      index: 3,
      match: 'there',
      groups: ['there'],
      namedGroups: { word: 'there' },
    });
  });

  it('finds all matches even when original flags omit g', () => {
    const result = findMatches('\\d+', '', 'a1b22c3');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.matches.map((item) => item.match)).toEqual(['1', '22', '3']);
    expect(result.flags).toBe('');
  });

  it('returns empty list when no match', () => {
    const result = findMatches('foo', 'g', 'bar');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toEqual([]);
    }
  });

  it('replacePreview respects global vs non-global flags', () => {
    const once = replacePreview('\\d+', '', 'a1b2', '#');
    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(once.result).toBe('a#b2');
    }

    const all = replacePreview('\\d+', 'g', 'a1b2', '#');
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.result).toBe('a#b#');
    }
  });

  it('replacePreview supports capture backreferences', () => {
    const result = replacePreview('(\\w+)@(\\w+)', 'g', 'a@b c@d', '$2/$1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('b/a d/c');
    }
  });

  it('replacePreview fails on invalid pattern', () => {
    const result = replacePreview('[', 'g', 'text', 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.result).toBe('');
    }
  });

  it('parses /pattern/flags literals with escaped slashes', () => {
    expect(parseRegexLiteral('/foo/gi')).toEqual({ pattern: 'foo', flags: 'gi' });
    expect(parseRegexLiteral('/a\\/b/m')).toEqual({ pattern: 'a\\/b', flags: 'm' });
    expect(parseRegexLiteral('foo')).toBeNull();
    expect(parseRegexLiteral('/open')).toBeNull();
    expect(parseRegexLiteral('/x/gix')).toBeNull();
  });
});

describe('regex-lab match()', () => {
  it('matches slash literals and keywords', () => {
    expect(matchRegexLabInput('/\\d+/g')).toEqual({
      toolId: 'regex-lab',
      score: 92,
      matchedData: { pattern: '\\d+', flags: 'g' },
    });

    expect(matchRegexLabInput('regex tester')).toEqual({
      toolId: 'regex-lab',
      score: 80,
    });

    expect(matchRegexLabInput('写一个正则')).toEqual({
      toolId: 'regex-lab',
      score: 80,
    });

    expect(matchRegexLabInput('hello world')).toBeNull();
    expect(matchRegexLabInput('')).toBeNull();
  });
});
