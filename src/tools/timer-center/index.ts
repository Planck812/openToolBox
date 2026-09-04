import { Timer } from 'lucide-vue-next';
import type { Tool } from '../interface';

const KEYWORDS = [
  '计时',
  '闹钟',
  '倒计时',
  '秒表',
  '番茄',
  'timer',
  'alarm',
  'stopwatch',
  'pomodoro',
  '整点',
  '报时',
  '专注',
  '定时',
];

export const timerCenterTool: Tool = {
  metadata: {
    id: 'timer-center',
    name: 'tools.timer_center.name',
    description: 'tools.timer_center.description',
    icon: Timer,
    keywords: KEYWORDS,
  },
  component: () => import('./TimerCenter.vue'),
  match: (input: string) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    if (KEYWORDS.some((k) => trimmed.includes(k))) {
      return { toolId: 'timer-center', score: 90 };
    }
    return null;
  },
};
