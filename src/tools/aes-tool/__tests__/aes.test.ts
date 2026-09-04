// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AES_PREFIX, aesDecrypt, aesEncrypt, looksLikeAesCipher } from '../aes';
import { matchAesToolInput } from '../index';

const PASSWORD = 'correct horse battery staple';

describe('aesEncrypt / aesDecrypt round-trip', () => {
  it('round-trips various plaintext including Chinese and special chars', async () => {
    const samples = [
      'hello world',
      '你好，世界！',
      'special: !@#$%^&*()_+{}|:"<>?[];\',./\\`~',
      'line1\nline2\nline3',
      'emoji 🚀 中文 mixed 👋',
    ];

    for (const plain of samples) {
      const cipher = await aesEncrypt(plain, PASSWORD);
      expect(cipher.startsWith(AES_PREFIX)).toBe(true);
      await expect(aesDecrypt(cipher, PASSWORD)).resolves.toBe(plain);
    }
  });

  it('produces distinct ciphertext for same plaintext (random salt/iv)', async () => {
    const plain = 'same input text';
    const a = await aesEncrypt(plain, PASSWORD);
    const b = await aesEncrypt(plain, PASSWORD);
    expect(a).not.toBe(b);
    await expect(aesDecrypt(a, PASSWORD)).resolves.toBe(plain);
    await expect(aesDecrypt(b, PASSWORD)).resolves.toBe(plain);
  });

  it('rejects decryption with a wrong password', async () => {
    const cipher = await aesEncrypt('secret message', PASSWORD);
    await expect(aesDecrypt(cipher, 'wrong-password')).rejects.toThrow('AUTH_FAILED');
  });

  it('rejects tampered ciphertext (single char flipped in data segment)', async () => {
    const cipher = await aesEncrypt('tamper me', PASSWORD);
    const parts = cipher.split(':');
    const data = parts[3];
    const flipped = data[0] === 'A' ? 'B' : 'A';
    const tampered = [parts[0], parts[1], parts[2], `${flipped}${data.slice(1)}`].join(':');
    await expect(aesDecrypt(tampered, PASSWORD)).rejects.toThrow('AUTH_FAILED');
  });

  it('validates empty inputs', async () => {
    await expect(aesEncrypt('', PASSWORD)).rejects.toThrow('EMPTY_PLAIN');
    await expect(aesEncrypt('text', '')).rejects.toThrow('EMPTY_PASSWORD');
    await expect(aesDecrypt('', PASSWORD)).rejects.toThrow('EMPTY_CIPHER');
    await expect(aesDecrypt(AES_PREFIX + 'x', '')).rejects.toThrow('EMPTY_PASSWORD');
  });

  it('rejects malformed cipher format', async () => {
    await expect(aesDecrypt('not-a-cipher', PASSWORD)).rejects.toThrow('INVALID_FORMAT');
    await expect(aesDecrypt(`${AES_PREFIX}abc`, PASSWORD)).rejects.toThrow('INVALID_FORMAT');
    await expect(aesDecrypt('v2:salt:iv:data', PASSWORD)).rejects.toThrow('INVALID_FORMAT');
    await expect(aesDecrypt('v1:abc:def', PASSWORD)).rejects.toThrow('INVALID_FORMAT');
  });
});

describe('looksLikeAesCipher', () => {
  it('recognizes v1: format', () => {
    expect(looksLikeAesCipher('v1:abc:def:ghi')).toBe(true);
    expect(looksLikeAesCipher('  v1:abc:def:ghi  ')).toBe(true);
    expect(looksLikeAesCipher('plain text')).toBe(false);
    expect(looksLikeAesCipher('')).toBe(false);
  });
});

describe('matchAesToolInput', () => {
  it('matches aes/encrypt/decrypt keywords at medium score', () => {
    expect(matchAesToolInput('aes 加密')).toEqual({ toolId: 'aes-tool', score: 75 });
    expect(matchAesToolInput('解密')).toEqual({ toolId: 'aes-tool', score: 75 });
    expect(matchAesToolInput('对称加密工具')).toEqual({ toolId: 'aes-tool', score: 75 });
    expect(matchAesToolInput('AES-GCM')).toEqual({ toolId: 'aes-tool', score: 75 });
  });

  it('matches v1 cipher format at higher score with decrypt mode', () => {
    const cipher = 'v1:abc:def:ghi';
    expect(matchAesToolInput(cipher)).toEqual({
      toolId: 'aes-tool',
      score: 80,
      matchedData: { mode: 'decrypt', cipher },
    });
  });

  it('returns null for unrelated or empty text', () => {
    expect(matchAesToolInput('hello world')).toBeNull();
    expect(matchAesToolInput('')).toBeNull();
    expect(matchAesToolInput('   ')).toBeNull();
  });
});
