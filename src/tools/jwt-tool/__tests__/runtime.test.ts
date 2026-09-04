// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import {
  applyTimeClaimPreset,
  computePublicKeyFingerprint,
  parseJwtToken,
  signJwtToken,
  verifyJwtToken,
} from '../runtime';

let rsaPrivatePem = '';
let rsaPublicPem = '';
let rsaPublicJwk = '';
let ecPrivatePem = '';
let ecPublicPem = '';

beforeAll(async () => {
  const rsaPair = await generateKeyPair('RS256', { extractable: true });
  rsaPrivatePem = await exportPKCS8(rsaPair.privateKey);
  rsaPublicPem = await exportSPKI(rsaPair.publicKey);
  rsaPublicJwk = JSON.stringify(await exportJWK(rsaPair.publicKey));

  const ecPair = await generateKeyPair('ES256', { extractable: true });
  ecPrivatePem = await exportPKCS8(ecPair.privateKey);
  ecPublicPem = await exportSPKI(ecPair.publicKey);
});

describe('parseJwtToken', () => {
  it('能够解析合法 JWT 的 header 与 payload', () => {
    const token = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjMiLCJuYW1lIjoiQ29kZXgiLCJleHAiOjE5MDAwMDAwMDB9',
      'signature',
    ].join('.');

    const result = parseJwtToken(token);

    expect(result.header.alg).toBe('HS256');
    expect(result.payload.name).toBe('Codex');
    expect(result.segments.signature).toBe('signature');
  });

  it('在 JWT 结构非法时返回格式错误', () => {
    expect(() => parseJwtToken('abc.def')).toThrow('tools.jwt_tool.error_invalid_jwt_segments');
  });

  it('能够提取 alg 与时间声明状态', () => {
    const token = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJleHAiOjQxMDAwMDAwMDAsIm5iZiI6MTcwMDAwMDAwMCwiaWF0IjoxNzAwMDAwMDAwfQ',
      'signature',
    ].join('.');

    const result = parseJwtToken(token, { now: new Date('2026-03-31T10:00:00.000Z') });

    expect(result.algorithm).toBe('HS256');
    expect(result.claims.exp?.status).toBe('valid');
    expect(result.claims.nbf?.status).toBe('valid');
    expect(result.claims.iat?.iso).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('jwt signing and verification', () => {
  it('支持使用文本密钥签发并验证 HS256 JWT', async () => {
    const token = await signJwtToken({
      algorithm: 'HS256',
      keyType: 'text',
      key: 'demo-secret',
      headerText: '{"typ":"JWT"}',
      payloadText: '{"sub":"codex","role":"admin"}',
    });

    const verifyResult = await verifyJwtToken({
      token,
      algorithm: 'HS256',
      keyType: 'text',
      key: 'demo-secret',
    });

    expect(verifyResult.valid).toBe(true);
  });

  it('支持使用 RSA PEM 签发并验证 RS256 JWT', async () => {
    const token = await signJwtToken({
      algorithm: 'RS256',
      keyType: 'pem',
      key: rsaPrivatePem,
      headerText: '{"typ":"JWT"}',
      payloadText: '{"sub":"rsa-user"}',
    });

    const verifyResult = await verifyJwtToken({
      token,
      algorithm: 'RS256',
      keyType: 'pem',
      key: rsaPublicPem,
    });

    expect(verifyResult.valid).toBe(true);
  });

  it('支持使用 RSA JWK 验签 RS256 JWT', async () => {
    const token = await signJwtToken({
      algorithm: 'RS256',
      keyType: 'pem',
      key: rsaPrivatePem,
      headerText: '{"typ":"JWT"}',
      payloadText: '{"sub":"rsa-user"}',
    });

    const verifyResult = await verifyJwtToken({
      token,
      algorithm: 'RS256',
      keyType: 'jwk',
      key: rsaPublicJwk,
    });

    expect(verifyResult.valid).toBe(true);
  });

  it('支持使用 EC PEM 签发并验证 ES256 JWT', async () => {
    const token = await signJwtToken({
      algorithm: 'ES256',
      keyType: 'pem',
      key: ecPrivatePem,
      headerText: '{"typ":"JWT"}',
      payloadText: '{"sub":"ec-user"}',
    });

    const verifyResult = await verifyJwtToken({
      token,
      algorithm: 'ES256',
      keyType: 'pem',
      key: ecPublicPem,
    });

    expect(verifyResult.valid).toBe(true);
  });

  it('在 header JSON 非法时拒绝签发', async () => {
    await expect(signJwtToken({
      algorithm: 'HS256',
      keyType: 'text',
      key: 'demo-secret',
      headerText: '{bad json}',
      payloadText: '{"sub":"demo"}',
    })).rejects.toThrow('tools.jwt_tool.error_json_invalid');
  });

  it('在算法与密钥类型不匹配时给出错误提示', async () => {
    await expect(verifyJwtToken({
      token: 'a.b.c',
      algorithm: 'HS256',
      keyType: 'pem',
      key: rsaPublicPem,
    })).rejects.toThrow('tools.jwt_tool.error_key_type_text_required');
  });
});

describe('jwt enhancement helpers', () => {
  it('能够按预设写入时间声明', () => {
    const result = applyTimeClaimPreset('{\n  "sub": "codex"\n}', 'exp-1h', {
      now: new Date('2026-03-31T10:00:00.000Z'),
    });

    const payload = JSON.parse(result) as Record<string, unknown>;

    expect(payload.sub).toBe('codex');
    expect(payload.exp).toBe(1774954800);
  });

  it('能够清除 iat nbf exp 三个时间字段', () => {
    const result = applyTimeClaimPreset('{"sub":"codex","iat":1,"nbf":2,"exp":3}', 'clear-time-claims');

    expect(JSON.parse(result)).toEqual({ sub: 'codex' });
  });

  it('能够计算 PEM 公钥指纹', async () => {
    const fingerprint = await computePublicKeyFingerprint({
      keyType: 'pem',
      key: rsaPublicPem,
    });

    expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('能够为同一把 JWK 公钥生成稳定指纹', async () => {
    const first = await computePublicKeyFingerprint({
      keyType: 'jwk',
      key: rsaPublicJwk,
    });
    const second = await computePublicKeyFingerprint({
      keyType: 'jwk',
      key: rsaPublicJwk,
    });

    expect(first).toBe(second);
  });

  it('私钥材料不允许计算公钥指纹', async () => {
    await expect(computePublicKeyFingerprint({
      keyType: 'pem',
      key: rsaPrivatePem,
    })).rejects.toThrow('tools.jwt_tool.error_private_key_fingerprint');
  });
});
