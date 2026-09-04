/**
 * AES-GCM-256 对称加解密引擎（纯前端 Web Crypto，无 Vue / 后端依赖）。
 *
 * 密钥由用户密码经 PBKDF2（SHA-256，100k 迭代，16 字节随机盐）派生；
 * IV 为 12 字节随机值；密文含 GCM 自带认证标签。
 *
 * 密文格式（版本化前缀便于未来演进）：
 *   `v1:<base64url(salt)>:<base64url(iv)>:<base64url(ciphertext+tag)>`
 *
 * 错误约定：本模块抛出的 Error.message 为稳定错误码（见 AesErrorCode），
 * UI 层通过 `AES_ERROR_I18N_KEY` 映射为本地化文案。
 */

export const AES_PREFIX = 'v1:';

export const PBKDF2_ITERATIONS = 100_000;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;

/** 引擎抛出的稳定错误码 */
export const AesErrorCode = {
  EMPTY_PLAIN: 'EMPTY_PLAIN',
  EMPTY_PASSWORD: 'EMPTY_PASSWORD',
  EMPTY_CIPHER: 'EMPTY_CIPHER',
  INVALID_FORMAT: 'INVALID_FORMAT',
  AUTH_FAILED: 'AUTH_FAILED',
  CRYPTO_UNAVAILABLE: 'CRYPTO_UNAVAILABLE',
} as const;

/** 错误码 → i18n key（供 UI 统一映射提示） */
export const AES_ERROR_I18N_KEY: Record<string, string> = {
  [AesErrorCode.EMPTY_PLAIN]: 'tools.aes_tool.error_empty_plain',
  [AesErrorCode.EMPTY_PASSWORD]: 'tools.aes_tool.error_empty_password',
  [AesErrorCode.EMPTY_CIPHER]: 'tools.aes_tool.error_empty_cipher',
  [AesErrorCode.INVALID_FORMAT]: 'tools.aes_tool.error_invalid_format',
  [AesErrorCode.AUTH_FAILED]: 'tools.aes_tool.error_auth_failed',
  [AesErrorCode.CRYPTO_UNAVAILABLE]: 'tools.aes_tool.error_crypto_unavailable',
};

const BASE64_URL_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// base64url 字符均为 ASCII，用定长表做解码查找
const REVERSE_LOOKUP: number[] = new Array(128).fill(-1);
for (let i = 0; i < BASE64_URL_CHARS.length; i += 1) {
  REVERSE_LOOKUP[BASE64_URL_CHARS.charCodeAt(i)] = i;
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    result += BASE64_URL_CHARS[(triplet >> 18) & 0x3f];
    result += BASE64_URL_CHARS[(triplet >> 12) & 0x3f];
    if (i + 1 < bytes.length) {
      result += BASE64_URL_CHARS[(triplet >> 6) & 0x3f];
    }
    if (i + 2 < bytes.length) {
      result += BASE64_URL_CHARS[triplet & 0x3f];
    }
  }
  return result;
};

const base64UrlToBytes = (input: string): Uint8Array => {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 0x3d) break; // '=' padding，URL-safe 编码通常已去除
    const value = code < 128 ? REVERSE_LOOKUP[code] : -1;
    if (value < 0) {
      throw new Error(AesErrorCode.INVALID_FORMAT);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
};

const requireCrypto = () => {
  if (!globalThis.crypto?.subtle) {
    throw new Error(AesErrorCode.CRYPTO_UNAVAILABLE);
  }
};

const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const parseCipher = (cipher: string): { salt: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array } => {
  if (!cipher.startsWith(AES_PREFIX)) {
    throw new Error(AesErrorCode.INVALID_FORMAT);
  }
  const segments = cipher.slice(AES_PREFIX.length).split(':');
  if (segments.length !== 3) {
    throw new Error(AesErrorCode.INVALID_FORMAT);
  }
  const [saltPart, ivPart, dataPart] = segments;
  if (!saltPart || !ivPart || !dataPart) {
    throw new Error(AesErrorCode.INVALID_FORMAT);
  }

  const salt = base64UrlToBytes(saltPart);
  const iv = base64UrlToBytes(ivPart);
  const ciphertext = base64UrlToBytes(dataPart);
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) {
    throw new Error(AesErrorCode.INVALID_FORMAT);
  }
  return { salt, iv, ciphertext };
};

/**
 * 使用密码加密明文，返回 `v1:salt:iv:ciphertext+tag` 格式密文。
 * @param plain 明文（非空）
 * @param password 用户密码（非空）
 */
export const aesEncrypt = async (plain: string, password: string): Promise<string> => {
  if (!plain) {
    throw new Error(AesErrorCode.EMPTY_PLAIN);
  }
  if (!password) {
    throw new Error(AesErrorCode.EMPTY_PASSWORD);
  }
  requireCrypto();

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  const ciphertext = new Uint8Array(encrypted);

  return [
    AES_PREFIX.slice(0, -1),
    bytesToBase64Url(salt),
    bytesToBase64Url(iv),
    bytesToBase64Url(ciphertext),
  ].join(':');
};

/**
 * 使用密码解密 `v1:` 格式密文。
 * 密码错误或密文被篡改（GCM 认证失败）时抛出 AUTH_FAILED。
 * @param cipher 密文（非空，`v1:` 格式）
 * @param password 用户密码（非空）
 */
export const aesDecrypt = async (cipher: string, password: string): Promise<string> => {
  if (!cipher) {
    throw new Error(AesErrorCode.EMPTY_CIPHER);
  }
  if (!password) {
    throw new Error(AesErrorCode.EMPTY_PASSWORD);
  }
  requireCrypto();

  const { salt, iv, ciphertext } = parseCipher(cipher);
  const key = await deriveKey(password, salt);

  try {
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error(AesErrorCode.AUTH_FAILED);
  }
};

/** 判断一段文本是否形如本工具产出的 `v1:` 密文。 */
export const looksLikeAesCipher = (text: string): boolean =>
  /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(text.trim());
