import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  buildCharsetPools,
  estimatePasswordStrength,
  generatePassword,
  normalizePasswordGeneratorOptions,
} from '../password-generator';

const AMBIGUOUS = /[0OoIl1]/;

describe('normalizePasswordGeneratorOptions', () => {
  it('使用默认选项：长度 16 且四类字符均启用', () => {
    const options = normalizePasswordGeneratorOptions();
    expect(options.length).toBe(16);
    expect(options.useUpper).toBe(true);
    expect(options.useLower).toBe(true);
    expect(options.useDigits).toBe(true);
    expect(options.useSymbols).toBe(true);
    expect(options.excludeAmbiguous).toBe(false);
  });

  it('字符类全为 false 时抛错', () => {
    expect(() =>
      normalizePasswordGeneratorOptions({
        useUpper: false,
        useLower: false,
        useDigits: false,
        useSymbols: false,
      }),
    ).toThrow(/at least one character class/i);
  });

  it('长度越界时抛错', () => {
    expect(() => normalizePasswordGeneratorOptions({ length: 7 })).toThrow(/between/);
    expect(() => normalizePasswordGeneratorOptions({ length: 129 })).toThrow(/between/);
  });
});

describe('generatePassword', () => {
  it('生成指定长度的密码', () => {
    for (const length of [MIN_PASSWORD_LENGTH, 16, 32, MAX_PASSWORD_LENGTH]) {
      const password = generatePassword({ length });
      expect(password).toHaveLength(length);
    }
  });

  it('仅大写时全部落在大写字母集合', () => {
    const password = generatePassword({
      length: 24,
      useUpper: true,
      useLower: false,
      useDigits: false,
      useSymbols: false,
    });
    expect(password).toMatch(/^[A-Z]+$/);
  });

  it('仅数字时全部落在数字集合', () => {
    const password = generatePassword({
      length: 20,
      useUpper: false,
      useLower: false,
      useDigits: true,
      useSymbols: false,
    });
    expect(password).toMatch(/^\d+$/);
  });

  it('启用多类字符时各类至少出现一次', () => {
    const password = generatePassword({
      length: 16,
      useUpper: true,
      useLower: true,
      useDigits: true,
      useSymbols: true,
    });
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it('excludeAmbiguous 排除 0OIl1 等歧义字符', () => {
    for (let i = 0; i < 20; i += 1) {
      const password = generatePassword({
        length: 32,
        useUpper: true,
        useLower: true,
        useDigits: true,
        useSymbols: false,
        excludeAmbiguous: true,
      });
      expect(password).not.toMatch(AMBIGUOUS);
    }
  });

  it('至少一种字符类存在时不抛错', () => {
    expect(() =>
      generatePassword({
        useUpper: true,
        useLower: false,
        useDigits: false,
        useSymbols: false,
      }),
    ).not.toThrow();
    expect(() =>
      generatePassword({
        useUpper: false,
        useLower: true,
        useDigits: false,
        useSymbols: false,
      }),
    ).not.toThrow();
    expect(() =>
      generatePassword({
        useUpper: false,
        useLower: false,
        useDigits: true,
        useSymbols: false,
      }),
    ).not.toThrow();
    expect(() =>
      generatePassword({
        useUpper: false,
        useLower: false,
        useDigits: false,
        useSymbols: true,
      }),
    ).not.toThrow();
  });

  it('非法选项（全 false）抛错', () => {
    expect(() =>
      generatePassword({
        useUpper: false,
        useLower: false,
        useDigits: false,
        useSymbols: false,
      }),
    ).toThrow();
  });
});

describe('buildCharsetPools', () => {
  it('排除歧义后数字池不含 0 与 1', () => {
    const pools = buildCharsetPools({
      useUpper: false,
      useLower: false,
      useDigits: true,
      useSymbols: false,
      excludeAmbiguous: true,
    });
    expect(pools).toHaveLength(1);
    expect(pools[0]).not.toMatch(/[01]/);
    expect(pools[0]).toMatch(/[2-9]/);
  });
});

describe('estimatePasswordStrength', () => {
  it('空串与过短密码为 weak', () => {
    expect(estimatePasswordStrength('')).toBe('weak');
    expect(estimatePasswordStrength('abc')).toBe('weak');
    expect(estimatePasswordStrength('aaaaaaaa')).toBe('weak');
  });

  it('较长且多样的密码为 good 或 strong', () => {
    const fairOrBetter = generatePassword({
      length: 12,
      useUpper: true,
      useLower: true,
      useDigits: true,
      useSymbols: false,
    });
    expect(['fair', 'good', 'strong']).toContain(estimatePasswordStrength(fairOrBetter));

    const strong = generatePassword({
      length: 24,
      useUpper: true,
      useLower: true,
      useDigits: true,
      useSymbols: true,
    });
    expect(estimatePasswordStrength(strong)).toBe('strong');
  });
});
