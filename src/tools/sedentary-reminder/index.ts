import { AlarmClock } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const sedentaryReminderTool: Tool = {
  metadata: {
    id: 'sedentary-reminder',
    name: 'tools.sedentary_reminder.name',
    description: 'tools.sedentary_reminder.description',
    icon: AlarmClock,
    keywords: ['久坐', '提醒', '起身', 'sedentary', 'break', '休息', '活动'],
  },
  component: () => import('./SedentaryReminder.vue'),
  match: (input: string) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const keywords = ['久坐', '提醒', '起身', 'sedentary', 'break', '休息', '活动'];
    if (keywords.some((k) => trimmed.includes(k))) {
      return { toolId: 'sedentary-reminder', score: 90 };
    }
    return null;
  },
};
