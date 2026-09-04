import { Tool } from '../interface';
import { PlugZap } from 'lucide-vue-next';

export const portKillerTool: Tool = {
  metadata: {
    id: 'port-killer',
    name: 'tools.port_killer.name',
    description: 'tools.port_killer.description',
    icon: PlugZap,
    keywords: ['port', 'kill', 'netstat', 'taskkill', '端口', '占用'],
  },
  component: () => import('./PortKiller.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    const port = Number(trimmed);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { toolId: 'port-killer', score: 80, matchedData: port };
  },
};
