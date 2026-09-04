import { SignJWT, exportSPKI, importJWK, importPKCS8, importSPKI, jwtVerify } from 'jose';
import i18n from '@/i18n';

export interface ParsedJwtClaimInfo {
  value: number;
  iso: string;
  status: 'valid' | 'expired' | 'pending' | 'issued';
}

export interface ParsedJwtToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  algorithm: string;
  segments: {
    header: string;
    payload: string;
    signature: string;
  };
  claims: {
    exp?: ParsedJwtClaimInfo;
    nbf?: ParsedJwtClaimInfo;
    iat?: ParsedJwtClaimInfo;
  };
}

export interface JwtKeyConfig {
  algorithm: string;
  keyType: 'text' | 'pem' | 'jwk';
  key: string;
}

export interface SignJwtInput extends JwtKeyConfig {
  headerText: string;
  payloadText: string;
}

export interface VerifyJwtInput extends JwtKeyConfig {
  token: string;
}

export interface VerifyJwtResult {
  valid: boolean;
  payload: Record<string, unknown>;
  protectedHeader: Record<string, unknown>;
}

interface ParseJwtOptions {
  now?: Date;
}

export type TimeClaimPreset =
  | 'set-iat-now'
  | 'set-nbf-now'
  | 'exp-10m'
  | 'exp-1h'
  | 'exp-24h'
  | 'clear-time-claims';

type SupportedAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'ES256'
  | 'ES384'
  | 'ES512';

type KeyPurpose = 'sign' | 'verify';

const HMAC_ALGORITHMS = new Set<SupportedAlgorithm>(['HS256', 'HS384', 'HS512']);
const RSA_ALGORITHMS = new Set<SupportedAlgorithm>(['RS256', 'RS384', 'RS512']);
const EC_ALGORITHMS = new Set<SupportedAlgorithm>(['ES256', 'ES384', 'ES512']);
const SUPPORTED_ALGORITHMS = new Set<SupportedAlgorithm>([
  ...HMAC_ALGORITHMS,
  ...RSA_ALGORITHMS,
  ...EC_ALGORITHMS,
]);

const decodeBase64ToBytes = (value: string) => {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

const decodeBase64UrlSegment = (segment: string) => {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = new TextDecoder().decode(decodeBase64ToBytes(padded));

    if (!decoded) {
      throw new Error('empty');
    }

    return decoded;
  } catch {
    throw new Error(i18n.global.t('tools.jwt_tool.error_invalid_jwt_decode'));
  }
};

const parseJsonRecord = (text: string, label: 'Header' | 'Payload' | 'JWK') => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(i18n.global.t('tools.jwt_tool.error_json_invalid', { part: label }));
  }
};

const normalizeAlgorithm = (algorithm: string): SupportedAlgorithm => {
  const normalized = algorithm.trim().toUpperCase() as SupportedAlgorithm;
  if (!SUPPORTED_ALGORITHMS.has(normalized)) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_algorithm_unsupported'));
  }
  return normalized;
};

const buildClaimInfo = (
  value: unknown,
  kind: 'exp' | 'nbf' | 'iat',
  nowMs: number,
): ParsedJwtClaimInfo | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const iso = new Date(value * 1000).toISOString();

  if (kind === 'exp') {
    return {
      value,
      iso,
      status: value * 1000 > nowMs ? 'valid' : 'expired',
    };
  }

  if (kind === 'nbf') {
    return {
      value,
      iso,
      status: value * 1000 > nowMs ? 'pending' : 'valid',
    };
  }

  return {
    value,
    iso,
    status: 'issued',
  };
};

const ensureKeyPresent = (key: string) => {
  if (!key.trim()) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_key_empty'));
  }
};

const ensureKeyTypeMatches = (algorithm: SupportedAlgorithm, keyType: JwtKeyConfig['keyType']) => {
  if (HMAC_ALGORITHMS.has(algorithm) && keyType !== 'text') {
    throw new Error(i18n.global.t('tools.jwt_tool.error_key_type_text_required'));
  }

  if ((RSA_ALGORITHMS.has(algorithm) || EC_ALGORITHMS.has(algorithm)) && keyType === 'text') {
    throw new Error(i18n.global.t('tools.jwt_tool.error_key_type_pem_jwk_required'));
  }
};

const formatFingerprint = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

const pemToDerBytes = (pem: string) => {
  const normalized = pem.trim();

  if (normalized.includes('BEGIN PRIVATE KEY')) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_private_key_fingerprint'));
  }

  if (!normalized.includes('BEGIN PUBLIC KEY')) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_invalid_public_pem'));
  }

  const base64Body = normalized
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');

  return decodeBase64ToBytes(base64Body);
};

const resolveJwkImportAlgorithm = (jwk: Record<string, unknown>): SupportedAlgorithm => {
  if (typeof jwk.alg === 'string') {
    return normalizeAlgorithm(jwk.alg);
  }

  if (jwk.kty === 'RSA') {
    return 'RS256';
  }

  if (jwk.kty === 'EC') {
    if (jwk.crv === 'P-256') {
      return 'ES256';
    }

    if (jwk.crv === 'P-384') {
      return 'ES384';
    }

    if (jwk.crv === 'P-521') {
      return 'ES512';
    }
  }

  throw new Error(i18n.global.t('tools.jwt_tool.error_jwk_unsupported'));
};

const ensureCryptoKeyMaterial = (key: CryptoKey | Uint8Array) => {
  if (key instanceof Uint8Array) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_jwk_unsupported'));
  }

  return key;
};

const resolveSigningKey = async (
  { algorithm, keyType, key }: JwtKeyConfig,
  purpose: KeyPurpose,
) => {
  const normalizedAlgorithm = normalizeAlgorithm(algorithm);
  ensureKeyTypeMatches(normalizedAlgorithm, keyType);
  ensureKeyPresent(key);

  if (HMAC_ALGORITHMS.has(normalizedAlgorithm)) {
    return new TextEncoder().encode(key);
  }

  if (keyType === 'pem') {
    if (purpose === 'sign') {
      return importPKCS8(key, normalizedAlgorithm);
    }

    return importSPKI(key, normalizedAlgorithm);
  }

  if (keyType === 'jwk') {
    const jwk = parseJsonRecord(key, 'JWK');
    return importJWK(jwk, normalizedAlgorithm);
  }

  throw new Error(i18n.global.t('tools.jwt_tool.error_key_algorithm_mismatch'));
};

export const parseJwtToken = (token: string, options: ParseJwtOptions = {}): ParsedJwtToken => {
  const normalized = token.trim();
  const segments = normalized.split('.');

  if (segments.length !== 3 || segments.some(segment => !segment)) {
    throw new Error(i18n.global.t('tools.jwt_tool.error_invalid_jwt_segments'));
  }

  const header = parseJsonRecord(decodeBase64UrlSegment(segments[0]), 'Header');
  const payload = parseJsonRecord(decodeBase64UrlSegment(segments[1]), 'Payload');
  const algorithm = typeof header.alg === 'string' ? header.alg : '';
  const nowMs = (options.now ?? new Date()).getTime();

  return {
    header,
    payload,
    algorithm,
    segments: {
      header: segments[0],
      payload: segments[1],
      signature: segments[2],
    },
    claims: {
      exp: buildClaimInfo(payload.exp, 'exp', nowMs),
      nbf: buildClaimInfo(payload.nbf, 'nbf', nowMs),
      iat: buildClaimInfo(payload.iat, 'iat', nowMs),
    },
  };
};

export const applyTimeClaimPreset = (
  payloadText: string,
  preset: TimeClaimPreset,
  options: { now?: Date } = {},
) => {
  const payload = parseJsonRecord(payloadText, 'Payload');
  const nextPayload = { ...payload };
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);

  if (preset === 'clear-time-claims') {
    delete nextPayload.iat;
    delete nextPayload.nbf;
    delete nextPayload.exp;
    return JSON.stringify(nextPayload, null, 2);
  }

  if (preset === 'set-iat-now') {
    nextPayload.iat = nowSeconds;
  }

  if (preset === 'set-nbf-now') {
    nextPayload.nbf = nowSeconds;
  }

  if (preset === 'exp-10m') {
    nextPayload.exp = nowSeconds + 10 * 60;
  }

  if (preset === 'exp-1h') {
    nextPayload.exp = nowSeconds + 60 * 60;
  }

  if (preset === 'exp-24h') {
    nextPayload.exp = nowSeconds + 24 * 60 * 60;
  }

  return JSON.stringify(nextPayload, null, 2);
};

export const computePublicKeyFingerprint = async (
  input: Pick<JwtKeyConfig, 'keyType' | 'key'>,
) => {
  ensureKeyPresent(input.key);

  let publicKeyBytes: Uint8Array;

  if (input.keyType === 'pem') {
    publicKeyBytes = pemToDerBytes(input.key);
  } else if (input.keyType === 'jwk') {
    const jwk = parseJsonRecord(input.key, 'JWK');

    if ('d' in jwk) {
      throw new Error(i18n.global.t('tools.jwt_tool.error_private_key_fingerprint'));
    }

    const cryptoKey = await importJWK(jwk, resolveJwkImportAlgorithm(jwk));
    const publicPem = await exportSPKI(ensureCryptoKeyMaterial(cryptoKey));
    publicKeyBytes = pemToDerBytes(publicPem);
  } else {
    throw new Error(i18n.global.t('tools.jwt_tool.error_text_key_fingerprint_unsupported'));
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', publicKeyBytes);
  return formatFingerprint(new Uint8Array(digest));
};

export const signJwtToken = async (input: SignJwtInput) => {
  const header = parseJsonRecord(input.headerText, 'Header');
  const payload = parseJsonRecord(input.payloadText, 'Payload');
  const algorithm = normalizeAlgorithm(input.algorithm);
  const key = await resolveSigningKey({ algorithm, keyType: input.keyType, key: input.key }, 'sign');

  return new SignJWT(payload)
    .setProtectedHeader({ ...header, alg: algorithm })
    .sign(key);
};

export const verifyJwtToken = async (input: VerifyJwtInput): Promise<VerifyJwtResult> => {
  const algorithm = normalizeAlgorithm(input.algorithm);
  const key = await resolveSigningKey({ algorithm, keyType: input.keyType, key: input.key }, 'verify');
  const verified = await jwtVerify(input.token, key, {
    algorithms: [algorithm],
  });

  return {
    valid: true,
    payload: verified.payload as Record<string, unknown>,
    protectedHeader: verified.protectedHeader as Record<string, unknown>,
  };
};
