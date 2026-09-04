import type { Tool, ToolMatchResult } from '../interface';
import { Lock } from 'lucide-vue-next';
import { looksLikeAesCipher } from './aes';

const AES_KEYWORDS = ['aes', 'encrypt', 'decrypt', '加密', '解密', '对称加密', 'gcm', '密码'];

/**
 * AES 工具智能搜索匹配：
 * 1. 形如 `v1:...` 密文 → 高分命中并预切到解密模式
 * 2. 含 aes / 加密 / 解密 等关键词 → 中分命中
 */
export const matchAesToolInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (looksLikeAesCipher(trimmed)) {
    return {
      toolId: 'aes-tool',
      score: 80,
      matchedData: { mode: 'decrypt', cipher: trimmed },
    };
  }

  if (/\b(aes|encrypt|decrypt|gcm)\b/i.test(trimmed) || /加密|解密|密码/.test(trimmed)) {
    return {
      toolId: 'aes-tool',
      score: 75,
    };
  }

  return null;
};

export const aesTool: Tool = {
  metadata: {
    id: 'aes-tool',
    name: 'tools.aes_tool.name',
    description: 'tools.aes_tool.description',
    icon: Lock,
    keywords: AES_KEYWORDS,
  },
  component: () => import('./AesTool.vue'),
  match: (input: string) => matchAesToolInput(input),
};
