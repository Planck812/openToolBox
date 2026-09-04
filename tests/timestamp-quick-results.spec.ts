import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { describe, expect, it } from 'vitest';
import {
  getDefaultTimestampQuickResultIndex,
  getTimestampQuickResults,
} from '@/tools/timestamp/quick-results';

dayjs.extend(customParseFormat);

const expectFixedResults = (date: dayjs.Dayjs, results: string[]) => {
  expect(results).toHaveLength(4);
  expect(results[0]).toBe(date.unix().toString());
  expect(results[1]).toBe(date.valueOf().toString());
  expect(results[2]).toBe(date.format('YYYY-MM-DD'));
  expect(results[3]).toBe(date.format('YYYYMMDD'));
};

describe('timestamp quick results helper', () => {
  it('covers 10-digit second timestamps', () => {
    const input = '1672531200';
    const expectedDate = dayjs.unix(Number(input));

    const results = getTimestampQuickResults(input);

    expectFixedResults(expectedDate, results);
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(1);
  });

  it('covers 13-digit millisecond timestamps', () => {
    const input = '1672531200000';
    const expectedDate = dayjs(Number(input));

    const results = getTimestampQuickResults(input);

    expectFixedResults(expectedDate, results);
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(0);
  });

  it('covers yyyy-MM-dd date strings', () => {
    const input = '2024-03-15';
    const expectedDate = dayjs(input, 'YYYY-MM-DD', true).startOf('day');

    const results = getTimestampQuickResults(input);

    expectFixedResults(expectedDate, results);
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(0);
  });

  it('covers yyyyMMdd date strings', () => {
    const input = '20240315';
    const expectedDate = dayjs(input, 'YYYYMMDD', true).startOf('day');

    const results = getTimestampQuickResults(input);

    expectFixedResults(expectedDate, results);
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(0);
  });

  it('returns empty list for unsupported input', () => {
    const results = getTimestampQuickResults('not a timestamp');
    expect(results).toEqual([]);
    expect(getDefaultTimestampQuickResultIndex('not a timestamp', results)).toBe(0);
  });

  it('treats empty results as an explicit index-0 contract', () => {
    expect(getDefaultTimestampQuickResultIndex('1672531200', [])).toBe(0);
  });

  it('picks the first non-matching result by default', () => {
    const input = 'match';
    const results = ['match', 'match', 'other', 'match'];
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(2);
  });

  it('uses trimmed input when selecting the default result', () => {
    const input = '  match  ';
    const results = ['match', 'match', 'other', 'match'];
    expect(getDefaultTimestampQuickResultIndex(input, results)).toBe(2);
  });
});
