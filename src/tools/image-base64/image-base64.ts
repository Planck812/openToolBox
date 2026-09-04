export const DEFAULT_IMAGE_MIME = 'image/png';

const DATA_URL_PATTERN = /^data:([^;,]+)(?:;[^,]+)*;base64,(.+)$/i;
const BASE64_STRICT_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_RAW_BASE64_LENGTH = 80;

export interface ParsedImageBase64 {
  mime: string;
  base64: string;
  dataUrl: string;
}

export const normalizeBase64Input = (value: string): string =>
  value.trim().replace(/\s+/g, '');

export const buildImageDataUrl = (base64: string, mime: string = DEFAULT_IMAGE_MIME): string =>
  `data:${mime};base64,${normalizeBase64Input(base64)}`;

export const isImageMimeType = (mime: string): boolean => {
  if (!mime) return false;
  return mime.trim().toLowerCase().startsWith('image/');
};

export const isLikelyImageBase64 = (value: string): boolean => {
  const normalized = normalizeBase64Input(value);
  if (normalized.length < MIN_RAW_BASE64_LENGTH) {
    return false;
  }

  if (!BASE64_STRICT_PATTERN.test(normalized)) {
    return false;
  }

  return true;
};

export const parseImageBase64 = (value: string): ParsedImageBase64 | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const dataUrlMatch = trimmed.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1].trim();
    const base64 = normalizeBase64Input(dataUrlMatch[2]);

    if (!base64 || !isImageMimeType(mime) || !BASE64_STRICT_PATTERN.test(base64)) {
      return null;
    }

    return {
      mime,
      base64,
      dataUrl: buildImageDataUrl(base64, mime),
    };
  }

  if (!isLikelyImageBase64(trimmed)) {
    return null;
  }

  const normalized = normalizeBase64Input(trimmed);
  return {
    mime: DEFAULT_IMAGE_MIME,
    base64: normalized,
    dataUrl: buildImageDataUrl(normalized),
  };
};
