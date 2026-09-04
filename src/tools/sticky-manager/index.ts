import { StickyNote } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const stickyManagerTool: Tool = {
  metadata: {
    id: 'sticky-manager',
    name: 'tools.sticky_manager.name',
    description: 'tools.sticky_manager.description',
    icon: StickyNote,
    keywords: ['便利贴', '便签', 'sticky', 'note', '便签纸', '贴纸'],
  },
  component: () => import('./StickyManager.vue'),
  match: (input: string) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const keywords = ['便利贴', '便签', 'sticky', '便签纸', '贴纸'];
    if (keywords.some((k) => trimmed.includes(k))) {
      return { toolId: 'sticky-manager', score: 90 };
    }
    return null;
  },
};
