import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeFormat } from '@zxing/library';
import QRCodeGen from '@/tools/qrcode-gen/QRCodeGen.vue';

const { writeTextMock, writeImageMock, readImageMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
  writeImageMock: vi.fn(),
  readImageMock: vi.fn(),
}));

const { clipboardImageToDataUrlMock, recognizeCodeFromImageMock } = vi.hoisted(() => ({
  clipboardImageToDataUrlMock: vi.fn(),
  recognizeCodeFromImageMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
  writeImage: writeImageMock,
  readImage: readImageMock,
}));

vi.mock('@/tools/qrcode-gen/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/qrcode-gen/runtime')>();

  return {
    ...actual,
    clipboardImageToDataUrl: clipboardImageToDataUrlMock,
    recognizeCodeFromImage: recognizeCodeFromImageMock,
  };
});

describe('二维码识别粘贴回退', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    writeTextMock.mockReset();
    writeImageMock.mockReset();
    readImageMock.mockReset();
    clipboardImageToDataUrlMock.mockReset();
    recognizeCodeFromImageMock.mockReset();
    vi.restoreAllMocks();
  });

  it('浏览器粘贴的图片对象无法加载时，应回退到 Tauri 剪贴板图片读取', async () => {
    const originalImage = globalThis.Image;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;

    class MockImage {
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        queueMicrotask(() => {
          if (value.startsWith('blob:broken-preview')) {
            this.onerror?.();
            return;
          }

          this.onload?.();
        });
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    URL.createObjectURL = vi.fn(() => 'blob:broken-preview');
    URL.revokeObjectURL = vi.fn();

    readImageMock.mockResolvedValue({
      rgba: vi.fn().mockResolvedValue(new Uint8Array([255, 255, 255, 255])),
      size: vi.fn().mockResolvedValue({ width: 1, height: 1 }),
    });
    clipboardImageToDataUrlMock.mockResolvedValue('data:image/png;base64,ZmFsbGJhY2s=');
    recognizeCodeFromImageMock.mockResolvedValue({
      text: 'https://example.com/codex-desktop',
      format: BarcodeFormat.QR_CODE,
      formatLabel: '二维码',
      isQRCode: true,
    });

    try {
      const wrapper = mount(QRCodeGen, {
        global: {
          plugins: [createPinia()],
        },
      });

      const recognizeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.mode_recognize');
      expect(recognizeButton).toBeTruthy();
      await recognizeButton!.trigger('click');
      await flushPromises();

      const pasteEvent = new Event('paste') as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => new File(['broken'], 'image.png', { type: 'image/png' }),
            },
          ],
        },
      });

      window.dispatchEvent(pasteEvent);
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();

      expect(readImageMock).toHaveBeenCalledTimes(1);
      expect(clipboardImageToDataUrlMock).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('https://example.com/codex-desktop');
      expect(wrapper.text()).not.toContain('tools.qrcode_gen.recognition_failed');
      wrapper.unmount();
    } finally {
      globalThis.Image = originalImage;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it('桌面端粘贴图片时应优先读取 Tauri 剪贴板图像，避免依赖浏览器剪贴板文件', async () => {
    const originalImage = globalThis.Image;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;

    class MockImage {
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      srcValue = '';

      set src(value: string) {
        this.srcValue = value;
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    URL.createObjectURL = vi.fn(() => 'blob:browser-file-preview');
    URL.revokeObjectURL = vi.fn();

    readImageMock.mockResolvedValue({
      rgba: vi.fn().mockResolvedValue(new Uint8Array([255, 255, 255, 255])),
      size: vi.fn().mockResolvedValue({ width: 1, height: 1 }),
    });
    clipboardImageToDataUrlMock.mockResolvedValue('data:image/png;base64,tauri-preview');
    recognizeCodeFromImageMock.mockImplementation(async (image: { srcValue?: string }) => {
      if (image.srcValue === 'data:image/png;base64,tauri-preview') {
        return {
          text: 'https://example.com/codex-desktop',
          format: BarcodeFormat.QR_CODE,
          formatLabel: '二维码',
          isQRCode: true,
        };
      }

      return {
        text: 'in (84105,84104,84103,84102,84101,84100);',
        format: BarcodeFormat.QR_CODE,
        formatLabel: '二维码',
        isQRCode: true,
      };
    });

    try {
      const wrapper = mount(QRCodeGen, {
        global: {
          plugins: [createPinia()],
        },
      });

      const recognizeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.mode_recognize');
      expect(recognizeButton).toBeTruthy();
      await recognizeButton!.trigger('click');
      await flushPromises();

      const pasteEvent = new Event('paste') as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => new File(['broken'], 'image.png', { type: 'image/png' }),
            },
          ],
        },
      });

      window.dispatchEvent(pasteEvent);
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();

      expect(readImageMock).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('https://example.com/codex-desktop');
      expect(wrapper.text()).not.toContain('in (84105,84104,84103,84102,84101,84100);');
      wrapper.unmount();
    } finally {
      globalThis.Image = originalImage;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });
});
