import { Image } from 'lucide-vue-next';
import type { Tool } from '../interface';
import {
  DEFAULT_IMAGE_MIME,
  buildImageDataUrl,
  isImageMimeType,
  isLikelyImageBase64,
  normalizeBase64Input,
  parseImageBase64,
} from './image-base64';

export {
  DEFAULT_IMAGE_MIME,
  buildImageDataUrl,
  isImageMimeType,
  isLikelyImageBase64,
  normalizeBase64Input,
  parseImageBase64,
};

const DATA_URL_PREFIX = 'data:';

export const imageBase64Tool: Tool = {
  metadata: {
    id: 'image-base64',
    name: 'tools.image_base64.name',
    description: 'tools.image_base64.description',
    icon: Image,
    keywords: ['image', 'base64', '图片', '转图片', '转base64', 'dataurl'],
  },
  component: () => import('./ImageBase64Converter.vue'),
  match: (input: string) => {
    if (!input) return null;

    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.toLowerCase().startsWith(DATA_URL_PREFIX)) {
      const parsed = parseImageBase64(trimmed);

      if (parsed && isImageMimeType(parsed.mime)) {
        return {
          toolId: imageBase64Tool.metadata.id,
          score: 95,
          matchedData: {
            kind: 'data-url',
            mime: parsed.mime,
          },
        };
      }
    }

    const normalized = normalizeBase64Input(trimmed);
    if (isLikelyImageBase64(normalized)) {
      return {
        toolId: imageBase64Tool.metadata.id,
        score: 70,
        matchedData: {
          kind: 'raw-base64',
          mime: DEFAULT_IMAGE_MIME,
        },
      };
    }

    return null;
  },
};
