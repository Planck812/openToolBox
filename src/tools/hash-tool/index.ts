import { Hash } from 'lucide-vue-next';
import type { Tool } from '../interface';
import { matchHashToolInput } from './runtime';

export const hashTool: Tool = {
  metadata: {
    id: 'hash-tool',
    name: 'tools.hash_tool.name',
    description: 'tools.hash_tool.description',
    icon: Hash,
    keywords: ['hash', 'md5', 'sha', 'sha1', 'sha256', 'sha512', '校验和', '摘要', '哈希'],
  },
  component: () => import('./HashTool.vue'),
  match: matchHashToolInput,
};

export * from './runtime';
export { md5Bytes } from './md5';
