import type { Tool, ToolMatchResult } from '../interface';
import { ArrowLeftRight } from 'lucide-vue-next';
import { detectFormatSync, type DetectedFormat } from './engine';

export {
  convertFormat,
  detectFormat,
  detectFormatSync,
  parseToValue,
  stringifyFromValue,
  parseProperties,
  stringifyProperties,
  flattenToProperties,
  SUPPORTED_FORMATS,
} from './engine';

export type {
  ConvertOptions,
  ConvertResult,
  ConvertSuccess,
  ConvertFailure,
  DataFormat,
  DetectedFormat,
  DetectResult,
} from './engine';

const FORMAT_KEYWORD_SCORE: Array<{ pattern: RegExp; format: DetectedFormat; score: number }> = [
  { pattern: /\b(yaml|yml)\b/i, format: 'yaml', score: 72 },
  { pattern: /\btoml\b/i, format: 'toml', score: 72 },
  { pattern: /\bxml\b/i, format: 'xml', score: 70 },
  { pattern: /\bproperties\b|\.properties\b/i, format: 'properties', score: 70 },
  { pattern: /\bjson\b/i, format: 'json', score: 68 },
  { pattern: /格式转换|互转|convert\s*format/i, format: 'json', score: 65 },
];

/**
 * 识别输入是否适合打开格式转换工具。
 * @param input 用户输入
 */
export const matchFormatConvertInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const detected = detectFormatSync(trimmed);
  if (detected.format && detected.confidence >= 65) {
    return {
      toolId: 'format-convert',
      score: Math.min(96, Math.round(detected.confidence)),
      matchedData: {
        format: detected.format,
        confidence: detected.confidence,
        text: trimmed,
      },
    };
  }

  for (const item of FORMAT_KEYWORD_SCORE) {
    if (item.pattern.test(trimmed)) {
      return {
        toolId: 'format-convert',
        score: item.score,
        matchedData: {
          format: item.format,
          keyword: true,
        },
      };
    }
  }

  return null;
};

export const formatConvertTool: Tool = {
  metadata: {
    id: 'format-convert',
    name: 'tools.format_convert.name',
    description: 'tools.format_convert.description',
    icon: ArrowLeftRight,
    keywords: [
      'format',
      'convert',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'properties',
      '格式转换',
      '互转',
      '序列化',
    ],
  },
  component: () => import('./FormatConvert.vue'),
  match: matchFormatConvertInput,
};
