import type { Tool } from '../interface';
import { QrCode } from 'lucide-vue-next';

export const qrcodeGenTool: Tool = {
  metadata: {
    id: 'qrcode-gen',
    name: 'tools.qrcode_gen.name',
    description: 'tools.qrcode_gen.description',
    icon: QrCode,
    keywords: ['qrcode', 'barcode', 'generator', 'recognize', 'scan', '二维码', '条形码', '生成', '识别', '扫码'],
  },
  component: () => import('./QRCodeGen.vue'),
  match: (input: string) => {
    // 简单的匹配逻辑：如果不是太长，且像 URL 或特定格式，推荐二维码
    if (!input || input.trim().length === 0) return null;
    
    // URL 或 纯数字/字母 比较适合
    if (input.length < 500) {
       // 如果是 URL，权重高一点
       if (/^https?:\/\//i.test(input.trim())) {
         return {
           toolId: 'qrcode-gen',
           score: 60,
           matchedData: input,
         };
       }
       // 默认匹配
       return {
         toolId: 'qrcode-gen',
         score: 10,
         matchedData: input,
       };
    }
    return null;
  },
};
