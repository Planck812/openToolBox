import { describe, expect, it } from 'vitest';
import { UUID_REGEX, formatUuidBatch, generateUuidBatch, matchUuidToolInput } from '@/tools/uuid-generator';

describe('uuid generator helpers', () => {
  it('formats uuid list with uppercase and no hyphen options', () => {
    const result = formatUuidBatch([
      '550e8400-e29b-41d4-a716-446655440000',
      '0195ea00-7f1a-7cc0-8f12-123456789abc',
    ], {
      uppercase: true,
      removeHyphen: true,
    });

    expect(result).toBe([
      '550E8400E29B41D4A716446655440000',
      '0195EA007F1A7CC08F12123456789ABC',
    ].join('\n'));
  });

  it('generates requested count for v1, v4 and v7', () => {
    const v1Batch = generateUuidBatch({ version: 'v1', count: 3 });
    const v4Batch = generateUuidBatch({ version: 'v4', count: 2 });
    const v7Batch = generateUuidBatch({ version: 'v7', count: 4 });

    expect(v1Batch).toHaveLength(3);
    expect(v4Batch).toHaveLength(2);
    expect(v7Batch).toHaveLength(4);

    expect(v1Batch.every((item) => UUID_REGEX.test(item) && item[14] === '1')).toBe(true);
    expect(v4Batch.every((item) => UUID_REGEX.test(item) && item[14] === '4')).toBe(true);
    expect(v7Batch.every((item) => UUID_REGEX.test(item) && item[14] === '7')).toBe(true);
  });

  it('matches existing uuid text for quick tool recommendation', () => {
    const matched = matchUuidToolInput('550e8400-e29b-41d4-a716-446655440000');
    const notMatched = matchUuidToolInput('hello world');

    expect(matched).toEqual({
      toolId: 'uuid-generator',
      score: 80,
      matchedData: {
        count: 1,
      },
    });
    expect(notMatched).toBeNull();
  });
});
