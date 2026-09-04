import { Columns2 } from 'lucide-vue-next';
import type { Tool } from '../interface';

export * from './diff';

export const textDiffTool: Tool = {
  metadata: {
    id: 'text-diff',
    name: 'tools.text_diff.name',
    description: 'tools.text_diff.description',
    icon: Columns2,
    keywords: ['diff', 'compare', 'text diff', '文本对比', '差异', 'compare text'],
  },
  component: () => import('./TextDiff.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed.includes('\n')) {
      return null;
    }

    const lines = trimmed.split(/\r?\n/).filter(Boolean).length;
    if (lines < 2) {
      return null;
    }

    return {
      toolId: 'text-diff',
      score: 72,
      matchedData: { lines },
    };
  },
};
