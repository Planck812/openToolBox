import { describe, expect, it, vi } from 'vitest';
import { parseJwtToken } from '../runtime';

describe('parseJwtToken 浏览器兼容性', () => {
  it('在没有 Buffer 的浏览器环境里也能解析 JWT', () => {
    const token = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjMiLCJuYW1lIjoiQ29kZXgifQ',
      'signature',
    ].join('.');

    vi.stubGlobal('Buffer', undefined);

    const result = parseJwtToken(token);

    expect(result.header.alg).toBe('HS256');
    expect(result.payload.name).toBe('Codex');

    vi.unstubAllGlobals();
  });
});
