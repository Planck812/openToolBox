import type { Tool, ToolMatchResult } from '../interface';
import { Shield } from 'lucide-vue-next';
import {
  looksLikeBase32Secret,
  normalizeBase32Secret,
  parseOtpAuthUri,
} from './engine';

export {
  decodeBase32,
  encodeBase32,
  generateHotp,
  generateTotp,
  looksLikeBase32Secret,
  normalizeBase32Secret,
  parseOtpAuthUri,
  verifyTotpCode,
} from './engine';

export type {
  ParsedOtpAuth,
  TotpAlgorithm,
  TotpCodeResult,
  TotpOptions,
} from './engine';

const KEYWORD_PATTERN = /\b(2fa|totp|hotp|otpauth|otp|authenticator|验证码|双因素|二步验证)\b/i;

/**
 * Recommend this tool from free-text / clipboard content.
 * - otpauth:// → high score
 * - base32 secret-like → medium
 * - keywords 2fa/totp/otp → lower
 */
export const matchTotpToolInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const parsed = parseOtpAuthUri(trimmed);
      return {
        toolId: 'totp-2fa',
        score: 96,
        matchedData: {
          kind: 'otpauth',
          secret: parsed.secret,
          issuer: parsed.issuer,
          account: parsed.account,
          period: parsed.period,
          digits: parsed.digits,
          algorithm: parsed.algorithm,
        },
      };
    } catch {
      return {
        toolId: 'totp-2fa',
        score: 85,
        matchedData: { kind: 'otpauth-invalid', raw: trimmed },
      };
    }
  }

  // Single-line base32 secret (ignore multi-line prose)
  if (!trimmed.includes('\n') && looksLikeBase32Secret(trimmed)) {
    return {
      toolId: 'totp-2fa',
      score: 72,
      matchedData: {
        kind: 'base32-secret',
        secret: normalizeBase32Secret(trimmed),
      },
    };
  }

  if (KEYWORD_PATTERN.test(trimmed)) {
    return {
      toolId: 'totp-2fa',
      score: 60,
      matchedData: { kind: 'keyword' },
    };
  }

  return null;
};

export const totp2faTool: Tool = {
  metadata: {
    id: 'totp-2fa',
    name: 'tools.totp_2fa.name',
    description: 'tools.totp_2fa.description',
    icon: Shield,
    keywords: [
      '2fa',
      'totp',
      'hotp',
      'otp',
      'otpauth',
      'authenticator',
      'mfa',
      '验证码',
      '双因素',
      '二步验证',
      '动态口令',
    ],
  },
  component: () => import('./Totp2faView.vue'),
  match: matchTotpToolInput,
};
