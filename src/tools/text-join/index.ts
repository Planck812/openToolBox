import { Tool } from '../interface';
import { Link } from 'lucide-vue-next';

export type TextJoinOptions = {
  delimiter: string;
  defaultDelimiter: string;
  prefix?: string;
  enableQuote: boolean;
  quoteChar: '"' | "'";
};

export type TextJoinResult = {
  items: string[];
  text: string;
};

/**
 * 将多行文本按规则合并为单行字符串
 * @param source 原始输入文本
 * @param options 合并选项
 */
export const joinTextLines = (source: string, options: TextJoinOptions): TextJoinResult => {
  const normalized = source.trim();
  if (!normalized) {
    return { items: [], text: '' };
  }

  const delimiterValue = options.delimiter || options.defaultDelimiter;
  const prefixValue = options.prefix ?? '';
  const rawLines = normalized.split('\n');
  const results: string[] = [];

  rawLines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const prefixedLine = `${prefixValue}${line}`;

    if (options.enableQuote) {
      const escaped = prefixedLine.split(options.quoteChar).join('\\' + options.quoteChar);
      results.push(`${options.quoteChar}${escaped}${options.quoteChar}`);
    } else {
      results.push(prefixedLine);
    }
  });

  return {
    items: results,
    text: results.join(delimiterValue),
  };
};

export const textJoinTool: Tool = {
  metadata: {
    id: 'text-join',
    name: 'tools.text_join.name',
    description: 'tools.text_join.description',
    icon: Link,
    keywords: ['text', 'join', 'merge', 'delimiter', 'quote'],
  },
  component: () => import('./TextJoin.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const lines = trimmed.split('\n');
    const nonEmptyCount = lines.filter((l) => l.trim().length > 0).length;
    if (nonEmptyCount < 2) return null;
    return {
      toolId: 'text-join',
      score: 65,
      matchedData: trimmed,
    };
  },
}; 
