import { describe, expect, it } from 'vitest';
import {
  UUID_REGEX,
  formatUuidBatch,
  generateUuidBatch,
  matchUuidToolInput,
} from '../index';

describe('generateUuidBatch 边界', () => {
  it('count 缺省或非法值收敛到 1', () => {
    expect(generateUuidBatch({ version: 'v4', count: 0 })).toHaveLength(1);
    expect(generateUuidBatch({ version: 'v4', count: -3 })).toHaveLength(1);
  });

  it('count 上限收敛到 500', () => {
    expect(generateUuidBatch({ version: 'v4', count: 501 })).toHaveLength(500);
    expect(generateUuidBatch({ version: 'v4', count: 9999 })).toHaveLength(500);
  });

  it('生成的 UUID 符合格式且保留版本位', () => {
    const batch = generateUuidBatch({ version: 'v4', count: 5 });
    expect(batch).toHaveLength(5);
    expect(batch.every((item) => UUID_REGEX.test(item))).toBe(true);
  });
});

describe('formatUuidBatch 组合', () => {
  const values = ['550e8400-e29b-41d4-a716-446655440000', '0195ea00-7f1a-7cc0-8f12-123456789abc'];

  it('空列表返回空串', () => {
    expect(formatUuidBatch([], { uppercase: false, removeHyphen: false })).toBe('');
  });

  it('仅去除连字符', () => {
    expect(formatUuidBatch(values, { uppercase: false, removeHyphen: true })).toBe([
      '550e8400e29b41d4a716446655440000',
      '0195ea007f1a7cc08f12123456789abc',
    ].join('\n'));
  });

  it('仅转大写', () => {
    expect(formatUuidBatch(values, { uppercase: true, removeHyphen: false })).toBe([
      '550E8400-E29B-41D4-A716-446655440000',
      '0195EA00-7F1A-7CC0-8F12-123456789ABC',
    ].join('\n'));
  });

  it('同时转大写与去连字符', () => {
    expect(formatUuidBatch(values, { uppercase: true, removeHyphen: true })).toBe([
      '550E8400E29B41D4A716446655440000',
      '0195EA007F1A7CC08F12123456789ABC',
    ].join('\n'));
  });
});

describe('matchUuidToolInput 边界', () => {
  const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
  const UUID_B = '0195ea00-7f1a-7cc0-8f12-123456789abc';

  it('空输入不匹配', () => {
    expect(matchUuidToolInput('')).toBeNull();
    expect(matchUuidToolInput('   ')).toBeNull();
  });

  it('无 UUID 文本不匹配', () => {
    expect(matchUuidToolInput('hello world')).toBeNull();
  });

  it('统计输入中的 UUID 数量', () => {
    const result = matchUuidToolInput(`前缀 ${UUID_A} 中间 ${UUID_B} 后缀`);

    expect(result).toEqual({ toolId: 'uuid-generator', score: 80, matchedData: { count: 2 } });
  });

  it('相同 UUID 重复出现按出现次数计数', () => {
    expect(matchUuidToolInput(`${UUID_A} ${UUID_A} ${UUID_A}`)?.matchedData).toEqual({ count: 3 });
  });
});
