import type { EnvPlatformInfo, EnvVariable, EnvVariableScope } from './env-shell';

/** Windows 环境变量名不区分大小写。 */
export const hasSameWindowsKey = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** 按平台判断两个变量名是否视为同一键。 */
export const hasSameKeyForPlatform = (
  platform: EnvPlatformInfo['platform'],
  left: string,
  right: string,
) => (platform === 'windows' ? hasSameWindowsKey(left, right) : left === right);

interface IpcErrorShape {
  code?: unknown;
  message?: unknown;
}

/** 变量来源标签：优先取后端 sourceLabel，否则按作用域翻译。 */
export const getVariableSourceLabel = (
  variable: EnvVariable,
  t: (key: string) => string,
  scopeLabelKeys: Record<EnvVariableScope, string>,
) => {
  const sourceLabel = typeof variable.sourceLabel === 'string' ? variable.sourceLabel.trim() : '';
  return sourceLabel || t(scopeLabelKeys[variable.scope]);
};

/** 预览动作标签。 */
export const getPreviewActionLabel = (action: string, t: (key: string) => string) => {
  if (action === 'add') return t('tools.env_setter.preview_action_add');
  if (action === 'replace') return t('tools.env_setter.preview_action_replace');
  return action;
};

export const getIpcErrorShape = (value: unknown): { code: string | null; message: string | null } | null => {
  if (typeof value !== 'object' || value === null) return null;

  const shape = value as IpcErrorShape;
  const code = typeof shape.code === 'string' && shape.code.trim() ? shape.code : null;
  const message = typeof shape.message === 'string' && shape.message.trim() ? shape.message : null;
  return code || message ? { code, message } : null;
};

/** 统一解析后端错误（支持 Error 实例 / 序列化 JSON / 原始字符串）。 */
export const getErrorInfo = (error: unknown): { code: string | null; message: string } => {
  const parseSerializedError = (value: string) => {
    try {
      return getIpcErrorShape(JSON.parse(value));
    } catch {
      return null;
    }
  };

  if (error instanceof Error) {
    const shape = getIpcErrorShape(error);
    const serialized = parseSerializedError(error.message);
    return {
      code: shape?.code ?? serialized?.code ?? null,
      message: serialized?.message ?? shape?.message ?? error.message,
    };
  }

  const shape = getIpcErrorShape(error);
  if (shape) return { code: shape.code, message: shape.message ?? shape.code ?? String(error) };

  if (typeof error === 'string') {
    const serialized = parseSerializedError(error);
    if (serialized) return { code: serialized.code, message: serialized.message ?? serialized.code ?? error };
    return { code: null, message: error };
  }

  return { code: null, message: String(error) };
};
