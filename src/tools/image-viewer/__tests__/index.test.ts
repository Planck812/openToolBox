import { describe, expect, it } from 'vitest';
import { imageViewerTool } from '../index';

const SAMPLE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4' +
  '////fwYGBgYGJgYGJgYGJgYGJgYGJwAAAP//AwAOD4s4kAAAAAElFTkSuQmCC';

describe('imageViewerTool matcher', () => {
  it('空输入与纯空白不匹配', () => {
    expect(imageViewerTool.match('')).toBeNull();
    expect(imageViewerTool.match('   ')).toBeNull();
  });

  it('识别常见图片扩展名的 URL', () => {
    const result = imageViewerTool.match('https://example.com/demo-preview.png');

    expect(result).toEqual({
      toolId: 'image-viewer',
      score: 78,
      matchedData: { kind: 'url', value: 'https://example.com/demo-preview.png' },
    });
  });

  it('URL 带查询参数与大小写扩展名也能识别', () => {
    const result = imageViewerTool.match('https://example.com/A.PNG?width=120&v=1');

    expect(result?.matchedData).toEqual({
      kind: 'url',
      value: 'https://example.com/A.PNG?width=120&v=1',
    });
  });

  it('非图片扩展名 URL 不匹配', () => {
    expect(imageViewerTool.match('https://example.com/page')).toBeNull();
    expect(imageViewerTool.match('https://example.com/a.html')).toBeNull();
    expect(imageViewerTool.match('ftp://example.com/a.png')).toBeNull();
  });

  it('识别 data url 并携带 mime', () => {
    const result = imageViewerTool.match(`data:image/webp;base64,${SAMPLE_BASE64}`);

    expect(result?.score).toBe(92);
    expect(result?.matchedData).toEqual({ kind: 'data-url', mime: 'image/webp' });
  });

  it('裸 base64 字符串经解析后按默认 mime 识别', () => {
    const result = imageViewerTool.match(SAMPLE_BASE64);

    expect(result?.score).toBe(92);
    expect(result?.matchedData).toEqual({ kind: 'data-url', mime: 'image/png' });
  });

  it('过短或非法 base64 不匹配', () => {
    expect(imageViewerTool.match('aGVsbG8=')).toBeNull();
    expect(imageViewerTool.match('not an image!')).toBeNull();
  });
});
