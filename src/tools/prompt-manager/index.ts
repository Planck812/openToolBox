import { Sparkles } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const promptManagerTool: Tool = {
  metadata: {
    id: 'prompt-manager',
    name: 'tools.prompt_manager.name',
    description: 'tools.prompt_manager.description',
    icon: Sparkles,
    keywords: ['prompt', 'prompts', '提示词', '咒语', 'ai', '模板', '收藏'],
  },
  component: () => import('./PromptManagerTool.vue'),
  match: () => null,
};
