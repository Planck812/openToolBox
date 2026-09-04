import * as QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType, NotFoundException } from '@zxing/library';
import i18n from '@/i18n';

export type GenType = 'qrcode' | 'barcode';
export type ToolMode = 'generate' | 'recognize';

export interface QRCodeOptions {
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  margin: number;
  width: number;
  color: {
    dark: string;
    light: string;
  };
}

export interface BarcodeOptions {
  format: 'CODE128' | 'EAN13' | 'UPC' | 'EAN8' | 'EAN5' | 'ITF14' | 'MSI' | 'pharmacode';
  width: number;
  height: number;
  displayValue: boolean;
  background: string;
  lineColor: string;
  margin: number;
}

export interface RecognitionResult {
  text: string;
  format: BarcodeFormat;
  formatLabel: string;
  isQRCode: boolean;
}

export interface ClipboardReadableImage {
  rgba(): Promise<Uint8Array>;
  size(): Promise<{
    width: number;
    height: number;
  }>;
}

export interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile?: () => File | null;
}

const RECOGNITION_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_8,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

/**
 * 生成二维码 DataURL
 */
export const generateQRCode = async (text: string, options: QRCodeOptions): Promise<string> => {
  if (!text) return '';
  return QRCode.toDataURL(text, options);
};

/**
 * 生成条形码 DataURL（通过 Canvas）
 */
export const generateBarcode = (text: string, options: BarcodeOptions): string => {
  if (!text) return '';

  const canvas = document.createElement('canvas');
  JsBarcode(canvas, text, options);
  return canvas.toDataURL('image/png');
};

/**
 * 构造二维码/条形码识别提示，限制到常见码制并开启更积极的识别策略
 */
export const buildRecognitionHints = (): Map<DecodeHintType, unknown> => {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, RECOGNITION_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};

/**
 * 将识别出的码制格式转换为更友好的展示名称
 */
export const formatBarcodeFormatLabel = (format: BarcodeFormat): string => {
  if (format === BarcodeFormat.QR_CODE) {
    return i18n.global.t('tools.qrcode_gen.tab_qrcode');
  }

  const formatName = BarcodeFormat[format] ?? 'UNKNOWN';
  return formatName.replace(/_/g, ' ');
};

/**
 * 判断文件是否为图片
 */
export const isImageFile = (file: Pick<File, 'type'> | null | undefined): boolean => {
  return Boolean(file?.type?.startsWith('image/'));
};

/**
 * 从剪贴板条目中提取第一张图片
 */
export const extractImageFileFromClipboardItems = (
  items: ArrayLike<ClipboardImageItem> | null | undefined,
): File | null => {
  if (!items) {
    return null;
  }

  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile?.();
    if (!file) {
      continue;
    }

    if (file.name) {
      return file;
    }

    return new File([file], 'clipboard-image.png', {
      type: file.type || 'image/png',
    });
  }

  return null;
};

/**
 * 将剪贴板中的 RGBA 图片数据重新编码为浏览器可预览的 PNG Data URL
 */
export const clipboardImageToDataUrl = async (
  image: ClipboardReadableImage,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<string> => {
  const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
  const canvas = createCanvas();
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('clipboard_image_canvas_unavailable');
  }

  const imageData = new ImageData(new Uint8ClampedArray(rgba), size.width, size.height);
  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
};

/**
 * 识别图片中的二维码或条形码
 */
export const recognizeCodeFromImage = async (image: HTMLImageElement): Promise<RecognitionResult> => {
  const reader = new BrowserMultiFormatReader(buildRecognitionHints(), 250);

  try {
    const result = await reader.decodeFromImageElement(image);
    const format = result.getBarcodeFormat();

    return {
      text: result.getText(),
      format,
      formatLabel: formatBarcodeFormatLabel(format),
      isQRCode: format === BarcodeFormat.QR_CODE,
    };
  } finally {
    reader.reset();
  }
};

/**
 * 判断识别失败是否属于“未找到二维码/条形码”的正常失败
 */
export const isRecognitionNotFoundError = (error: unknown): boolean => {
  return error instanceof NotFoundException || (error instanceof Error && error.name === 'NotFoundException');
};
