import { describe, expect, it } from 'vitest';
import { imageViewerTool } from '@/tools/image-viewer';

describe('imageViewerTool', () => {
  it('识别图片 data url 输入', () => {
    const result = imageViewerTool.match('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA');
    expect(result?.toolId).toBe('image-viewer');
    expect(result?.score).toBeGreaterThan(80);
  });

  it('识别远程图片链接输入', () => {
    const result = imageViewerTool.match('https://example.com/demo-preview.png');
    expect(result?.toolId).toBe('image-viewer');
    expect(result?.matchedData).toEqual({
      kind: 'url',
      value: 'https://example.com/demo-preview.png',
    });
  });
});
