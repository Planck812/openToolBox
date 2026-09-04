/** 常见环境变量名：字母/下划线开头，后续可为字母数字下划线 */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ParseEnvAssignmentResult =
  | { ok: true; key: string; value: string }
  | { ok: false; reason: 'empty' | 'invalid_key' | 'no_assignment' };

/**
 * 校验环境变量 KEY 是否符合常见命名规则。
 */
export const isValidEnvKey = (key: string): boolean => {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return ENV_KEY_PATTERN.test(trimmed);
};

/**
 * 解析单行 `KEY=VALUE`（仅拆第一个 `=`，VALUE 可为空）。
 */
export const parseEnvAssignment = (input: string): ParseEnvAssignmentResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) {
    return { ok: false, reason: 'no_assignment' };
  }

  const key = trimmed.slice(0, eqIndex).trim();
  const value = trimmed.slice(eqIndex + 1);

  if (!isValidEnvKey(key)) {
    return { ok: false, reason: 'invalid_key' };
  }

  return { ok: true, key, value };
};

/**
 * 判断输入是否更像关键词搜索（环境变量 / env / setx）。
 */
export const matchesEnvKeywords = (input: string): boolean => {
  const trimmed = input.trim();
  if (!trimmed) return false;
  return /环境变量|setx|\benv\b|environment\s*variable/i.test(trimmed);
};
