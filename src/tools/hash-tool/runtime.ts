import type { ToolMatchResult } from '../interface';
import i18n from '@/i18n';
import { md5Bytes } from './md5';

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-512';

export const HASH_ALGORITHMS: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-512'];

export type HashDigestMap = Record<HashAlgorithm, string>;

const WEB_CRYPTO_ALGORITHMS: Record<Exclude<HashAlgorithm, 'MD5'>, string> = {
  'SHA-1': 'SHA-1',
  'SHA-256': 'SHA-256',
  'SHA-512': 'SHA-512',
};

const HEX_LENGTH_BY_ALGORITHM: Record<HashAlgorithm, number> = {
  MD5: 32,
  'SHA-1': 40,
  'SHA-256': 64,
  'SHA-512': 128,
};

/**
 * 将 ArrayBuffer / Uint8Array 转为小写十六进制字符串。
 */
export const bytesToHex = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let result = '';
  for (let i = 0; i < view.length; i += 1) {
    result += view[i].toString(16).padStart(2, '0');
  }
  return result;
};

/**
 * 规范化十六进制期望值：去空白、转小写。
 */
export const normalizeHex = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

/**
 * 比较两个摘要（忽略大小写与空白）。
 */
export const compareHash = (actual: string, expected: string): boolean => {
  if (!actual || !expected.trim()) {
    return false;
  }
  return normalizeHex(actual) === normalizeHex(expected);
};

/**
 * 对字节数据计算指定算法摘要，输出小写十六进制。
 */
export const digestBytes = async (algorithm: HashAlgorithm, data: Uint8Array): Promise<string> => {
  if (algorithm === 'MD5') {
    return md5Bytes(data);
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error(i18n.global.t('tools.hash_tool.crypto_unavailable'));
  }

  const digest = await globalThis.crypto.subtle.digest(WEB_CRYPTO_ALGORITHMS[algorithm], data);
  return bytesToHex(digest);
};

/**
 * 对 UTF-8 文本计算摘要。
 */
export const digestText = async (algorithm: HashAlgorithm, text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  return digestBytes(algorithm, data);
};

/**
 * 批量计算多种算法摘要。
 */
export const digestAll = async (
  data: Uint8Array,
  algorithms: HashAlgorithm[] = HASH_ALGORITHMS,
): Promise<Partial<HashDigestMap>> => {
  const entries = await Promise.all(
    algorithms.map(async (algorithm) => [algorithm, await digestBytes(algorithm, data)] as const),
  );
  return Object.fromEntries(entries) as Partial<HashDigestMap>;
};

/**
 * 按界面选项格式化摘要输出。
 */
export const formatDigest = (hex: string, uppercase: boolean): string =>
  uppercase ? hex.toUpperCase() : hex.toLowerCase();

/**
 * 判断文本是否像完整 hex 摘要（32 / 40 / 64 / 128）。
 */
export const looksLikeHashHex = (input: string): boolean => {
  const normalized = normalizeHex(input);
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return false;
  }
  return Object.values(HEX_LENGTH_BY_ALGORITHM).includes(normalized.length);
};

/**
 * 工具匹配：关键词 hash/md5/sha，或像 32/40/64/128 hex 则中分。
 */
export const matchHashToolInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/\b(hash|md5|sha(?:-?(?:1|256|512))?)\b/i.test(trimmed) || /校验和|摘要|哈希/.test(trimmed)) {
    return {
      toolId: 'hash-tool',
      score: 80,
    };
  }

  if (looksLikeHashHex(trimmed)) {
    return {
      toolId: 'hash-tool',
      score: 50,
      matchedData: {
        expected: normalizeHex(trimmed),
      },
    };
  }

  return null;
};
