/**
 * 文本处理管线：步骤类型定义与执行引擎（纯 TS，无 Vue 依赖）。
 *
 * - 现有 ProcessType 转换语义复用 `processText`（与旧行为严格一致）。
 * - 新增转换（title_case / sentence_case / html_encode / html_decode /
 *   markdown_to_plain / reverse / number_format / kebab 系列）在本文件内以纯函数实现。
 * - 批量操作委托 `batch.ts`；hash 步骤经 `deps.digestText` 异步执行（依赖注入，不耦合 hash-tool）。
 * - 统计步骤不改变文本流，只产出 `statsReport`。
 */
import i18n from '@/i18n';
import MarkdownIt from 'markdown-it';
import { processText, type ProcessType } from './index';
import { computeStats, type TextStats } from './stats';
import {
  batchReplace,
  columnExtract,
  lineDecorate,
  lineDedup,
  lineFilter,
  lineJoin,
  lineNumber,
  lineSplit,
} from './batch';

export type StepScope = 'whole' | 'line';

/**
 * 步骤操作联合类型：现有 ProcessType + 新增转换 + 批量 + hash + 统计。
 */
export type StepOp =
  | ProcessType
  | 'title_case'
  | 'sentence_case'
  | 'html_encode'
  | 'html_decode'
  | 'markdown_to_plain'
  | 'reverse'
  | 'number_format'
  | 'camel_to_kebab'
  | 'kebab_to_camel'
  | 'line_filter'
  | 'batch_replace'
  | 'column_extract'
  | 'line_number'
  | 'line_decorate'
  | 'line_dedup'
  | 'line_join'
  | 'line_split'
  | 'hash_md5'
  | 'hash_sha1'
  | 'hash_sha256'
  | 'hash_sha512'
  | 'stats';

export interface PipelineStep {
  /** 步骤实例 id（UUID，由调用方生成） */
  id: string;
  op: StepOp;
  scope: StepScope;
  params: Record<string, unknown>;
}

/** 异步依赖注入：hash 步骤经此调用外部摘要实现（避免引擎耦合 hash-tool）。 */
export interface StepDeps {
  digestText: (algorithm: string, text: string) => Promise<string>;
}

/** 统计步骤报告，复用 stats.ts 的 TextStats。 */
export type StatsReport = TextStats;

export interface PipelineResult {
  text: string;
  statsReport: StatsReport | null;
}

/** 现有 ProcessType 集合：语义委托给 processText。 */
const EXISTING_PROCESS_OPS = new Set<string>([
  'upper',
  'lower',
  'capitalize',
  'trim',
  'remove_space',
  'merge_empty_lines',
  'remove_escape',
  'base64_encode',
  'base64_decode',
  'url_encode',
  'url_decode',
  'utf8_encode',
  'utf8_decode',
  'snake_to_camel',
  'camel_to_snake',
  'full_to_half',
  'half_to_full',
]);

/** 批量操作：始终按行数组处理，与 scope 无关。 */
const BATCH_OPS = new Set<string>([
  'line_filter',
  'batch_replace',
  'column_extract',
  'line_number',
  'line_decorate',
  'line_dedup',
  'line_join',
  'line_split',
]);

const toBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1';

const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const toStringValue = (value: unknown): string =>
  typeof value === 'string' ? value : String(value ?? '');

// ---------- 新增转换：纯函数 ----------

/** 每个单词首字母大写，其余小写，保留分隔。 */
const titleCase = (text: string): string =>
  text.replace(/[\p{L}\p{N}]+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

/** 首个句首字母大写，其余不变。 */
const sentenceCase = (text: string): string =>
  text.replace(/^(\s*)(\p{L})/u, (_, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`);

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_UNESCAPE_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 转义 `& < > " '` 为 HTML 实体。 */
const htmlEncode = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);

/** 单遍解码命名实体与数字实体（十进制/十六进制）。 */
const decodeEntity = (full: string, entity: string): string => {
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const code = parseInt(entity.slice(2), 16);
    return Number.isNaN(code) ? full : String.fromCodePoint(code);
  }
  if (entity.startsWith('#')) {
    const code = parseInt(entity.slice(1), 10);
    return Number.isNaN(code) ? full : String.fromCodePoint(code);
  }
  return HTML_UNESCAPE_MAP[entity] ?? full;
};

/** 反转义 HTML 实体为原字符。 */
const htmlDecode = (text: string): string =>
  text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, decodeEntity);

/** markdown-it 单例：html 关闭（原始 HTML 视为文本），链接自动识别。 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * Markdown → 纯文本：渲染为 HTML 后剥离标签，再反转义实体。
 * 代码块保留代码文本；链接只取链接文字（不含 href）。
 */
const markdownToPlain = (text: string): string => {
  const html = md.render(text);
  const withoutTags = html.replace(/<[^>]*>/g, '');
  return htmlDecode(withoutTags);
};

/** 整段反转（按 Unicode code point）。 */
const reverseText = (text: string): string => [...text].reverse().join('');

/**
 * 对文本中的数字做千分位格式化。
 * 含小数部分时按 `params.decimals`（默认 2）保留小数位（四舍五入）；
 * 纯整数仅加千分位，不补小数。
 */
const numberFormat = (text: string, params: Record<string, unknown>): string => {
  const decimals = Math.max(0, toNumber(params.decimals, 2));
  return text.replace(/[+-]?\d+(?:\.\d+)?/g, (token) => {
    const sign = token.startsWith('-') ? '-' : token.startsWith('+') ? '+' : '';
    const unsigned = sign ? token.slice(1) : token;
    if (!unsigned.includes('.')) {
      return sign + unsigned.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    const [intPart, fracPart] = Number(unsigned).toFixed(decimals).split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + (decimals > 0 ? `${grouped}.${fracPart}` : grouped);
  });
};

const camelToKebab = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const kebabToCamel = (text: string): string =>
  text.replace(/-+([a-z])/g, (_, ch: string) => ch.toUpperCase());

// ---------- 执行引擎 ----------

/**
 * 单步错误：携带步骤序号（从 1 起）与操作类型，供调用方定位失败步骤。
 */
export class PipelineStepError extends Error {
  readonly stepIndex: number;
  readonly op: StepOp;

  constructor(stepIndex: number, op: StepOp, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(i18n.global.t('tools.text_processor.pipeline_step_failed', { step: stepIndex + 1, op, detail }));
    this.name = 'PipelineStepError';
    this.stepIndex = stepIndex;
    this.op = op;
  }
}

const splitLines = (text: string): string[] => text.replace(/\r\n/g, '\n').split('\n');

/** 批量步骤：整段文本拆行 → batch 函数逐行处理 → join('\n')。 */
const runBatchOp = (op: string, params: Record<string, unknown>, lines: string[]): string[] => {
  switch (op) {
    case 'line_filter':
      return lineFilter(lines, {
        mode: toStringValue(params.mode) === 'drop' ? 'drop' : 'keep',
        text: toStringValue(params.text),
        regex: toBoolean(params.regex),
        ignoreCase: toBoolean(params.ignoreCase),
      });
    case 'batch_replace':
      return batchReplace(lines, {
        find: toStringValue(params.find),
        replace: toStringValue(params.replace),
        regex: toBoolean(params.regex),
        global: toBoolean(params.global),
        ignoreCase: toBoolean(params.ignoreCase),
      });
    case 'column_extract':
      return columnExtract(lines, {
        delimiter: toStringValue(params.delimiter),
        index: toNumber(params.index, 0),
        ignoreEmpty: toBoolean(params.ignoreEmpty),
      });
    case 'line_number':
      return lineNumber(lines, {
        start: toNumber(params.start, 1),
        step: toNumber(params.step, 1),
        padding: Math.max(0, toNumber(params.padding, 0)),
      });
    case 'line_decorate':
      return lineDecorate(lines, {
        prefix: toStringValue(params.prefix),
        suffix: toStringValue(params.suffix),
      });
    case 'line_dedup':
      return lineDedup(lines, {
        trimLine: toBoolean(params.trimLine),
        ignoreCase: toBoolean(params.ignoreCase),
        removeEmpty: toBoolean(params.removeEmpty),
        sortOutput: toBoolean(params.sortOutput),
        // 默认保留首次出现顺序：参数缺失时不应退化为末次顺序
        keepOrder: params.keepOrder === undefined ? true : toBoolean(params.keepOrder),
      });
    case 'line_join':
      return lineJoin(lines, {
        // 参数缺失时保留 undefined，交由 lineJoin 默认英文逗号
        delimiter: params.delimiter === undefined ? undefined : toStringValue(params.delimiter),
        trimLine: toBoolean(params.trimLine),
        removeEmpty: toBoolean(params.removeEmpty),
        quote: toBoolean(params.quote),
        quoteChar: params.quoteChar === "'" ? "'" : '"',
      });
    case 'line_split':
      return lineSplit(lines, {
        // 参数缺失时保留 undefined，交由 lineSplit 默认英文逗号
        delimiter: params.delimiter === undefined ? undefined : toStringValue(params.delimiter),
        trimParts: toBoolean(params.trimParts),
        removeEmpty: toBoolean(params.removeEmpty),
      });
    default:
      throw new Error(`Unsupported batch operation: ${String(op)}`);
  }
};

/** 对单个文本片段应用一次操作（不含批量操作与 stats）。 */
const applyWhole = async (text: string, step: PipelineStep, deps: StepDeps): Promise<string> => {
  const { op, params } = step;

  if (EXISTING_PROCESS_OPS.has(op)) {
    return processText(text, op as ProcessType);
  }

  switch (op) {
    case 'title_case':
      return titleCase(text);
    case 'sentence_case':
      return sentenceCase(text);
    case 'html_encode':
      return htmlEncode(text);
    case 'html_decode':
      return htmlDecode(text);
    case 'markdown_to_plain':
      return markdownToPlain(text);
    case 'reverse':
      return reverseText(text);
    case 'number_format':
      return numberFormat(text, params);
    case 'camel_to_kebab':
      return camelToKebab(text);
    case 'kebab_to_camel':
      return kebabToCamel(text);
    case 'hash_md5':
      return deps.digestText('MD5', text);
    case 'hash_sha1':
      return deps.digestText('SHA-1', text);
    case 'hash_sha256':
      return deps.digestText('SHA-256', text);
    case 'hash_sha512':
      return deps.digestText('SHA-512', text);
    default:
      throw new Error(`Unsupported pipeline operation: ${String(op)}`);
  }
};

/**
 * 对文本应用单个步骤：批量操作按行数组处理；其余按 scope
 * （line 时按 `/\r?\n/` 拆行逐行应用再 `join('\n')`）。
 */
export const applyStep = async (
  text: string,
  step: PipelineStep,
  deps: StepDeps,
): Promise<string> => {
  const { op, params } = step;

  if (BATCH_OPS.has(op)) {
    return runBatchOp(op, params, splitLines(text)).join('\n');
  }

  if (step.scope === 'line') {
    const output: string[] = [];
    for (const line of splitLines(text)) {
      output.push(await applyWhole(line, step, deps));
    }
    return output.join('\n');
  }

  return applyWhole(text, step, deps);
};

/**
 * 依次应用所有步骤。stats 步骤不改变文本流，只产出 `statsReport`（统计
 * 当前文本在管线中该位置的状态）；单步抛错时抛出 `PipelineStepError`。
 */
export const runPipeline = async (
  text: string,
  steps: PipelineStep[],
  deps: StepDeps,
): Promise<PipelineResult> => {
  let current = text;
  let statsReport: TextStats | null = null;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    try {
      if (step.op === 'stats') {
        statsReport = computeStats(current, {
          topN: toNumber(step.params.topN, 10),
          ignoreCase: toBoolean(step.params.ignoreCase),
          ignoreWhitespace: toBoolean(step.params.ignoreWhitespace),
        });
      } else {
        current = await applyStep(current, step, deps);
      }
    } catch (cause) {
      throw new PipelineStepError(i, step.op, cause);
    }
  }

  return { text: current, statsReport };
};
