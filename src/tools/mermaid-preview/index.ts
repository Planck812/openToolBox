import type { Tool } from '../interface';
import { Workflow } from 'lucide-vue-next';

export { DEFAULT_MERMAID_SOURCE } from './default-source';

/**
 * 剥离 Markdown 围栏：从文档/代码块复制出的 mermaid 常带
 * ```` ```mermaid ```` 开头、```` ``` ```` 结尾，mermaid 解析会失败。
 * 仅当首行匹配 ```` ```mermaid ````、末行匹配 ```` ``` ```` 时剥离，否则原样返回。
 */
export const stripMermaidFence = (text: string): string => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) {
    return text;
  }
  const first = lines[0].trim();
  const last = lines[lines.length - 1].trim();
  const isFencedStart = /^```mermaid\b.*$/i.test(first);
  const isFencedEnd = /^```\s*$/.test(last);
  if (!isFencedStart || !isFencedEnd) {
    return text;
  }
  return lines.slice(1, -1).join('\n');
};

export const mermaidPreviewTool: Tool = {
  metadata: {
    id: 'mermaid-preview',
    name: 'tools.mermaid_preview.name',
    description: 'tools.mermaid_preview.description',
    icon: Workflow,
    keywords: ['mermaid', 'diagram', 'graph', 'flowchart', 'sequence', '甘特图', '流程图', '时序图', '图表'],
  },
  component: () => import('./MermaidPreview.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    const patterns = [/^flowchart\b/im, /^graph\b/im, /^sequenceDiagram\b/im, /^classDiagram\b/im, /^stateDiagram\b/im, /^erDiagram\b/im, /^journey\b/im, /^gantt\b/im, /^mindmap\b/im, /^timeline\b/im];
    const matched = patterns.some((pattern) => pattern.test(trimmed));

    if (!matched) {
      return null;
    }

    return {
      toolId: 'mermaid-preview',
      score: 92,
      matchedData: trimmed,
    };
  },
};
