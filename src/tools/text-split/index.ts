import { Tool } from '../interface';
import { Scissors } from 'lucide-vue-next';

export type TextSplitOptions = {
  delimiter: string;
  defaultDelimiter: string;
};

export type TextSplitResult = {
  items: string[];
  text: string;
};

/**
 * 将批量文本按分隔符拆分为单列列表
 * @param source 输入文本（会对整体 trim）
 * @param options 配置项
 */
export const splitTextToList = (source: string, options: TextSplitOptions): TextSplitResult => {
  const normalized = source.trim();
  if (!normalized) {
    return { items: [], text: '' };
  }

  const delimiterValue = options.delimiter || options.defaultDelimiter;
  const rawLines = normalized.split('\n');
  const results: string[] = [];

  rawLines.forEach((rawLine) => {
    if (!rawLine.trim()) return;

    if (delimiterValue === ' ') {
      const parts = rawLine
        .split(' ')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      results.push(...parts);
      return;
    }

    const parts = rawLine
      .split(delimiterValue)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    results.push(...parts);
  });

  return {
    items: results,
    text: results.join('\n'),
  };
};

export const textSplitTool: Tool = {
  metadata: {
    id: 'text-split',
    name: 'tools.text_split.name',
    description: 'tools.text_split.description',
    icon: Scissors,
    keywords: ['text', 'split', 'delimiter', 'csv', 'list'],
  },
  component: () => import('./TextSplit.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const likelyBatch =
      trimmed.includes('\n') ||
      trimmed.includes(',') ||
      trimmed.includes(';') ||
      trimmed.includes('\t');

    if (!likelyBatch) return null;

    return {
      toolId: 'text-split',
      score: 60,
      matchedData: trimmed,
    };
  },
};
