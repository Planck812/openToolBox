import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MIME,
  buildImageDataUrl,
  imageBase64Tool,
  isImageMimeType,
  isLikelyImageBase64,
  normalizeBase64Input,
  parseImageBase64,
} from '../src/tools/image-base64';

const SAMPLE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4' +
  '////fwYGBgYGJgYGJgYGJgYGJgYGJwAAAP//AwAOD4s4kAAAAAElFTkSuQmCC';

describe('image-base64 utilities', () => {
  it('should normalize input by trimming and removing whitespace', () => {
    expect(normalizeBase64Input('  ' + SAMPLE_BASE64 + ' ')).toBe(SAMPLE_BASE64);
    expect(normalizeBase64Input('\n' + SAMPLE_BASE64.slice(0, 10) + '\n ')).toBe(
      SAMPLE_BASE64.slice(0, 10)
    );
    expect(normalizeBase64Input('a b\nc\td')).toBe('abcd');
  });

  it('should build a data URL with the provided mime type', () => {
    expect(buildImageDataUrl('abc', 'image/jpeg')).toBe('data:image/jpeg;base64,abc');
    expect(buildImageDataUrl('abc')).toBe('data:image/png;base64,abc');
  });

  it('should parse a data URL and extract mime + base64', () => {
    const dataUrl = `data:image/gif;base64,${SAMPLE_BASE64}`;
    const parsed = parseImageBase64(dataUrl);

    expect(parsed).not.toBeNull();
    expect(parsed?.mime).toBe('image/gif');
    expect(parsed?.base64).toBe(SAMPLE_BASE64);
    expect(parsed?.dataUrl).toBe(buildImageDataUrl(SAMPLE_BASE64, 'image/gif'));
  });

  it('should parse a raw base64 string and default to PNG mime', () => {
    const parsed = parseImageBase64(SAMPLE_BASE64);

    expect(parsed).not.toBeNull();
    expect(parsed?.mime).toBe(DEFAULT_IMAGE_MIME);
    expect(parsed?.base64).toBe(SAMPLE_BASE64);
    expect(parsed?.dataUrl).toBe(buildImageDataUrl(SAMPLE_BASE64, DEFAULT_IMAGE_MIME));
  });

  it('should return null for invalid base64 input', () => {
    expect(parseImageBase64('not-image')).toBeNull();
  });

  it('should identify image mime types correctly', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('image/svg+xml')).toBe(true);
    expect(isImageMimeType('text/plain')).toBe(false);
  });

  it('should detect likely image base64 strings', () => {
    expect(isLikelyImageBase64(SAMPLE_BASE64)).toBe(true);
    expect(isLikelyImageBase64('short')).toBe(false);
  });
});

describe('imageBase64Tool matcher', () => {
  it('should score data URLs highly', () => {
    const match = imageBase64Tool.match(`data:image/webp;base64,${SAMPLE_BASE64}`);

    expect(match).not.toBeNull();
    expect(match?.score).toBe(95);
    const data = match?.matchedData;
    if (data && typeof data === 'object' && 'kind' in data) {
      expect(data.kind).toBe('data-url');
    } else {
      throw new Error('expected matchedData.kind');
    }
  });

  it('should recognize long raw base64 strings', () => {
    const match = imageBase64Tool.match(SAMPLE_BASE64);

    expect(match).not.toBeNull();
    expect(match?.score).toBe(70);
    const data = match?.matchedData;
    if (data && typeof data === 'object' && 'kind' in data) {
      expect(data.kind).toBe('raw-base64');
    } else {
      throw new Error('expected matchedData.kind');
    }
  });

  it('should ignore unrelated input', () => {
    expect(imageBase64Tool.match('hello world')).toBeNull();
  });
});
