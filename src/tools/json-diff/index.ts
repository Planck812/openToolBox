import i18n from '@/i18n';
import { FileJson } from 'lucide-vue-next';
import type { Tool } from '../interface';

export type DiffType =
  | 'MISSING_IN_B'
  | 'EXTRA_IN_B'
  | 'TYPE_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'ARRAY_LENGTH_MISMATCH'
  | 'ARRAY_ELEMENT_MISMATCH'
  | 'ORDER_MISMATCH'
  | 'IGNORED'
  | 'ERROR';

export type Severity = 'INFO' | 'WARN' | 'ERROR';

export type ArrayStrategy = 'INDEX' | 'SET' | 'KEYED';

export interface DiffRecord {
  path: string;
  diffType: DiffType;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
  severity: Severity;
  meta?: Record<string, unknown>;
}

export interface CompareSummary {
  added: number;
  removed: number;
  changed: number;
  typeMismatch: number;
  arrayIssues: number;
  ignored: number;
  errors: number;
  truncated: boolean;
}

export interface CompareResult {
  overall: 'identical' | 'partial' | 'different';
  summary: CompareSummary;
  diffs: DiffRecord[];
  meta?: {
    duration: number;
    [key: string]: unknown;
  };
}

export interface JsonDiffConfig {
  ignorePaths?: string[];
  onlyComparePaths?: string[];
  redactPaths?: string[];
  missingEqualsNull?: boolean;
  numericStringAsNumber?: boolean;
  floatAbsoluteEpsilon?: number;
  floatRelativeEpsilon?: number;
  stringTrim?: boolean;
  stringCaseInsensitive?: boolean;
  arrayStrategy?: ArrayStrategy;
  arrayKeyFields?: string[]; // for KEYED
  arrayUnmatchedPolicy?: 'SPLIT' | 'AGGREGATE';
  maxDiffs?: number;
  maxValueLength?: number;
  includeIgnored?: boolean;
  diffSort?: 'path' | 'severity';
  maxDepth?: number;
}

const DEFAULTS: Required<JsonDiffConfig> = {
  ignorePaths: [],
  onlyComparePaths: [],
  redactPaths: [],
  missingEqualsNull: false,
  numericStringAsNumber: false,
  floatAbsoluteEpsilon: 0,
  floatRelativeEpsilon: 0,
  stringTrim: false,
  stringCaseInsensitive: false,
  arrayStrategy: 'INDEX',
  arrayKeyFields: [],
  arrayUnmatchedPolicy: 'SPLIT',
  maxDiffs: 2000,
  maxValueLength: 2000,
  includeIgnored: false,
  diffSort: 'path',
  maxDepth: 200,
};

/**
 * 将 JSON Pointer 片段按 RFC 6901 进行转义
 * @param key 原始 key
 */
export const escapeJsonPointer = (key: string): string =>
  key.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * 判断路径是否被忽略或仅比较白名单之外
 * @param path 当前 JSON Pointer 路径
 * @param config 对比配置
 */
const shouldIgnore = (path: string, config: Required<JsonDiffConfig>): { ignore: boolean; reason?: string } => {
  const matchAny = (patterns: string[], p: string) => {
    if (patterns.length === 0) return false;
    return patterns.some((pattern) => {
      if (pattern === p) return true;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        return p.startsWith(prefix + '/');
      }
      return false;
    });
  };

  if (config.onlyComparePaths.length > 0 && !matchAny(config.onlyComparePaths, path)) {
    return { ignore: true, reason: 'onlyComparePaths' };
  }
  if (matchAny(config.ignorePaths, path)) {
    return { ignore: true, reason: 'ignorePaths' };
  }
  return { ignore: false };
};

/**
 * 判断字符串是否相等（支持 trim、大小写忽略）
 * @param a 字符串 A
 * @param b 字符串 B
 * @param config 对比配置
 */
const stringEquals = (a: string, b: string, config: Required<JsonDiffConfig>): boolean => {
  let sa = a;
  let sb = b;
  if (config.stringTrim) {
    sa = sa.trim();
    sb = sb.trim();
  }
  if (config.stringCaseInsensitive) {
    sa = sa.toLowerCase();
    sb = sb.toLowerCase();
  }
  return sa === sb;
};

/**
 * 在数值比较时判断是否在容差范围内
 * @param a 数值 A
 * @param b 数值 B
 * @param config 对比配置
 */
const numberWithinTolerance = (a: number, b: number, config: Required<JsonDiffConfig>): boolean => {
  const abs = Math.abs(a - b);
  if (abs <= config.floatAbsoluteEpsilon) return true;
  const maxAbs = Math.max(Math.abs(a), Math.abs(b));
  if (maxAbs === 0) return abs === 0;
  return abs / maxAbs <= config.floatRelativeEpsilon;
};

/**
 * 生成集合元素指纹（用于 SET 策略）
 * @param value 集合元素
 */
const fingerprint = (value: any): string => {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return `s:${value}`;
  if (t === 'number') return `n:${value}`;
  if (t === 'boolean') return `b:${value}`;
  try {
    return `j:${JSON.stringify(value, Object.keys(value).sort())}`;
  } catch {
    return `x:${String(value)}`;
  }
};

/**
 * 对输出值进行脱敏与截断
 * @param path JSON Pointer 路径
 * @param value 原始值
 * @param config 对比配置
 */
const formatOutValue = (path: string, value: any, config: Required<JsonDiffConfig>): { v: any; redacted: boolean } => {
  const redacted = config.redactPaths.some((p) => p === path || (p.endsWith('/*') && path.startsWith(p.slice(0, -2) + '/')));
  const v = redacted ? '***' : value;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s && s.length > config.maxValueLength) {
    const truncated = s.slice(0, config.maxValueLength) + i18n.global.t('tools.json_diff.value_truncated', { count: s.length - config.maxValueLength });
    try {
      return { v: redacted ? v : truncated, redacted };
    } catch {
      return { v: truncated, redacted };
    }
  }
  return { v, redacted };
};

/**
 * 递归对比两个节点，输出差异记录
 * @param a 节点 A
 * @param b 节点 B
 * @param path 当前 JSON Pointer 路径
 * @param config 对比配置
 * @param diffs 差异累积列表
 * @param stats 统计信息
 * @param depth 当前递归深度
 */
const compareNode = (
  a: any,
  b: any,
  path: string,
  config: Required<JsonDiffConfig>,
  diffs: DiffRecord[],
  stats: { added: number; removed: number; changed: number; typeMismatch: number; arrayIssues: number; ignored: number; errors: number },
  depth: number
) => {
  if (depth > config.maxDepth) {
    diffs.push({
      path,
      diffType: 'ERROR',
      message: i18n.global.t('tools.json_diff.max_depth_exceeded'),
      severity: 'ERROR',
      meta: { maxDepth: config.maxDepth },
    });
    stats.errors += 1;
    return;
  }

  const ignoreCheck = shouldIgnore(path, config);
  if (ignoreCheck.ignore) {
    if (config.includeIgnored) {
      diffs.push({
        path,
        diffType: 'IGNORED',
        message: i18n.global.t('tools.json_diff.path_ignored', { reason: ignoreCheck.reason }),
        severity: 'INFO',
      });
      stats.ignored += 1;
    }
    return;
  }

  if (a === undefined && b === undefined) {
    return;
  }
  if (a === undefined) {
    const out = formatOutValue(path, b, config);
    diffs.push({
      path,
      diffType: 'EXTRA_IN_B',
      newValue: out.v,
      message: i18n.global.t('tools.json_diff.b_has_extra_field'),
      severity: 'WARN',
      meta: { direction: 'B', redacted: out.redacted },
    });
    stats.added += 1;
    return;
  }
  if (b === undefined) {
    const out = formatOutValue(path, a, config);
    diffs.push({
      path,
      diffType: 'MISSING_IN_B',
      oldValue: out.v,
      message: i18n.global.t('tools.json_diff.b_missing_field'),
      severity: 'WARN',
      meta: { direction: 'B', redacted: out.redacted },
    });
    stats.removed += 1;
    return;
  }

  if (a === null || b === null) {
    if (config.missingEqualsNull) {
      if (a === null && b === undefined) return;
      if (a === undefined && b === null) return;
    }
  }

  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) {
    // numericStringAsNumber：数字与数字字符串按数值比较。
    // 若在此直接判 TYPE_MISMATCH 返回，number 分支里的 numericStringAsNumber 永不触达（死代码）。
    if (
      config.numericStringAsNumber &&
      ((ta === 'number' && tb === 'string') || (ta === 'string' && tb === 'number'))
    ) {
      const aNum = Number(a);
      const bNum = Number(b);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        if (numberWithinTolerance(aNum, bNum, config)) {
          return;
        }
        const outA = formatOutValue(path, a, config);
        const outB = formatOutValue(path, b, config);
        diffs.push({
          path,
          diffType: 'VALUE_MISMATCH',
          oldValue: outA.v,
          newValue: outB.v,
          message: i18n.global.t('tools.json_diff.numeric_diff', { a, b }),
          severity: 'WARN',
        });
        stats.changed += 1;
        return;
      }
    }
    const outA = formatOutValue(path, a, config);
    const outB = formatOutValue(path, b, config);
    diffs.push({
      path,
      diffType: 'TYPE_MISMATCH',
      oldValue: outA.v,
      newValue: outB.v,
      message: i18n.global.t('tools.json_diff.type_mismatch', { a: ta, b: tb }),
      severity: 'ERROR',
      meta: { aType: ta, bType: tb, redactedA: outA.redacted, redactedB: outB.redacted },
    });
    stats.typeMismatch += 1;
    return;
  }

  if (ta === 'string') {
    if (!stringEquals(a as string, b as string, config)) {
      const outA = formatOutValue(path, a, config);
      const outB = formatOutValue(path, b, config);
      diffs.push({
        path,
        diffType: 'VALUE_MISMATCH',
        oldValue: outA.v,
        newValue: outB.v,
        message: i18n.global.t('tools.json_diff.string_diff'),
        severity: 'WARN',
      });
      stats.changed += 1;
    }
    return;
  }

  if (ta === 'number') {
    const aNum = a as number;
    const bNum = typeof b === 'string' && config.numericStringAsNumber ? Number(b) : (b as number);
    const bothNumbers = typeof bNum === 'number' && !Number.isNaN(aNum) && !Number.isNaN(bNum);
    const equal = bothNumbers
      ? numberWithinTolerance(aNum, bNum as number, config)
      : aNum === (b as number);
    if (!equal) {
      const outA = formatOutValue(path, a, config);
      const outB = formatOutValue(path, b, config);
      const msg = bothNumbers
        ? i18n.global.t('tools.json_diff.numeric_diff_tolerance', { a: aNum, b: bNum })
        : i18n.global.t('tools.json_diff.numeric_diff', { a: aNum, b });
      diffs.push({
        path,
        diffType: 'VALUE_MISMATCH',
        oldValue: outA.v,
        newValue: outB.v,
        message: msg,
        severity: 'WARN',
      });
      stats.changed += 1;
    }
    return;
  }

  if (ta === 'boolean' || ta === 'null') {
    if (a !== b) {
      const outA = formatOutValue(path, a, config);
      const outB = formatOutValue(path, b, config);
      diffs.push({
        path,
        diffType: 'VALUE_MISMATCH',
        oldValue: outA.v,
        newValue: outB.v,
        message: i18n.global.t('tools.json_diff.primitive_diff'),
        severity: 'WARN',
      });
      stats.changed += 1;
    }
    return;
  }

  if (ta === 'object') {
    const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]));
    keys.forEach((k) => {
      const nextPath = `${path}/${escapeJsonPointer(k)}`;
      compareNode(a?.[k], b?.[k], nextPath, config, diffs, stats, depth + 1);
    });
    return;
  }

  if (ta === 'array') {
    const arrA = a as any[];
    const arrB = b as any[];
    if (config.arrayStrategy === 'INDEX') {
      const min = Math.min(arrA.length, arrB.length);
      for (let i = 0; i < min; i += 1) {
        compareNode(arrA[i], arrB[i], `${path}/${i}`, config, diffs, stats, depth + 1);
      }
      if (arrA.length !== arrB.length) {
        diffs.push({
          path,
          diffType: 'ARRAY_LENGTH_MISMATCH',
          oldValue: arrA.length,
          newValue: arrB.length,
          message: i18n.global.t('tools.json_diff.array_length_diff', { a: arrA.length, b: arrB.length }),
          severity: 'WARN',
        });
        stats.arrayIssues += 1;
      }
      for (let i = min; i < arrA.length; i += 1) {
        const out = formatOutValue(`${path}/${i}`, arrA[i], config);
        diffs.push({
          path: `${path}/${i}`,
          diffType: 'MISSING_IN_B',
          oldValue: out.v,
          message: i18n.global.t('tools.json_diff.b_missing_index_element'),
          severity: 'WARN',
        });
        stats.removed += 1;
      }
      for (let i = min; i < arrB.length; i += 1) {
        const out = formatOutValue(`${path}/${i}`, arrB[i], config);
        diffs.push({
          path: `${path}/${i}`,
          diffType: 'EXTRA_IN_B',
          newValue: out.v,
          message: i18n.global.t('tools.json_diff.b_extra_index_element'),
          severity: 'WARN',
        });
        stats.added += 1;
      }
      return;
    }

    if (config.arrayStrategy === 'SET') {
      const multisetA = new Map<string, number>();
      const multisetB = new Map<string, number>();
      arrA.forEach((v) => {
        const fp = fingerprint(v);
        multisetA.set(fp, (multisetA.get(fp) || 0) + 1);
      });
      arrB.forEach((v) => {
        const fp = fingerprint(v);
        multisetB.set(fp, (multisetB.get(fp) || 0) + 1);
      });

      const allKeys = Array.from(new Set([...multisetA.keys(), ...multisetB.keys()]));
      allKeys.forEach((k) => {
        const ca = multisetA.get(k) || 0;
        const cb = multisetB.get(k) || 0;
        if (ca !== cb) {
          diffs.push({
            path,
            diffType: 'ARRAY_ELEMENT_MISMATCH',
            message: i18n.global.t('tools.json_diff.set_count_diff', { fingerprint: k, a: ca, b: cb }),
            severity: 'WARN',
            meta: { fingerprint: k, countA: ca, countB: cb },
          });
          stats.arrayIssues += 1;
        }
      });
      return;
    }

    if (config.arrayStrategy === 'KEYED') {
      const keyFields = config.arrayKeyFields;
      if (!keyFields || keyFields.length === 0) {
        diffs.push({
          path,
          diffType: 'ERROR',
          message: i18n.global.t('tools.json_diff.keyed_missing_key_fields'),
          severity: 'ERROR',
        });
        stats.errors += 1;
        return;
      }
      const makeKey = (el: any): string => {
        try {
          const obj = keyFields.reduce((acc, k) => {
            acc[k] = el?.[k];
            return acc;
          }, {} as Record<string, any>);
          return JSON.stringify(obj);
        } catch {
          return '';
        }
      };
      const mapA = new Map<string, any[]>();
      const mapB = new Map<string, any[]>();
      arrA.forEach((el, i) => {
        const k = makeKey(el);
        if (!k) {
          diffs.push({
            path: `${path}/${i}`,
            diffType: 'ERROR',
            message: i18n.global.t('tools.json_diff.element_missing_key'),
            severity: 'ERROR',
          });
          stats.errors += 1;
          return;
        }
        const list = mapA.get(k) || [];
        list.push(el);
        mapA.set(k, list);
      });
      arrB.forEach((el, i) => {
        const k = makeKey(el);
        if (!k) {
          diffs.push({
            path: `${path}/${i}`,
            diffType: 'ERROR',
            message: i18n.global.t('tools.json_diff.element_missing_key'),
            severity: 'ERROR',
          });
          stats.errors += 1;
          return;
        }
        const list = mapB.get(k) || [];
        list.push(el);
        mapB.set(k, list);
      });

      const allKeys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
      allKeys.forEach((k) => {
        const listA = mapA.get(k) || [];
        const listB = mapB.get(k) || [];
        if (listA.length === 0) {
          listB.forEach((el, i) => {
            const out = formatOutValue(`${path}/${i}`, el, config);
            diffs.push({
              path: path,
              diffType: 'EXTRA_IN_B',
              newValue: out.v,
              message: i18n.global.t('tools.json_diff.b_extra_unmatched'),
              severity: 'WARN',
              meta: { key: k, redacted: out.redacted },
            });
            stats.added += 1;
          });
          return;
        }
        if (listB.length === 0) {
          listA.forEach((el, i) => {
            const out = formatOutValue(`${path}/${i}`, el, config);
            diffs.push({
              path: path,
              diffType: 'MISSING_IN_B',
              oldValue: out.v,
              message: i18n.global.t('tools.json_diff.b_missing_unmatched'),
              severity: 'WARN',
              meta: { key: k, redacted: out.redacted },
            });
            stats.removed += 1;
          });
          return;
        }

        const min = Math.min(listA.length, listB.length);
        for (let i = 0; i < min; i += 1) {
          compareNode(listA[i], listB[i], `${path}/${i}`, config, diffs, stats, depth + 1);
        }
        if (listA.length !== listB.length) {
          const extra = listB.length - listA.length;
          diffs.push({
            path,
            diffType: 'ARRAY_LENGTH_MISMATCH',
            oldValue: listA.length,
            newValue: listB.length,
            message: i18n.global.t('tools.json_diff.keyed_group_count_diff', { a: listA.length, b: listB.length, key: k }),
            severity: 'WARN',
            meta: { key: k, extra },
          });
          stats.arrayIssues += 1;
        }
      });
      return;
    }
  }
};

/**
 * 对比两份 JSON，输出总体结论、统计与差异列表
 * @param jsonA 基准 JSON
 * @param jsonB 对比 JSON
 * @param config 可选配置
 */
export const compareJson = (jsonA: any, jsonB: any, config?: JsonDiffConfig): CompareResult => {
  const cfg: Required<JsonDiffConfig> = { ...DEFAULTS, ...(config || {}) };
  const diffs: DiffRecord[] = [];
  const stats = { added: 0, removed: 0, changed: 0, typeMismatch: 0, arrayIssues: 0, ignored: 0, errors: 0 };

  try {
    compareNode(jsonA, jsonB, '', cfg, diffs, stats, 0);
  } catch (e: any) {
    diffs.push({
      path: '',
      diffType: 'ERROR',
      message: e?.message || i18n.global.t('tools.json_diff.compare_exception'),
      severity: 'ERROR',
    });
    stats.errors += 1;
  }

  let truncated = false;
  if (diffs.length > cfg.maxDiffs) {
    diffs.splice(cfg.maxDiffs);
    truncated = true;
  }

  if (cfg.diffSort === 'severity') {
    const order = { ERROR: 3, WARN: 2, INFO: 1 } as Record<Severity, number>;
    diffs.sort((a, b) => {
      const os = order[b.severity] - order[a.severity];
      if (os !== 0) return os;
      return a.path.localeCompare(b.path);
    });
  } else {
    diffs.sort((a, b) => a.path.localeCompare(b.path));
  }

  const summary: CompareSummary = {
    added: stats.added,
    removed: stats.removed,
    changed: stats.changed,
    typeMismatch: stats.typeMismatch,
    arrayIssues: stats.arrayIssues,
    ignored: stats.ignored,
    errors: stats.errors,
    truncated,
  };

  const hasDiffs = diffs.length > 0;
  const overall: CompareResult['overall'] =
    stats.errors > 0
      ? 'different'
      : hasDiffs
      ? stats.changed + stats.added + stats.removed + stats.typeMismatch + stats.arrayIssues > 0
        ? 'partial'
        : 'identical'
      : 'identical';

  return { overall, summary, diffs };
};

export const jsonDiffTool: Tool = {
  metadata: {
    id: 'json-diff',
    name: 'tools.json_diff.name',
    description: 'tools.json_diff.description',
    icon: FileJson,
    keywords: ['json', 'diff', 'compare', 'audit'],
  },
  component: () => import('./JsonDiff.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const hasBrace = (s: string) => (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'));
    if (hasBrace(trimmed)) {
      try {
        JSON.parse(trimmed);
        return { toolId: 'json-diff', score: 70, matchedData: { a: trimmed } };
      } catch {
        // 尝试识别分隔的双 JSON：以 --- 分隔
        const parts = trimmed.split(/\n-{3,}\n/);
        if (parts.length === 2 && hasBrace(parts[0].trim()) && hasBrace(parts[1].trim())) {
          try {
            JSON.parse(parts[0].trim());
            JSON.parse(parts[1].trim());
            return { toolId: 'json-diff', score: 95, matchedData: { a: parts[0].trim(), b: parts[1].trim() } };
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  },
};

