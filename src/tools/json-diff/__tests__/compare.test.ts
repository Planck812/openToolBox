import { describe, expect, it } from 'vitest';
import { compareJson, escapeJsonPointer } from '../index';

describe('escapeJsonPointer', () => {
  it('转义 ~ 和 /', () => {
    expect(escapeJsonPointer('a/b~c')).toBe('a~1b~0c');
    expect(escapeJsonPointer('plain')).toBe('plain');
  });
});

describe('compareJson', () => {
  it('相同对象判定为一致', () => {
    const result = compareJson({ a: 1, b: 'x' }, { a: 1, b: 'x' });
    expect(result.overall).toBe('identical');
    expect(result.diffs).toHaveLength(0);
    expect(result.summary).toMatchObject({
      added: 0,
      removed: 0,
      changed: 0,
      typeMismatch: 0,
    });
  });

  it('值变化记为 VALUE_MISMATCH 并计入 changed', () => {
    const result = compareJson({ a: 1 }, { a: 2 });
    expect(result.overall).toBe('partial');
    expect(result.summary.changed).toBe(1);
    expect(result.diffs[0].path).toBe('/a');
    expect(result.diffs[0].diffType).toBe('VALUE_MISMATCH');
    expect(result.diffs[0].oldValue).toBe(1);
    expect(result.diffs[0].newValue).toBe(2);
  });

  it('B 新增字段记为 EXTRA_IN_B 并计入 added', () => {
    const result = compareJson({ a: 1 }, { a: 1, b: 2 });
    expect(result.overall).toBe('partial');
    expect(result.summary.added).toBe(1);
    expect(result.diffs[0].diffType).toBe('EXTRA_IN_B');
  });

  it('B 删除字段记为 MISSING_IN_B 并计入 removed', () => {
    const result = compareJson({ a: 1, b: 2 }, { a: 1 });
    expect(result.overall).toBe('partial');
    expect(result.summary.removed).toBe(1);
    expect(result.diffs[0].diffType).toBe('MISSING_IN_B');
  });

  it('类型不一致记为 TYPE_MISMATCH', () => {
    const result = compareJson({ a: 1 }, { a: '1' });
    expect(result.summary.typeMismatch).toBe(1);
    expect(result.diffs[0].diffType).toBe('TYPE_MISMATCH');
  });

  it('numericStringAsNumber 时数字与数字字符串按数值比较', () => {
    const result = compareJson(
      { a: 1 },
      { a: '1.0' },
      { numericStringAsNumber: true },
    );
    expect(result.overall).toBe('identical');
    expect(result.diffs).toHaveLength(0);
  });

  it('numericStringAsNumber 时数值不等仍标记差异', () => {
    const result = compareJson(
      { a: 1 },
      { a: '2' },
      { numericStringAsNumber: true },
    );
    expect(result.overall).toBe('partial');
    expect(result.summary.changed).toBe(1);
    expect(result.diffs[0].diffType).toBe('VALUE_MISMATCH');
  });

  it('不开启 numericStringAsNumber 时数字与字符串仍判类型不匹配', () => {
    const result = compareJson({ a: 1 }, { a: '1.0' });
    expect(result.diffs[0].diffType).toBe('TYPE_MISMATCH');
  });

  it('ignorePaths 忽略指定路径', () => {
    const result = compareJson(
      { a: 1, secret: 'x' },
      { a: 2, secret: 'y' },
      { ignorePaths: ['/secret'] },
    );
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].path).toBe('/a');
  });

  it('数组长度不同在 INDEX 策略下标记', () => {
    const result = compareJson({ arr: [1, 2] }, { arr: [1, 2, 3] });
    expect(result.overall).toBe('partial');
    expect(result.summary.arrayIssues).toBeGreaterThan(0);
    const types = result.diffs.map((d) => d.diffType);
    expect(types).toContain('ARRAY_LENGTH_MISMATCH');
  });

  it('数组 SET 策略比较集合', () => {
    const result = compareJson(
      { arr: [1, 2, 3] },
      { arr: [3, 2, 1] },
      { arrayStrategy: 'SET' },
    );
    expect(result.overall).toBe('identical');
  });

  it('深层嵌套路径可定位', () => {
    const result = compareJson({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(result.diffs[0].path).toBe('/a/b/c');
  });

  it('异常输入（循环引用）不会崩溃而是返回 ERROR diff', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = compareJson(cyclic, { a: 1 });
    expect(result.overall).toBe('different');
    expect(result.summary.errors).toBeGreaterThan(0);
  });
});
