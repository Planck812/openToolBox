import { Tool } from '../interface';
import { ListChecks } from 'lucide-vue-next';

export type TextDedupOptions = {
  trimLine: boolean;
  ignoreCase: boolean;
  removeEmpty: boolean;
  sortOutput: boolean;
  keepOrder: boolean;
};

export type TextDedupResult = {
  items: string[];
  total: number;
  removed: number;
};

/**
 * 将多行文本去重，支持忽略大小写、排序输出等选项
 * @param source 待处理文本
 * @param options 配置项
 */
export const dedupLines = (source: string, options: TextDedupOptions): TextDedupResult => {
  const normalized = source.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  const seen = new Set<string>();
  const result: string[] = [];

  const iterate = (cb: (line: string, key: string) => void) => {
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const line = options.trimLine ? raw.trim() : raw;
      if (options.removeEmpty && !line) continue;
      const key = options.ignoreCase ? line.toLowerCase() : line;
      cb(line, key);
    }
  };

  if (options.keepOrder) {
    iterate((line, key) => {
      if (seen.has(key)) return;
      seen.add(key);
      result.push(line);
    });
  } else {
    for (let i = rawLines.length - 1; i >= 0; i--) {
      const line = options.trimLine ? rawLines[i].trim() : rawLines[i];
      if (options.removeEmpty && !line) continue;
      const key = options.ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(line);
    }
    result.reverse(); // 保留“最后一次出现”的顺序
  }

  let outputItems = result;

  if (options.sortOutput) {
    // 仅 sortOutput 开启时排序；keepOrder=false 的「保留最后一次出现」顺序不应被覆盖。
    outputItems = [...result].sort((a, b) => a.localeCompare(b));
  }

  return {
    items: outputItems,
    total: rawLines.length,
    removed: rawLines.length - outputItems.length,
  };
};

export const textDedupTool: Tool = {
  metadata: {
    id: 'text-dedup',
    name: 'tools.text_dedup.name',
    description: 'tools.text_dedup.description',
    icon: ListChecks,
    keywords: ['dedup', 'unique', '去重', '重复', '文本'],
  },
  component: () => import('./TextDedup.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed.includes('\n')) return null;

    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const unique = new Set(lines.map((l) => l.toLowerCase()));
    if (unique.size === lines.length) return null;

    return {
      toolId: 'text-dedup',
      score: 75,
      matchedData: { duplicates: lines.length - unique.size },
    };
  },
};
