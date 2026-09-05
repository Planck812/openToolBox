import fs from 'node:fs';
import path from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QRCodeGen from '@/tools/qrcode-gen/QRCodeGen.vue';
import { useAppStore } from '@/store/app';

const { writeTextMock, writeImageMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
  writeImageMock: vi.fn(),
}));
const { imageNewMock } = vi.hoisted(() => ({
  imageNewMock: vi.fn(),
}));
const { qrcodeRuntimeMock } = vi.hoisted(() => ({
  qrcodeRuntimeMock: {
    generateQRCode: vi.fn(),
  },
}));

const generatedPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5x5hQAAAAASUVORK5CYII=';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
  writeImage: writeImageMock,
}));

vi.mock('@tauri-apps/api/image', () => ({
  Image: {
    new: imageNewMock,
  },
}));

vi.mock('@/tools/qrcode-gen/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/qrcode-gen/runtime')>();
  return {
    ...actual,
    generateQRCode: qrcodeRuntimeMock.generateQRCode,
  };
});

describe('二维码图片复制', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    writeTextMock.mockReset();
    writeImageMock.mockReset();
    imageNewMock.mockReset();
    qrcodeRuntimeMock.generateQRCode.mockReset();
    qrcodeRuntimeMock.generateQRCode.mockResolvedValue(generatedPngDataUrl);
    vi.restoreAllMocks();
  });

  it('复制生成图片时应优先调用 Tauri 图片剪贴板接口', async () => {
    const clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        write: clipboardWriteMock,
      },
    });
    const originalImage = globalThis.Image;
    const originalCreateElement = document.createElement.bind(document);
    const drawImageMock = vi.fn();
    const getImageDataMock = vi.fn(() => ({
      data: new Uint8ClampedArray([255, 255, 255, 255]),
    }));

    class MockImage {
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 1;
      height = 1;
      naturalWidth = 1;
      naturalHeight = 1;

      set src(_value: string) {
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: drawImageMock,
            getImageData: getImageDataMock,
          }),
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [createPinia()],
      },
    });
    const store = useAppStore();
    imageNewMock.mockResolvedValue({ rid: 7 });

    try {
      await wrapper.find('[data-testid="qrcode-generate-input"]').setValue('copy-image');
      await wrapper.find('[data-testid="qrcode-generate-btn"]').trigger('click');
      await flushPromises();

      const copyButton = wrapper.find('button[title="tools.qrcode_gen.copy_btn"]');
      expect(copyButton.exists()).toBe(true);

      await copyButton.trigger('click');
      await flushPromises();

      expect(drawImageMock).toHaveBeenCalledTimes(1);
      expect(getImageDataMock).toHaveBeenCalledTimes(1);
      expect(imageNewMock).toHaveBeenCalledTimes(1);
      expect(writeImageMock).toHaveBeenCalledTimes(1);
      expect(clipboardWriteMock).not.toHaveBeenCalled();
      expect(store.toasts[store.toasts.length - 1]?.message).toBe('tools.qrcode_gen.copy_success');
    } finally {
      wrapper.unmount();
      globalThis.Image = originalImage;
    }
  });

  it('桌面 capability 需要放开图片读写权限', () => {
    const capabilityPath = path.resolve(__dirname, '..', 'src-tauri', 'capabilities', 'default.json');
    const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf-8')) as {
      permissions: Array<string | { identifier: string }>;
    };

    expect(capability.permissions).toContain('clipboard-manager:allow-read-image');
    expect(capability.permissions).toContain('clipboard-manager:allow-write-image');
  });
});
