import { describe, expect, it } from 'vitest';
import { ocrTool } from '../index';

describe('ocrTool matcher', () => {
  it('命中中英文关键词返回固定分数', () => {
    for (const keyword of ['OCR', '文字识别', '识别图片', '图片转文字', '提取文字', 'tesseract', '文本识别']) {
      const result = ocrTool.match(keyword);
      expect(result).toEqual({ toolId: 'ocr-tool', score: 90 });
    }
  });

  it('大小写不敏感匹配英文关键词', () => {
    expect(ocrTool.match('ocr')).toEqual({ toolId: 'ocr-tool', score: 90 });
    expect(ocrTool.match('Ocr')).toEqual({ toolId: 'ocr-tool', score: 90 });
  });

  it('关键词位于长句中也匹配', () => {
    expect(ocrTool.match('请帮我识别图片中的文字')).toEqual({ toolId: 'ocr-tool', score: 90 });
    expect(ocrTool.match('帮我提取文字内容')).toEqual({ toolId: 'ocr-tool', score: 90 });
  });

  it('无关输入与空输入不匹配', () => {
    expect(ocrTool.match('hello world')).toBeNull();
    expect(ocrTool.match('')).toBeNull();
    expect(ocrTool.match('   ')).toBeNull();
  });
});
