import { Tool } from '../interface';
import { FileJson } from 'lucide-vue-next';

export const jsonViewerTool: Tool = {
  metadata: {
    id: 'json-viewer',
    name: 'tools.json_viewer.name',
    description: 'tools.json_viewer.description',
    icon: FileJson,
    keywords: ['json', 'format', 'pretty'],
  },
  component: () => import('./JsonViewer.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    // Basic heuristic: starts with { or [ and ends with } or ]
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return {
          toolId: 'json-viewer',
          score: 100,
          matchedData: trimmed
        };
      } catch {
        return null;
      }
    }
    return null;
  },
};
