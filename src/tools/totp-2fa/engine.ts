/**
 * TOTP / HOTP engine (RFC 4226 / RFC 6238) using Web Crypto HMAC.
 * Pure TypeScript — no third-party OTP libraries.
 */

import i18n from '@/i18n';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export type TotpOptions = {
  secret: Uint8Array;
  /** Unix epoch seconds (default: now) */
  epochSeconds?: number;
  /** Time step in seconds (default: 30) */
  period?: number;
  /** Code length 6–8 (default: 6) */
  digits?: number;
  algorithm?: TotpAlgorithm;
  /** Counter override for HOTP-style generation */
  counter?: number;
};

export type ParsedOtpAuth = {
  type: 'totp' | 'hotp';
  secret: string;
  issuer: string;
  account: string;
  period: number;
  digits: number;
  algorithm: TotpAlgorithm;
  counter?: number;
  label: string;
};

export type TotpCodeResult = {
  code: string;
  counter: number;
  remainingSeconds: number;
  period: number;
  digits: number;
  algorithm: TotpAlgorithm;
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_LOOKUP = new Map(
  Array.from(BASE32_ALPHABET).map((char, index) => [char, index]),
);

const ALGORITHM_MAP: Record<TotpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

/**
 * Normalize Base32 secret text: strip spaces/dashes, uppercase, drop padding.
 */
export const normalizeBase32Secret = (input: string): string => {
  return input
    .trim()
    .replace(/[\s=-]+/g, '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B');
};

/**
 * Decode a Base32 (RFC 4648) string into bytes.
 * @throws Error when the secret is empty or contains invalid characters
 */
export const decodeBase32 = (input: string): Uint8Array => {
  const normalized = normalizeBase32Secret(input);
  if (!normalized) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_secret_empty'));
  }

  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const value = BASE32_LOOKUP.get(char);
    if (value === undefined) {
      throw new Error(i18n.global.t('tools.totp_2fa.error_secret_not_base32'));
    }

    bitBuffer = (bitBuffer << 5) | value;
    bitCount += 5;

    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >> bitCount) & 0xff);
    }
  }

  if (!bytes.length) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_secret_decode_empty'));
  }

  return new Uint8Array(bytes);
};

/**
 * Heuristic: text looks like a standalone Base32 secret.
 * Requires ≥16 chars, only A–Z/2–7 after cleanup, and at least one of 2–7
 * (typical random-key encoding). Spaced input must be equal-sized groups (4–8).
 */
export const looksLikeBase32Secret = (input: string): boolean => {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  // Compact without 0/1/8 alias substitutions used at decode time.
  const compact = trimmed.replace(/[\s=-]+/g, '').toUpperCase();
  if (compact.length < 16 || compact.length > 128) {
    return false;
  }

  if (!/^[A-Z2-7]+$/.test(compact)) {
    return false;
  }

  // Random secrets almost always include 2–7 after Base32 encoding.
  if (!/[2-7]/.test(compact)) {
    return false;
  }

  if (/\s/.test(trimmed)) {
    const tokens = trimmed
      .split(/\s+/)
      .map((token) => token.replace(/[=-]/g, ''))
      .filter(Boolean);
    if (tokens.length < 2) {
      return false;
    }
    const groupLen = tokens[0].length;
    if (groupLen < 4 || groupLen > 8) {
      return false;
    }
    if (!tokens.every((token) => token.length === groupLen && /^[A-Za-z2-7]+$/.test(token))) {
      return false;
    }
  }

  try {
    decodeBase32(compact);
    return true;
  } catch {
    return false;
  }
};

const normalizeAlgorithm = (raw: string | null | undefined): TotpAlgorithm => {
  const value = (raw ?? 'SHA1').trim().toUpperCase().replace(/-/g, '');
  if (value === 'SHA1' || value === 'SHA256' || value === 'SHA512') {
    return value;
  }
  throw new Error(i18n.global.t('tools.totp_2fa.error_unsupported_algorithm', { algorithm: raw }));
};

const clampDigits = (value: number): number => {
  if (![6, 7, 8].includes(value)) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_digits_invalid'));
  }
  return value;
};

/**
 * Parse otpauth:// URI (Google Authenticator style).
 * Supports totp and hotp; throws on invalid URI or missing secret.
 */
export const parseOtpAuthUri = (uri: string): ParsedOtpAuth => {
  const trimmed = uri.trim();
  if (!/^otpauth:\/\//i.test(trimmed)) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_uri_invalid_scheme'));
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(i18n.global.t('tools.totp_2fa.error_uri_malformed'));
  }

  const type = parsed.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') {
    throw new Error(i18n.global.t('tools.totp_2fa.error_uri_type_unsupported'));
  }

  // Path is "/Issuer:account" or "/account" (may be URL-encoded)
  const pathLabel = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  let issuerFromLabel = '';
  let account = pathLabel;

  const colonIndex = pathLabel.indexOf(':');
  if (colonIndex >= 0) {
    issuerFromLabel = pathLabel.slice(0, colonIndex).trim();
    account = pathLabel.slice(colonIndex + 1).trim();
  }

  const params = parsed.searchParams;
  const secretRaw = params.get('secret') ?? '';
  if (!secretRaw.trim()) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_uri_missing_secret'));
  }

  // Validate secret is base32
  decodeBase32(secretRaw);

  const issuerParam = params.get('issuer') ?? '';
  const issuer = issuerParam.trim() || issuerFromLabel;
  const period = Number(params.get('period') ?? '30');
  const digits = Number(params.get('digits') ?? '6');
  const algorithm = normalizeAlgorithm(params.get('algorithm'));
  const counterRaw = params.get('counter');

  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_period_invalid'));
  }
  clampDigits(digits);

  const result: ParsedOtpAuth = {
    type,
    secret: normalizeBase32Secret(secretRaw),
    issuer,
    account,
    period: Math.floor(period),
    digits,
    algorithm,
    label: pathLabel,
  };

  if (type === 'hotp') {
    if (counterRaw === null || counterRaw === '') {
      throw new Error(i18n.global.t('tools.totp_2fa.error_uri_missing_counter'));
    }
    const counter = Number(counterRaw);
    if (!Number.isFinite(counter) || counter < 0) {
      throw new Error(i18n.global.t('tools.totp_2fa.error_counter_invalid'));
    }
    result.counter = Math.floor(counter);
  }

  return result;
};

const writeCounterBytes = (counter: number): Uint8Array => {
  // 8-byte big-endian counter (RFC 4226)
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // JS number is safe for counters we care about; split into high/low 32-bit
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return new Uint8Array(buffer);
};

/**
 * Generate HOTP code for a given counter (RFC 4226).
 */
export const generateHotp = async (
  secret: Uint8Array,
  counter: number,
  digits: number = 6,
  algorithm: TotpAlgorithm = 'SHA1',
): Promise<string> => {
  const normalizedDigits = clampDigits(digits);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_crypto_unavailable'));
  }

  const key = await subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: ALGORITHM_MAP[algorithm] },
    false,
    ['sign'],
  );

  const signature = await subtle.sign('HMAC', key, writeCounterBytes(counter));
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** normalizedDigits;
  const code = binary % mod;
  return code.toString().padStart(normalizedDigits, '0');
};

/**
 * Generate current TOTP code and remaining seconds in the period.
 */
export const generateTotp = async (options: TotpOptions): Promise<TotpCodeResult> => {
  const period = options.period ?? 30;
  const digits = options.digits ?? 6;
  const algorithm = options.algorithm ?? 'SHA1';
  const epochSeconds =
    options.epochSeconds ?? Math.floor(Date.now() / 1000);

  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(i18n.global.t('tools.totp_2fa.error_period_invalid'));
  }

  const counter =
    options.counter ?? Math.floor(epochSeconds / period);
  const remainingSeconds = period - (epochSeconds % period);
  const code = await generateHotp(options.secret, counter, digits, algorithm);

  return {
    code,
    counter,
    remainingSeconds: remainingSeconds === 0 ? period : remainingSeconds,
    period,
    digits,
    algorithm,
  };
};

/**
 * Verify a user-entered code against current window ± windowSize (default 1).
 */
export const verifyTotpCode = async (
  options: TotpOptions & {
    code: string;
    /** Accept previous/next windows (default 1 → check -1,0,+1) */
    window?: number;
  },
): Promise<{ valid: boolean; matchedDelta: number | null }> => {
  const cleaned = options.code.replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(cleaned)) {
    return { valid: false, matchedDelta: null };
  }

  const period = options.period ?? 30;
  const digits = options.digits ?? 6;
  const algorithm = options.algorithm ?? 'SHA1';
  const epochSeconds =
    options.epochSeconds ?? Math.floor(Date.now() / 1000);
  const baseCounter = Math.floor(epochSeconds / period);
  const window = options.window ?? 1;

  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = await generateHotp(
      options.secret,
      baseCounter + delta,
      digits,
      algorithm,
    );
    if (candidate === cleaned) {
      return { valid: true, matchedDelta: delta };
    }
  }

  return { valid: false, matchedDelta: null };
};

/**
 * Encode raw bytes as Base32 (no padding) — useful for tests / display.
 */
export const encodeBase32 = (bytes: Uint8Array): string => {
  let bitBuffer = 0;
  let bitCount = 0;
  let output = '';

  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      output += BASE32_ALPHABET[(bitBuffer >> bitCount) & 0x1f];
    }
  }

  if (bitCount > 0) {
    output += BASE32_ALPHABET[(bitBuffer << (5 - bitCount)) & 0x1f];
  }

  return output;
};
