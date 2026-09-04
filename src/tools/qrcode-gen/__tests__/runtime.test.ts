import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeFormat, NotFoundException } from '@zxing/library';

const { jsBarcodeMock, qrCodeToDataURLMock } = vi.hoisted(() => ({
  jsBarcodeMock: vi.fn(),
  qrCodeToDataURLMock: vi.fn(),
}));

vi.mock('jsbarcode', () => ({ default: jsBarcodeMock }));
vi.mock('qrcode', () => ({
  toDataURL: qrCodeToDataURLMock,
}));

import {
  extractImageFileFromClipboardItems,
  generateBarcode,
  generateQRCode,
  isImageFile,
  isRecognitionNotFoundError,
} from '../runtime';
import { qrcodeGenTool } from '../index';

const QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  margin: 2,
  width: 200,
  color: { dark: '#000000', light: '#ffffff' },
};

const BARCODE_OPTIONS = {
  format: 'EAN13' as const,
  width: 2,
  height: 100,
  displayValue: true,
  background: '#ffffff',
  lineColor: '#000000',
  margin: 10,
};

describe('qrcode-gen runtime 生成函数', () => {
  beforeEach(() => {
    jsBarcodeMock.mockReset();
    qrCodeToDataURLMock.mockReset();
  });

  it('generateQRCode 对空文本直接返回空串', async () => {
    await expect(generateQRCode('', QR_OPTIONS)).resolves.toBe('');
    expect(qrCodeToDataURLMock).not.toHaveBeenCalled();
  });

  it('generateQRCode 把文本与选项透传给 qrcode 库', async () => {
    qrCodeToDataURLMock.mockResolvedValue('data:image/png;base64,QRCODE');

    await expect(generateQRCode('hello', QR_OPTIONS)).resolves.toBe('data:image/png;base64,QRCODE');
    expect(qrCodeToDataURLMock).toHaveBeenCalledWith('hello', QR_OPTIONS);
  });

  it('generateBarcode 对空文本直接返回空串', () => {
    expect(generateBarcode('', BARCODE_OPTIONS)).toBe('');
    expect(jsBarcodeMock).not.toHaveBeenCalled();
  });

  it('generateBarcode 把文本与选项透传给 jsbarcode 并返回 data url', () => {
    const toDataURLMock = vi.fn(() => 'data:image/png;base64,BARCODE');
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = toDataURLMock;

    try {
      const result = generateBarcode('6901234567892', BARCODE_OPTIONS);

      expect(result).toBe('data:image/png;base64,BARCODE');
      expect(toDataURLMock).toHaveBeenCalledWith('image/png');
      expect(jsBarcodeMock).toHaveBeenCalledTimes(1);
      const [canvas, text, options] = jsBarcodeMock.mock.calls[0];
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(text).toBe('6901234567892');
      expect(options).toEqual(BARCODE_OPTIONS);
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original;
    }
  });
});

describe('qrcode-gen runtime 识别辅助', () => {
  it('isImageFile 仅接受图片类型文件', () => {
    expect(isImageFile({ type: 'image/png' })).toBe(true);
    expect(isImageFile({ type: 'image/svg+xml' })).toBe(true);
    expect(isImageFile({ type: 'text/plain' })).toBe(false);
    expect(isImageFile(null)).toBe(false);
    expect(isImageFile(undefined)).toBe(false);
  });

  it('isRecognitionNotFoundError 识别“未找到码”的正常失败', () => {
    expect(isRecognitionNotFoundError(new NotFoundException())).toBe(true);

    const named = new Error('not found');
    Object.defineProperty(named, 'name', { value: 'NotFoundException' });
    expect(isRecognitionNotFoundError(named)).toBe(true);

    expect(isRecognitionNotFoundError(new Error('decode failed'))).toBe(false);
    expect(isRecognitionNotFoundError(null)).toBe(false);
    expect(isRecognitionNotFoundError(undefined)).toBe(false);
  });

  it('extractImageFileFromClipboardItems 对空剪贴板返回 null', () => {
    expect(extractImageFileFromClipboardItems(null)).toBeNull();
    expect(extractImageFileFromClipboardItems(undefined)).toBeNull();
    expect(extractImageFileFromClipboardItems([])).toBeNull();
  });

  it('extractImageFileFromClipboardItems 跳过非图片条目', () => {
    const result = extractImageFileFromClipboardItems([
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ]);
    expect(result).toBeNull();
  });

  it('extractImageFileFromClipboardItems 跳过 getAsFile 返回 null 的条目', () => {
    const result = extractImageFileFromClipboardItems([
      { kind: 'file', type: 'image/png', getAsFile: () => null },
    ]);
    expect(result).toBeNull();
  });

  it('extractImageFileFromClipboardItems 对无文件名的文件补充默认名称', () => {
    const source = new File(['bytes'], '', { type: 'image/gif' });
    const result = extractImageFileFromClipboardItems([
      { kind: 'file', type: 'image/gif', getAsFile: () => source },
    ]);

    expect(result).toBeInstanceOf(File);
    expect(result?.name).toBe('clipboard-image.png');
    expect(result?.type).toBe('image/gif');
  });

  it('extractImageFileFromClipboardItems 直接返回已有名称的文件', () => {
    const imageFile = new File(['bytes'], 'demo.png', { type: 'image/png' });
    const result = extractImageFileFromClipboardItems([
      { kind: 'file', type: 'image/png', getAsFile: () => imageFile },
    ]);

    expect(result).toBe(imageFile);
  });
});

describe('qrcodeGenTool matcher', () => {
  it('空输入不匹配', () => {
    expect(qrcodeGenTool.match('')).toBeNull();
    expect(qrcodeGenTool.match('   ')).toBeNull();
  });

  it('URL 输入获得较高权重', () => {
    const result = qrcodeGenTool.match('https://example.com');

    expect(result).toEqual({
      toolId: 'qrcode-gen',
      score: 60,
      matchedData: 'https://example.com',
    });
  });

  it('普通文本低权重匹配', () => {
    const result = qrcodeGenTool.match('hello world');

    expect(result?.toolId).toBe('qrcode-gen');
    expect(result?.score).toBe(10);
    expect(result?.matchedData).toBe('hello world');
  });

  it('超过 500 字符的输入不匹配', () => {
    expect(qrcodeGenTool.match('x'.repeat(500))).toBeNull();
    expect(qrcodeGenTool.match('y'.repeat(499))?.score).toBe(10);
  });
});
