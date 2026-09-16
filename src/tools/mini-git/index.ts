import { GitBranch } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const miniGitTool: Tool = {
  metadata: {
    id: 'mini-git',
    name: 'tools.mini_git.name',
    description: 'tools.mini_git.description',
    icon: GitBranch,
    keywords: ['git', 'mini-git', 'repo', 'diff', 'commit', 'review', '审阅', '仓库', '差异'],
    mode: 'window',
  },
  // In window mode, resident_open is invoked instead of routing to component,
  // but a placeholder or launcher is provided if opened inline.
  component: () => import('./MiniGitLauncher.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (trimmed.startsWith('git ') || trimmed.includes('.git') || trimmed === 'git') {
      return { toolId: 'mini-git', score: 85 };
    }
    return null;
  },
};
