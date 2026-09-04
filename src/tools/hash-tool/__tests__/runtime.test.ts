// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareHash,
  digestText,
  looksLikeHashHex,
  matchHashToolInput,
  normalizeHex,
} from '../runtime';
import { md5Bytes } from '../md5';

const ABC = 'abc';

// NIST / RFC 已知向量
const VECTORS = {
  MD5: '900150983cd24fb0d6963f7d28e17f72',
  'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
  'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'SHA-512':
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
} as const;

describe('md5Bytes', () => {
  it('matches known MD5 vector for "abc"', () => {
    const data = new TextEncoder().encode(ABC);
    expect(md5Bytes(data)).toBe(VECTORS.MD5);
  });

  it('matches empty string MD5', () => {
    expect(md5Bytes(new Uint8Array())).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('digestText known vectors', () => {
  it('computes MD5 for "abc"', async () => {
    await expect(digestText('MD5', ABC)).resolves.toBe(VECTORS.MD5);
  });

  it('computes SHA-256 for "abc"', async () => {
    await expect(digestText('SHA-256', ABC)).resolves.toBe(VECTORS['SHA-256']);
  });

  it('computes SHA-1 and SHA-512 for "abc"', async () => {
    await expect(digestText('SHA-1', ABC)).resolves.toBe(VECTORS['SHA-1']);
    await expect(digestText('SHA-512', ABC)).resolves.toBe(VECTORS['SHA-512']);
  });
});

describe('compareHash', () => {
  it('ignores case and whitespace', () => {
    expect(compareHash(VECTORS.MD5, ' 9001 5098 3CD2 4FB0 D696 3F7D 28E1 7F72 ')).toBe(true);
    expect(compareHash(VECTORS['SHA-256'], VECTORS['SHA-256'].toUpperCase())).toBe(true);
  });

  it('returns false on mismatch or empty expected', () => {
    expect(compareHash(VECTORS.MD5, VECTORS['SHA-256'])).toBe(false);
    expect(compareHash(VECTORS.MD5, '   ')).toBe(false);
    expect(compareHash('', VECTORS.MD5)).toBe(false);
  });
});

describe('normalizeHex / looksLikeHashHex', () => {
  it('normalizes spaces and case', () => {
    expect(normalizeHex(' AB CD ')).toBe('abcd');
  });

  it('detects 32/40/64/128 hex digests', () => {
    expect(looksLikeHashHex(VECTORS.MD5)).toBe(true);
    expect(looksLikeHashHex(VECTORS['SHA-1'])).toBe(true);
    expect(looksLikeHashHex(VECTORS['SHA-256'])).toBe(true);
    expect(looksLikeHashHex(VECTORS['SHA-512'])).toBe(true);
    expect(looksLikeHashHex('not-a-hash')).toBe(false);
    expect(looksLikeHashHex('abc')).toBe(false);
  });
});

describe('matchHashToolInput', () => {
  it('matches hash/md5/sha keywords', () => {
    expect(matchHashToolInput('md5')).toEqual({ toolId: 'hash-tool', score: 80 });
    expect(matchHashToolInput('SHA-256 checksum')).toEqual({ toolId: 'hash-tool', score: 80 });
    expect(matchHashToolInput('hash tool')).toEqual({ toolId: 'hash-tool', score: 80 });
  });

  it('scores hex digests at medium', () => {
    expect(matchHashToolInput(VECTORS.MD5)).toEqual({
      toolId: 'hash-tool',
      score: 50,
      matchedData: { expected: VECTORS.MD5 },
    });
  });

  it('returns null for unrelated text', () => {
    expect(matchHashToolInput('hello world')).toBeNull();
    expect(matchHashToolInput('')).toBeNull();
  });
});
