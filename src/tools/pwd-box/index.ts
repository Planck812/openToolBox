import { KeyRound } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const pwdBoxTool: Tool = {
  metadata: {
    id: 'pwd-box',
    name: 'tools.pwd_box.name',
    description: 'tools.pwd_box.description',
    icon: KeyRound,
    keywords: ['pwd-box', 'password', 'credential', '账号', '密码', '密码夹', '网站'],
  },
  component: () => import('./PasswordBoxTool.vue'),
  match: () => null,
};
