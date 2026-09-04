import i18n from '@/i18n';

export type RegexFlag = 'g' | 'i' | 'm' | 's' | 'u' | 'y';

export const REGEX_FLAGS: RegexFlag[] = ['g', 'i', 'm', 's', 'u', 'y'];

export type CompileRegexResult =
  | {
      ok: true;
      regex: RegExp;
      source: string;
      flags: string;
    }
  | {
      ok: false;
      error: string;
      source: string;
      flags: string;
    };

export type RegexMatchItem = {
  index: number;
  match: string;
  groups: string[];
  namedGroups: Record<string, string>;
};

export type FindMatchesResult =
  | {
      ok: true;
      matches: RegexMatchItem[];
      source: string;
      flags: string;
    }
  | {
      ok: false;
      error: string;
      matches: RegexMatchItem[];
      source: string;
      flags: string;
    };

export type ReplacePreviewResult =
  | {
      ok: true;
      result: string;
      source: string;
      flags: string;
    }
  | {
      ok: false;
      error: string;
      result: string;
      source: string;
      flags: string;
    };

const FLAG_ORDER: RegexFlag[] = ['g', 'i', 'm', 's', 'u', 'y'];
const FLAG_SET = new Set<string>(FLAG_ORDER);

/**
 * 规范化 flags：去重、过滤非法字符，并按固定顺序排列。
 */
export const normalizeFlags = (flags: string | Iterable<string> = ''): string => {
  const raw = typeof flags === 'string' ? flags.split('') : Array.from(flags);
  const seen = new Set<RegexFlag>();

  for (const flag of raw) {
    if (FLAG_SET.has(flag)) {
      seen.add(flag as RegexFlag);
    }
  }

  return FLAG_ORDER.filter((flag) => seen.has(flag)).join('');
};

/**
 * 编译正则表达式，失败时返回可读错误信息。
 */
export const compileRegex = (
  pattern: string,
  flags: string | Iterable<string> = '',
): CompileRegexResult => {
  const normalizedFlags = normalizeFlags(flags);
  const source = pattern;

  // 空 pattern 不参与匹配，避免 empty-regex 在长文本上产生海量空匹配拖垮 UI
  if (!source) {
    return {
      ok: false,
      error: i18n.global.t('tools.regex_lab.empty_pattern'),
      source,
      flags: normalizedFlags,
    };
  }

  try {
    const regex = new RegExp(source, normalizedFlags);
    return {
      ok: true,
      regex,
      source,
      flags: normalizedFlags,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      source,
      flags: normalizedFlags,
    };
  }
};

const collectNamedGroups = (match: RegExpMatchArray): Record<string, string> => {
  const groups = match.groups;
  if (!groups) {
    return {};
  }

  const named: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (typeof value === 'string') {
      named[key] = value;
    }
  }
  return named;
};

/**
 * 在测试文本中查找全部匹配（内部强制带 g，避免只返回首个匹配）。
 * 捕获组与命名组一并返回。
 */
export const findMatches = (
  pattern: string,
  flags: string | Iterable<string>,
  text: string,
): FindMatchesResult => {
  const baseFlags = normalizeFlags(flags);
  const searchFlags = normalizeFlags(`${baseFlags}g`);
  const compiled = compileRegex(pattern, searchFlags);

  if (!compiled.ok) {
    return {
      ok: false,
      error: compiled.error,
      matches: [],
      source: compiled.source,
      flags: baseFlags,
    };
  }

  const matches: RegexMatchItem[] = [];
  const iterator = text.matchAll(compiled.regex);

  for (const match of iterator) {
    const full = match[0] ?? '';
    const index = match.index ?? 0;
    const groups = match.slice(1).map((item) => (item == null ? '' : String(item)));

    matches.push({
      index,
      match: full,
      groups,
      namedGroups: collectNamedGroups(match),
    });

    // 空匹配时 matchAll 会推进 lastIndex，这里仍做防护防止极端引擎行为死循环。
    if (matches.length > text.length + 1) {
      break;
    }
  }

  return {
    ok: true,
    matches,
    source: compiled.source,
    flags: baseFlags,
  };
};

/**
 * 使用 replace 模板生成替换预览，flags 行为与原生 String#replace 一致。
 */
export const replacePreview = (
  pattern: string,
  flags: string | Iterable<string>,
  text: string,
  replacement: string,
): ReplacePreviewResult => {
  const compiled = compileRegex(pattern, flags);

  if (!compiled.ok) {
    return {
      ok: false,
      error: compiled.error,
      result: '',
      source: compiled.source,
      flags: compiled.flags,
    };
  }

  try {
    const result = text.replace(compiled.regex, replacement);
    return {
      ok: true,
      result,
      source: compiled.source,
      flags: compiled.flags,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      result: '',
      source: compiled.source,
      flags: compiled.flags,
    };
  }
};

/**
 * 解析形如 `/pattern/flags` 的字面量；失败返回 null。
 */
export const parseRegexLiteral = (
  input: string,
): { pattern: string; flags: string } | null => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  // 从末尾找未转义的分隔 `/`
  let end = -1;
  for (let i = trimmed.length - 1; i >= 1; i -= 1) {
    if (trimmed[i] !== '/') {
      continue;
    }

    let backslashes = 0;
    for (let j = i - 1; j >= 0 && trimmed[j] === '\\'; j -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      end = i;
      break;
    }
  }

  if (end <= 0) {
    return null;
  }

  const pattern = trimmed.slice(1, end);
  const flagsPart = trimmed.slice(end + 1);
  if (!/^[gimsuy]*$/.test(flagsPart)) {
    return null;
  }

  return {
    pattern,
    flags: normalizeFlags(flagsPart),
  };
};
