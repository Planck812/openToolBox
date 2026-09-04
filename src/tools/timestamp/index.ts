import { Tool } from '../interface';
import { Clock } from 'lucide-vue-next';

export const timestampTool: Tool = {
  metadata: {
    id: 'timestamp',
    name: 'tools.timestamp.name',
    description: 'tools.timestamp.description',
    icon: Clock,
    keywords: ['time', 'date', 'timestamp'],
  },
  component: () => import('./TimestampConverter.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    // 10 digits (seconds) or 13 digits (ms)
    if (/^\d{10}$/.test(trimmed) || /^\d{13}$/.test(trimmed)) {
      return {
        toolId: 'timestamp',
        score: 100,
        matchedData: trimmed
      };
    }
    return null;
  },
};
