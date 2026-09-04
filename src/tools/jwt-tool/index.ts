import type { Tool } from '../interface';
import { ShieldCheck } from 'lucide-vue-next';

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const jwtTool: Tool = {
  metadata: {
    id: 'jwt-tool',
    name: 'tools.jwt_tool.name',
    description: 'tools.jwt_tool.description',
    icon: ShieldCheck,
    keywords: ['jwt', 'token', 'jwk', 'pem', '验签', '签发', '解码'],
  },
  component: () => import('./JwtToolView.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (JWT_PATTERN.test(trimmed)) {
      return {
        toolId: 'jwt-tool',
        score: 95,
        matchedData: trimmed,
      };
    }

    if (/\bjwt\b/i.test(trimmed)) {
      return {
        toolId: 'jwt-tool',
        score: 75,
      };
    }

    return null;
  },
};
