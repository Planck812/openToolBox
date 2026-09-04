export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordGeneratorOptions {
  /** 密码长度，默认 16，有效范围 8–128 */
  length?: number;
  useUpper?: boolean;
  useLower?: boolean;
  useDigits?: boolean;
  useSymbols?: boolean;
  /** 排除易混淆字符：0 O o I l 1 等 */
  excludeAmbiguous?: boolean;
}

export const DEFAULT_PASSWORD_LENGTH = 16;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
/** 常见歧义字符：0/O/o、1/I/l */
const AMBIGUOUS_CHARS = new Set(['0', 'O', 'o', 'I', 'l', '1']);

const DEFAULT_OPTIONS: Required<PasswordGeneratorOptions> = {
  length: DEFAULT_PASSWORD_LENGTH,
  useUpper: true,
  useLower: true,
  useDigits: true,
  useSymbols: true,
  excludeAmbiguous: false,
};

/**
 * 从字符池中剔除歧义字符。
 */
const filterAmbiguous = (chars: string, excludeAmbiguous: boolean): string => {
  if (!excludeAmbiguous) {
    return chars;
  }
  return [...chars].filter((ch) => !AMBIGUOUS_CHARS.has(ch)).join('');
};

/**
 * 根据选项构建各字符类池（已应用歧义过滤）。
 */
export const buildCharsetPools = (
  options: Required<Pick<PasswordGeneratorOptions, 'useUpper' | 'useLower' | 'useDigits' | 'useSymbols' | 'excludeAmbiguous'>>,
): string[] => {
  const pools: string[] = [];
  if (options.useUpper) {
    const pool = filterAmbiguous(UPPER, options.excludeAmbiguous);
    if (pool.length > 0) {
      pools.push(pool);
    }
  }
  if (options.useLower) {
    const pool = filterAmbiguous(LOWER, options.excludeAmbiguous);
    if (pool.length > 0) {
      pools.push(pool);
    }
  }
  if (options.useDigits) {
    const pool = filterAmbiguous(DIGITS, options.excludeAmbiguous);
    if (pool.length > 0) {
      pools.push(pool);
    }
  }
  if (options.useSymbols) {
    const pool = filterAmbiguous(SYMBOLS, options.excludeAmbiguous);
    if (pool.length > 0) {
      pools.push(pool);
    }
  }
  return pools;
};

/**
 * 规范化并校验生成选项，非法选项抛出 Error。
 */
export const normalizePasswordGeneratorOptions = (
  options: PasswordGeneratorOptions = {},
): Required<PasswordGeneratorOptions> => {
  const merged: Required<PasswordGeneratorOptions> = {
    length: options.length ?? DEFAULT_OPTIONS.length,
    useUpper: options.useUpper ?? DEFAULT_OPTIONS.useUpper,
    useLower: options.useLower ?? DEFAULT_OPTIONS.useLower,
    useDigits: options.useDigits ?? DEFAULT_OPTIONS.useDigits,
    useSymbols: options.useSymbols ?? DEFAULT_OPTIONS.useSymbols,
    excludeAmbiguous: options.excludeAmbiguous ?? DEFAULT_OPTIONS.excludeAmbiguous,
  };

  if (!Number.isFinite(merged.length)) {
    throw new Error('password length must be a finite number');
  }

  const length = Math.round(merged.length);
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new Error(`password length must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}`);
  }
  merged.length = length;

  if (!merged.useUpper && !merged.useLower && !merged.useDigits && !merged.useSymbols) {
    throw new Error('at least one character class must be enabled');
  }

  const pools = buildCharsetPools(merged);
  if (pools.length === 0) {
    throw new Error('character pool is empty after applying options');
  }

  return merged;
};

/**
 * 使用 crypto.getRandomValues 在 [0, max) 上均匀取样（拒绝采样避免模偏差）。
 */
const randomInt = (max: number): number => {
  if (max <= 0) {
    throw new Error('max must be positive');
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available');
  }

  const limit = 0x100000000;
  const threshold = limit - (limit % max);
  const buffer = new Uint32Array(1);

  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < threshold) {
      return value % max;
    }
  }
};

/**
 * Fisher–Yates 洗牌。
 */
const shuffle = (chars: string[]): string[] => {
  const result = [...chars];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/**
 * 按选项生成随机密码（保证每个启用字符类至少出现一次，条件允许时）。
 */
export const generatePassword = (options: PasswordGeneratorOptions = {}): string => {
  const normalized = normalizePasswordGeneratorOptions(options);
  const pools = buildCharsetPools(normalized);
  const combined = pools.join('');

  if (combined.length === 0) {
    throw new Error('character pool is empty after applying options');
  }

  const chars: string[] = [];

  // 每个启用字符类先取一个，确保覆盖
  for (const pool of pools) {
    if (chars.length >= normalized.length) {
      break;
    }
    chars.push(pool[randomInt(pool.length)]);
  }

  while (chars.length < normalized.length) {
    chars.push(combined[randomInt(combined.length)]);
  }

  return shuffle(chars).join('');
};

/**
 * 估算密码强度：综合长度与字符类别多样性。
 */
export const estimatePasswordStrength = (password: string): PasswordStrength => {
  if (!password) {
    return 'weak';
  }

  const length = password.length;
  let classes = 0;
  if (/[A-Z]/.test(password)) {
    classes += 1;
  }
  if (/[a-z]/.test(password)) {
    classes += 1;
  }
  if (/\d/.test(password)) {
    classes += 1;
  }
  if (/[^A-Za-z0-9]/.test(password)) {
    classes += 1;
  }

  // 粗略熵：log2(charset^length) ≈ length * log2(avgCharset)
  // 用类别数近似 charset 大小
  const approxCharset = [0, 26, 52, 62, 90][classes] ?? 90;
  const entropy = length * Math.log2(Math.max(approxCharset, 2));

  if (length < 8 || entropy < 36 || classes <= 1) {
    return 'weak';
  }
  if (length < 12 || entropy < 50 || classes < 3) {
    return 'fair';
  }
  if (length < 16 || entropy < 70 || classes < 4) {
    return 'good';
  }
  return 'strong';
};
