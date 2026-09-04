import { describe, expect, it, vi } from 'vitest';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  buildRecognitionHints,
  clipboardImageToDataUrl,
  extractImageFileFromClipboardItems,
  formatBarcodeFormatLabel,
} from '@/tools/qrcode-gen/runtime';

describe('二维码/条形码识别辅助函数', () => {
  it('构造识别 hints 时包含二维码和常见条形码格式', () => {
    const hints = buildRecognitionHints();
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as BarcodeFormat[];

    expect(hints.get(DecodeHintType.TRY_HARDER)).toBe(true);
    expect(formats).toContain(BarcodeFormat.QR_CODE);
    expect(formats).toContain(BarcodeFormat.CODE_128);
    expect(formats).toContain(BarcodeFormat.EAN_13);
  });

  it('格式化识别类型标签', () => {
    expect(formatBarcodeFormatLabel(BarcodeFormat.QR_CODE)).toBe('tools.qrcode_gen.tab_qrcode');
    expect(formatBarcodeFormatLabel(BarcodeFormat.CODE_128)).toBe('CODE 128');
  });

  it('从剪贴板条目中提取首张图片', () => {
    const imageFile = new File(['demo'], 'demo.png', { type: 'image/png' });
    const extracted = extractImageFileFromClipboardItems([
      {
        kind: 'string',
        type: 'text/plain',
        getAsFile: () => null,
      },
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => imageFile,
      },
    ]);

    expect(extracted).toBe(imageFile);
  });

  it('可将剪贴板 RGBA 图像转为浏览器可显示的 data url', async () => {
    const putImageData = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        putImageData,
      }),
      toDataURL: () => 'data:image/png;base64,ZmFsbGJhY2s=',
    } as unknown as HTMLCanvasElement;

    const originalImageData = globalThis.ImageData;
    class MockImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }

    globalThis.ImageData = MockImageData as unknown as typeof ImageData;

    try {
      const dataUrl = await clipboardImageToDataUrl(
        {
          rgba: async () => new Uint8Array([255, 255, 255, 255]),
          size: async () => ({ width: 1, height: 1 }),
        },
        () => mockCanvas,
      );

      expect(dataUrl).toBe('data:image/png;base64,ZmFsbGJhY2s=');
      expect(mockCanvas.width).toBe(1);
      expect(mockCanvas.height).toBe(1);
      expect(putImageData).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.ImageData = originalImageData;
    }
  });
});
