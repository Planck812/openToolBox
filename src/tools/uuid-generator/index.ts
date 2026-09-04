import type { Tool, ToolMatchResult } from '../interface';
import { Fingerprint } from 'lucide-vue-next';
import { v1 as uuidV1, v4 as uuidV4, v7 as uuidV7 } from 'uuid';

export type UuidVersion = 'v1' | 'v4' | 'v7';

export type GenerateUuidOptions = {
  version: UuidVersion;
  count: number;
};

export type FormatUuidOptions = {
  uppercase: boolean;
  removeHyphen: boolean;
};

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_LINE_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

const UUID_GENERATORS: Record<UuidVersion, () => string> = {
  v1: uuidV1,
  v4: uuidV4,
  v7: uuidV7,
};

/**
 * 批量生成指定版本的 UUID。
 * @param options 生成配置
 */
export const generateUuidBatch = (options: GenerateUuidOptions): string[] => {
  const count = Math.max(1, Math.min(500, Math.floor(options.count || 1)));
  const generator = UUID_GENERATORS[options.version];

  return Array.from({ length: count }, () => generator());
};

/**
 * 按界面选项格式化 UUID 批量结果。
 * @param values UUID 列表
 * @param options 格式化配置
 */
export const formatUuidBatch = (values: string[], options: FormatUuidOptions): string => {
  return values
    .map((value) => {
      let nextValue = options.removeHyphen ? value.replace(/-/g, '') : value;
      if (options.uppercase) {
        nextValue = nextValue.toUpperCase();
      }
      return nextValue;
    })
    .join('\n');
};

/**
 * 识别输入中是否包含 UUID 文本，用于工具推荐。
 * @param input 用户输入
 */
export const matchUuidToolInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const matched = trimmed.match(UUID_LINE_REGEX);
  if (!matched?.length) {
    return null;
  }

  return {
    toolId: 'uuid-generator',
    score: 80,
    matchedData: {
      count: matched.length,
    },
  };
};

export const uuidGeneratorTool: Tool = {
  metadata: {
    id: 'uuid-generator',
    name: 'tools.uuid_generator.name',
    description: 'tools.uuid_generator.description',
    icon: Fingerprint,
    keywords: ['uuid', 'guid', 'v1', 'v4', 'v7', '唯一标识', '标识符'],
  },
  component: () => import('./UuidGenerator.vue'),
  match: matchUuidToolInput,
};
