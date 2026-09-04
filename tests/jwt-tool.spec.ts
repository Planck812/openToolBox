import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { writeTextMock, computePublicKeyFingerprintMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
  computePublicKeyFingerprintMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

vi.mock('@/tools/jwt-tool/runtime', async () => {
  const actual = await vi.importActual<typeof import('@/tools/jwt-tool/runtime')>('@/tools/jwt-tool/runtime');
  return {
    ...actual,
    computePublicKeyFingerprint: computePublicKeyFingerprintMock,
  };
});

import JwtToolView from '@/tools/jwt-tool/JwtToolView.vue';

const SAMPLE_TOKEN = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjMiLCJuYW1lIjoiQ29kZXgiLCJleHAiOjE5MDAwMDAwMDB9',
  'signature-demo-value',
].join('.');

const mountView = (props?: { initialData?: string }) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(JwtToolView, {
    props,
    global: {
      plugins: [pinia],
    },
  });
};

describe('JWT 调试台增强交互', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    computePublicKeyFingerprintMock.mockReset();
    computePublicKeyFingerprintMock.mockResolvedValue('AA:BB:CC:DD');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('解析后展示三段内容与长度信息，并支持复制 Header 和 Payload', async () => {
    const wrapper = mountView({ initialData: SAMPLE_TOKEN });
    await flushPromises();

    expect(wrapper.get('[data-testid="jwt-segment-header"]').text()).toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(wrapper.get('[data-testid="jwt-segment-payload"]').text()).toContain('eyJzdWIiOiIxMjMiLCJuYW1lIjoiQ29kZXgiLCJleHAiOjE5MDAwMDAwMDB9');
    expect(wrapper.get('[data-testid="jwt-segment-signature"]').text()).toContain('signature-demo-value');
    expect(wrapper.get('[data-testid="jwt-total-length"]').text()).toContain(String(SAMPLE_TOKEN.length));
    expect(wrapper.get('[data-testid="jwt-signature-length"]').text()).toContain(String('signature-demo-value'.length));

    await wrapper.get('[data-testid="copy-header-btn"]').trigger('click');
    await wrapper.get('[data-testid="copy-payload-btn"]').trigger('click');

    expect(writeTextMock).toHaveBeenNthCalledWith(1, expect.stringContaining('"alg": "HS256"'));
    expect(writeTextMock).toHaveBeenNthCalledWith(2, expect.stringContaining('"name": "Codex"'));
  });

  it('支持一键写入和清除时间声明', async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="claim-preset-exp-1h"]').trigger('click');
    await flushPromises();

    const payloadAfterExp = JSON.parse((wrapper.get('[data-testid="payload-text"]').element as HTMLTextAreaElement).value) as Record<string, unknown>;
    expect(payloadAfterExp.exp).toBe(1774954800);

    await wrapper.get('[data-testid="claim-preset-set-iat-now"]').trigger('click');
    await wrapper.get('[data-testid="claim-preset-set-nbf-now"]').trigger('click');
    await flushPromises();

    const payloadAfterNow = JSON.parse((wrapper.get('[data-testid="payload-text"]').element as HTMLTextAreaElement).value) as Record<string, unknown>;
    expect(payloadAfterNow.iat).toBe(1774951200);
    expect(payloadAfterNow.nbf).toBe(1774951200);

    await wrapper.get('[data-testid="claim-preset-clear-time-claims"]').trigger('click');
    await flushPromises();

    expect(JSON.parse((wrapper.get('[data-testid="payload-text"]').element as HTMLTextAreaElement).value)).toEqual({ sub: 'codex' });
  });

  it('支持生成并复制公钥指纹', async () => {
    const wrapper = mountView();

    await wrapper.get('[data-testid="key-type-select"]').setValue('pem');
    await wrapper.get('[data-testid="key-text"]').setValue('-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----');
    await wrapper.get('[data-testid="fingerprint-btn"]').trigger('click');
    await flushPromises();

    expect(computePublicKeyFingerprintMock).toHaveBeenCalledWith({
      keyType: 'pem',
      key: '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----',
    });
    expect(wrapper.get('[data-testid="fingerprint-value"]').text()).toContain('AA:BB:CC:DD');

    await wrapper.get('[data-testid="copy-fingerprint-btn"]').trigger('click');

    expect(writeTextMock).toHaveBeenCalledWith('AA:BB:CC:DD');
  });
});
