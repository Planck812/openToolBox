import { NotebookPen } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const memoTool: Tool = {
  metadata: {
    id: 'memo',
    name: 'tools.memo.name',
    description: 'tools.memo.description',
    icon: NotebookPen,
    keywords: ['memo', 'note', 'notes', '备忘录', '便签', '记录'],
  },
  component: () => import('./MemoTool.vue'),
  match: () => null,
};
