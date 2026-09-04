// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decodeBase32,
  encodeBase32,
  generateHotp,
  generateTotp,
  looksLikeBase32Secret,
  normalizeBase32Secret,
  parseOtpAuthUri,
  verifyTotpCode,
} from '../engine';
import { matchTotpToolInput } from '../index';

/** RFC 6238 Appendix B seed: ASCII "12345678901234567890" */
const RFC_SEED_ASCII = new TextEncoder().encode('12345678901234567890');
const RFC_SEED_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('normalizes spaces, dashes and lowercase', () => {
    expect(normalizeBase32Secret('gezd gnbv-gy3t')).toBe('GEZDGNBVGY3T');
  });

  it('decodes RFC seed and round-trips encode', () => {
    const decoded = decodeBase32(RFC_SEED_BASE32);
    expect(Array.from(decoded)).toEqual(Array.from(RFC_SEED_ASCII));
    expect(encodeBase32(decoded)).toBe(RFC_SEED_BASE32);
  });

  it('rejects invalid characters', () => {
    expect(() => decodeBase32('NOT!VALID')).toThrow('tools.totp_2fa.error_secret_not_base32');
  });

  it('detects secret-like base32 text', () => {
    expect(looksLikeBase32Secret(RFC_SEED_BASE32)).toBe(true);
    expect(looksLikeBase32Secret('JBSWY3DPEHPK3PXP')).toBe(true);
    expect(looksLikeBase32Secret('JBSW Y3DP EHPK 3PXP')).toBe(true);
    expect(looksLikeBase32Secret('hello world')).toBe(false);
    expect(looksLikeBase32Secret('totp helper')).toBe(false);
    expect(looksLikeBase32Secret('123456')).toBe(false);
    expect(looksLikeBase32Secret('SHORT')).toBe(false);
  });
});

describe('parseOtpAuthUri', () => {
  it('parses totp otpauth URI with all fields', () => {
    const uri =
      'otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60';
    const parsed = parseOtpAuthUri(uri);

    expect(parsed).toMatchObject({
      type: 'totp',
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'Example',
      account: 'alice@google.com',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    });
  });

  it('uses label issuer when issuer query is absent', () => {
    const parsed = parseOtpAuthUri(
      'otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP',
    );
    expect(parsed.issuer).toBe('GitHub');
    expect(parsed.account).toBe('user@example.com');
    expect(parsed.algorithm).toBe('SHA1');
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });

  it('rejects missing secret', () => {
    expect(() => parseOtpAuthUri('otpauth://totp/x?issuer=y')).toThrow('tools.totp_2fa.error_uri_missing_secret');
  });

  it('rejects non-otpauth schemes', () => {
    expect(() => parseOtpAuthUri('https://example.com')).toThrow('tools.totp_2fa.error_uri_invalid_scheme');
  });
});

describe('RFC 6238 TOTP vectors (SHA1, 8 digits)', () => {
  // https://datatracker.ietf.org/doc/html/rfc6238#appendix-B
  const vectors: Array<{ time: number; code: string }> = [
    { time: 59, code: '94287082' },
    { time: 1111111109, code: '07081804' },
    { time: 1111111111, code: '14050471' },
    { time: 1234567890, code: '89005924' },
    { time: 2000000000, code: '69279037' },
    { time: 20000000000, code: '65353130' },
  ];

  it.each(vectors)('time=$time → $code', async ({ time, code }) => {
    const result = await generateTotp({
      secret: RFC_SEED_ASCII,
      epochSeconds: time,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    });
    expect(result.code).toBe(code);
  });

  it('also works from base32 secret string', async () => {
    const secret = decodeBase32(RFC_SEED_BASE32);
    const result = await generateTotp({
      secret,
      epochSeconds: 59,
      digits: 8,
      algorithm: 'SHA1',
    });
    expect(result.code).toBe('94287082');
  });
});

describe('HOTP / remaining window', () => {
  it('generateHotp matches known counter', async () => {
    // counter for T=59, period=30 → floor(59/30)=1
    const code = await generateHotp(RFC_SEED_ASCII, 1, 8, 'SHA1');
    expect(code).toBe('94287082');
  });

  it('reports remaining seconds within period', async () => {
    const result = await generateTotp({
      secret: RFC_SEED_ASCII,
      epochSeconds: 59,
      period: 30,
      digits: 8,
    });
    // 59 % 30 = 29 → remaining 1 second in period (or period when exactly 0)
    expect(result.remainingSeconds).toBe(1);
  });
});

describe('verifyTotpCode', () => {
  it('accepts current window code', async () => {
    const result = await verifyTotpCode({
      secret: RFC_SEED_ASCII,
      code: '94287082',
      epochSeconds: 59,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
      window: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.matchedDelta).toBe(0);
  });

  it('accepts previous window (±1)', async () => {
    // code for counter 1 at time ~59; at time 90 counter is 3, window=-2 would fail with window=1
    // At time 70, counter=2; previous window counter=1 should match
    const result = await verifyTotpCode({
      secret: RFC_SEED_ASCII,
      code: '94287082',
      epochSeconds: 70,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
      window: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.matchedDelta).toBe(-1);
  });

  it('rejects wrong code', async () => {
    const result = await verifyTotpCode({
      secret: RFC_SEED_ASCII,
      code: '00000000',
      epochSeconds: 59,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    });
    expect(result.valid).toBe(false);
  });
});

describe('matchTotpToolInput', () => {
  it('scores otpauth URI highly', () => {
    const matched = matchTotpToolInput(
      'otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&issuer=Example',
    );
    expect(matched?.toolId).toBe('totp-2fa');
    expect(matched?.score).toBeGreaterThanOrEqual(90);
    expect(matched?.matchedData?.kind).toBe('otpauth');
  });

  it('scores base32 secret medium', () => {
    const matched = matchTotpToolInput('JBSWY3DPEHPK3PXP');
    expect(matched?.toolId).toBe('totp-2fa');
    expect(matched?.score).toBe(72);
    expect(matched?.matchedData?.kind).toBe('base32-secret');
  });

  it('scores keywords', () => {
    expect(matchTotpToolInput('我的 2fa 密钥')).toMatchObject({
      toolId: 'totp-2fa',
      score: 60,
    });
    expect(matchTotpToolInput('totp helper')).toMatchObject({
      toolId: 'totp-2fa',
      score: 60,
    });
  });

  it('returns null for unrelated text', () => {
    expect(matchTotpToolInput('hello world')).toBeNull();
    expect(matchTotpToolInput('please open settings')).toBeNull();
    expect(matchTotpToolInput('')).toBeNull();
  });
});
