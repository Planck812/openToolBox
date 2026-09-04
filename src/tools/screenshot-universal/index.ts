import { Globe } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const screenshotUniversalTool: Tool = {
  metadata: {
    id: 'screenshot-universal',
    name: 'tools.screenshot.screenshot_universal.name',
    description: 'tools.screenshot.screenshot_universal.description',
    icon: Globe,
    keywords: [
      '全平台截图',
      '跨平台截图',
      'screenshot universal',
      'capture',
      '截屏',
      '屏幕',
      'screen',
      'macos',
      'linux',
    ],
  },
  component: () => import('./Component.vue'),
  match: (input: string) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const keywords = ['全平台截图', '跨平台截图', 'screenshot universal', 'universal screenshot'];
    if (keywords.some((k) => trimmed.includes(k.toLowerCase()))) {
      return { toolId: 'screenshot-universal', score: 85 };
    }
    return null;
  },
};
