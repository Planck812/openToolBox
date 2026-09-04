import { Image as ImageIcon } from 'lucide-vue-next';
import type { Tool } from '../interface';
import { isLikelyImageBase64, normalizeBase64Input, parseImageBase64 } from '../image-base64';

const IMAGE_URL_REGEX = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)(\?\S*)?$/i;

export const imageViewerTool: Tool = {
  metadata: {
    id: 'image-viewer',
    name: 'tools.image_viewer.name',
    description: 'tools.image_viewer.description',
    icon: ImageIcon,
    keywords: ['image', 'viewer', 'preview', '图片', '看图', '图片预览', 'image preview', 'dataurl'],
  },
  component: () => import('./ImageViewer.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (IMAGE_URL_REGEX.test(trimmed)) {
      return {
        toolId: 'image-viewer',
        score: 78,
        matchedData: {
          kind: 'url',
          value: trimmed,
        },
      };
    }

    const parsed = parseImageBase64(trimmed);
    if (parsed) {
      return {
        toolId: 'image-viewer',
        score: 92,
        matchedData: {
          kind: 'data-url',
          mime: parsed.mime,
        },
      };
    }

    if (isLikelyImageBase64(normalizeBase64Input(trimmed))) {
      return {
        toolId: 'image-viewer',
        score: 68,
        matchedData: {
          kind: 'raw-base64',
        },
      };
    }

    return null;
  },
};
