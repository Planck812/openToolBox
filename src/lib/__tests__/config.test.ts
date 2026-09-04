import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONFIG_SCHEMA_VERSION,
  migrateConfig,
  safeGetJson,
  safeGetString,
  safeRemove,
  safeSetJson,
  safeSetString,
} from '@/lib/config';

describe('config 模块 safe 读写', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('safeGetString：无值时回退默认值，有值时返回值', () => {
    expect(safeGetString('a', 'fallback')).toBe('fallback');
    localStorage.setItem('a', 'value');
    expect(safeGetString('a', 'fallback')).toBe('value');
  });

  it('safeSetString：写入后可由 safeGetString 读回', () => {
    safeSetString('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(safeGetString('k', 'x')).toBe('v');
  });

  it('safeGetJson：合法 JSON 解析，null 回退默认值', () => {
    expect(safeGetJson('j', [1, 2])).toEqual([1, 2]);
    localStorage.setItem('j', JSON.stringify({ a: 1 }));
    expect(safeGetJson('j', {})).toEqual({ a: 1 });
  });

  it('safeGetJson：非法 JSON 回退默认值不抛错', () => {
    localStorage.setItem('bad', '{not json');
    expect(safeGetJson('bad', 'fb')).toBe('fb');
  });

  it('safeSetJson：写入后可由 safeGetJson 读回', () => {
    safeSetJson('obj', { list: [1, 2, 3] });
    expect(safeGetJson('obj', null)).toEqual({ list: [1, 2, 3] });
  });

  it('safeRemove：删除后读回默认值', () => {
    safeSetString('k', 'v');
    safeRemove('k');
    expect(safeGetString('k', 'd')).toBe('d');
  });

  it('migrateConfig 恒为 true，且版本常量存在', () => {
    expect(migrateConfig()).toBe(true);
    expect(CONFIG_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
