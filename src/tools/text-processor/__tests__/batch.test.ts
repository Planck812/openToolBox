import { describe, expect, it } from 'vitest';
import {
  batchReplace,
  columnExtract,
  lineDecorate,
  lineDedup,
  lineFilter,
  lineJoin,
  lineNumber,
  lineSplit,
} from '../batch';

describe('lineFilter', () => {
  it('keeps lines containing keyword', () => {
    expect(
      lineFilter(['foo bar', 'baz', 'bar foo'], { mode: 'keep', text: 'bar' }),
    ).toEqual(['foo bar', 'bar foo']);
  });

  it('drops lines containing keyword', () => {
    expect(
      lineFilter(['foo bar', 'baz', 'bar foo'], { mode: 'drop', text: 'bar' }),
    ).toEqual(['baz']);
  });

  it('matches regex with ignoreCase', () => {
    expect(
      lineFilter(['abc', 'xbc', 'ABC'], { mode: 'keep', text: '^a', regex: true, ignoreCase: true }),
    ).toEqual(['abc', 'ABC']);
  });

  it('throws on invalid regex', () => {
    expect(() => lineFilter(['a'], { mode: 'keep', text: '[', regex: true })).toThrow();
  });

  it('returns lines unchanged when filter text is empty', () => {
    expect(lineFilter(['a', 'b'], { mode: 'drop', text: '' })).toEqual(['a', 'b']);
  });
});

describe('batchReplace', () => {
  it('replaces literal globally by default', () => {
    expect(batchReplace(['a-b-a'], { find: 'a', replace: 'X' })).toEqual(['X-b-X']);
  });

  it('replaces literal first occurrence when global is false', () => {
    expect(batchReplace(['a-b-a'], { find: 'a', replace: 'X', global: false })).toEqual(['X-b-a']);
  });

  it('replaces with regex across the whole line', () => {
    expect(batchReplace(['abc 123 456'], { find: '\\d+', replace: 'N', regex: true })).toEqual([
      'abc N N',
    ]);
  });

  it('replaces regex per line', () => {
    expect(batchReplace(['a1', 'b2'], { find: '\\d', replace: 'X', regex: true })).toEqual([
      'aX',
      'bX',
    ]);
  });
});

describe('columnExtract', () => {
  it('extracts column by index', () => {
    expect(columnExtract(['a,b,c', 'd,e,f'], { delimiter: ',', index: 1 })).toEqual(['b', 'e']);
  });

  it('supports negative index from the right', () => {
    expect(columnExtract(['a,b,c', 'd,e,f'], { delimiter: ',', index: -1 })).toEqual(['c', 'f']);
    expect(columnExtract(['a,b,c'], { delimiter: ',', index: -2 })).toEqual(['b']);
  });

  it('returns empty string for out-of-range index', () => {
    expect(columnExtract(['a,b'], { delimiter: ',', index: 5 })).toEqual(['']);
  });

  it('skips empty lines when ignoreEmpty is true', () => {
    expect(
      columnExtract(['a,b', '', 'c,d'], { delimiter: ',', index: 0, ignoreEmpty: true }),
    ).toEqual(['a', 'c']);
  });
});

describe('lineNumber', () => {
  it('numbers lines with default start', () => {
    expect(lineNumber(['a', 'b', 'c'], {})).toEqual(['1\ta', '2\tb', '3\tc']);
  });

  it('supports start and step', () => {
    expect(lineNumber(['a', 'b'], { start: 10, step: 5 })).toEqual(['10\ta', '15\tb']);
  });

  it('pads numbers with zeros', () => {
    expect(lineNumber(['a', 'b', 'c'], { start: 1, padding: 3 })).toEqual([
      '001\ta',
      '002\tb',
      '003\tc',
    ]);
  });
});

describe('lineDecorate', () => {
  it('adds prefix and suffix to each line', () => {
    expect(lineDecorate(['a', 'b'], { prefix: '> ', suffix: ' <' })).toEqual(['> a <', '> b <']);
  });
});

describe('lineDedup', () => {
  it('keeps first occurrence order by default', () => {
    expect(lineDedup(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('trims lines before dedup when trimLine is true', () => {
    expect(lineDedup([' a ', 'a', ' b'], { trimLine: true })).toEqual(['a', 'b']);
  });

  it('ignores case for the dedup key, keeping first occurrence text', () => {
    expect(lineDedup(['Hello', 'hello', 'HELLO'], { ignoreCase: true })).toEqual(['Hello']);
  });

  it('drops empty lines when removeEmpty is true', () => {
    expect(lineDedup(['a', '', 'a'], { removeEmpty: true })).toEqual(['a']);
  });

  it('drops whitespace-only lines when removeEmpty and trimLine are both true', () => {
    expect(lineDedup(['a', '  ', 'a'], { removeEmpty: true, trimLine: true })).toEqual(['a']);
  });

  it('keeps empty lines by default', () => {
    expect(lineDedup(['a', '', 'a', ''])).toEqual(['a', '']);
  });

  it('sorts output alphabetically when sortOutput is true', () => {
    expect(lineDedup(['c', 'a', 'b', 'a'], { sortOutput: true })).toEqual(['a', 'b', 'c']);
  });

  it('keeps last occurrence order when keepOrder is false', () => {
    expect(lineDedup(['a', 'b', 'a', 'c', 'b'], { keepOrder: false })).toEqual(['a', 'c', 'b']);
  });

  it('returns empty array for empty input', () => {
    expect(lineDedup([])).toEqual([]);
  });
});

describe('lineJoin', () => {
  it('joins lines with comma by default', () => {
    expect(lineJoin(['a', 'b', 'c'])).toEqual(['a,b,c']);
  });

  it('joins with a custom delimiter', () => {
    expect(lineJoin(['a', 'b', 'c'], { delimiter: ' | ' })).toEqual(['a | b | c']);
  });

  it('trims lines before joining when trimLine is true', () => {
    expect(lineJoin([' a ', 'b'], { trimLine: true })).toEqual(['a,b']);
  });

  it('skips empty lines when removeEmpty is true', () => {
    expect(lineJoin(['a', '', 'b'], { removeEmpty: true })).toEqual(['a,b']);
  });

  it('wraps each item in quotes when quote is true', () => {
    expect(lineJoin(['a', 'b'], { quote: true })).toEqual(['"a","b"']);
  });

  it('uses the selected quote char and escapes occurrences inside items', () => {
    expect(lineJoin(["it's", 'b'], { quote: true, quoteChar: "'" })).toEqual([
      "'it\\'s','b'",
    ]);
  });

  it('returns empty string for empty input', () => {
    expect(lineJoin([])).toEqual(['']);
  });
});

describe('lineSplit', () => {
  it('splits each line by comma by default', () => {
    expect(lineSplit(['a,b,c'])).toEqual(['a', 'b', 'c']);
  });

  it('flattens multiple lines into a single column', () => {
    expect(lineSplit(['a,b', 'c,d'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('splits with a custom delimiter', () => {
    expect(lineSplit(['a | b'], { delimiter: ' | ' })).toEqual(['a', 'b']);
  });

  it('trims each part when trimParts is true', () => {
    expect(lineSplit([' a , b '], { trimParts: true })).toEqual(['a', 'b']);
  });

  it('drops empty parts when removeEmpty is true', () => {
    expect(lineSplit(['a,,b', 'c'], { removeEmpty: true })).toEqual(['a', 'b', 'c']);
  });

  it('splits into characters when delimiter is empty', () => {
    expect(lineSplit(['ab', '中'], { delimiter: '' })).toEqual(['a', 'b', '中']);
  });
});
