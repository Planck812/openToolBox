import { Regex } from 'lucide-vue-next';
import type { Tool, ToolMatchResult } from '../interface';
import { parseRegexLiteral } from './engine';

export * from './engine';

/**
 * 识别 `/pattern/flags` 字面量，或包含 regex / 正则 等关键词的输入。
 */
export const matchRegexLabInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const literal = parseRegexLiteral(trimmed);
  if (literal) {
    return {
      toolId: 'regex-lab',
      score: 92,
      matchedData: literal,
    };
  }

  if (/\bregex\b/i.test(trimmed) || /regexp/i.test(trimmed) || /正则/.test(trimmed)) {
    return {
      toolId: 'regex-lab',
      score: 80,
    };
  }

  return null;
};

export const regexLabTool: Tool = {
  metadata: {
    id: 'regex-lab',
    name: 'tools.regex_lab.name',
    description: 'tools.regex_lab.description',
    icon: Regex,
    keywords: ['regex', 'regexp', 'regular expression', '正则', '正则表达式', 'match', 'replace', 'pattern'],
  },
  component: () => import('./RegexLab.vue'),
  match: matchRegexLabInput,
};
