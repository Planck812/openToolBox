import { Variable } from 'lucide-vue-next';
import type { Tool, ToolMatchResult } from '../interface';
import { matchesEnvKeywords, parseEnvAssignment } from './env-model';

export { isValidEnvKey, matchesEnvKeywords, parseEnvAssignment, ENV_KEY_PATTERN } from './env-model';
export {
  apply_env_write,
  get_env_platform_info,
  get_user_env_var,
  list_user_env_vars,
  preview_env_write,
} from './env-shell';
export type {
  ApplyEnvWriteRequest,
  EnvPlatform,
  EnvPlatformInfo,
  EnvTarget,
  EnvTargetInfo,
  EnvTargetPreview,
  EnvVariable,
  EnvVariableScope,
  EnvVariableValueType,
  EnvWritePreview,
  GetEnvResult,
  ListEnvResult,
  PreviewEnvWriteRequest,
  SetEnvResult,
} from './env-shell';

/**
 * 识别 `KEY=VALUE` 或环境变量相关关键词，用于首页推荐。
 */
export const matchEnvSetterInput = (input: string): ToolMatchResult | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const assignment = parseEnvAssignment(trimmed);
  if (assignment.ok) {
    return {
      toolId: 'env-setter',
      score: 92,
      matchedData: {
        key: assignment.key,
        value: assignment.value,
      },
    };
  }

  if (matchesEnvKeywords(trimmed)) {
    return {
      toolId: 'env-setter',
      score: 75,
    };
  }

  return null;
};

export const envSetterTool: Tool = {
  metadata: {
    id: 'env-setter',
    name: 'tools.env_setter.name',
    description: 'tools.env_setter.description',
    icon: Variable,
    keywords: ['env', 'setx', 'environment', '环境变量', '用户环境', 'path', '环境'],
  },
  component: () => import('./EnvSetter.vue'),
  match: matchEnvSetterInput,
};
