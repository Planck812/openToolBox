import { ScanText } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const ocrTool: Tool = {
  metadata: {
    id: 'ocr-tool',
    name: 'tools.ocr.name',
    description: 'tools.ocr.description',
    icon: ScanText,
    keywords: ['OCR', '文字识别', '识别图片', '图片转文字', '提取文字', 'tesseract', '文本识别'],
  },
  component: () => import('./Component.vue'),
  match: (input: string) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const keywords = ['ocr', '文字识别', '识别图片', '图片转文字', '提取文字', 'tesseract', '文本识别'];
    if (keywords.some((k) => trimmed.includes(k))) {
      return { toolId: 'ocr-tool', score: 90 };
    }
    return null;
  },
};
