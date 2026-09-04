import i18n from '@/i18n';
import type { Tool } from '../interface';
import { FileText } from 'lucide-vue-next';
import type { StepOp, StepScope } from './steps';

export type ProcessType =
  | 'upper'
  | 'lower'
  | 'capitalize'
  | 'trim'
  | 'remove_space'
  | 'merge_empty_lines'
  | 'remove_escape'
  | 'base64_encode'
  | 'base64_decode'
  | 'url_encode'
  | 'url_decode'
  | 'utf8_encode'
  | 'utf8_decode'
  | 'snake_to_camel'
  | 'camel_to_snake'
  | 'full_to_half'
  | 'half_to_full';

// ---------------------------------------------------------------------------
// 管线步骤类别定义（TextProcessor.vue 的数据源）
// ---------------------------------------------------------------------------

export type StepCategoryValue =
  | 'case'
  | 'space'
  | 'encode'
  | 'naming'
  | 'char'
  | 'other'
  | 'batch'
  | 'hash'
  | 'stats';

export interface StepDefinition {
  /** 操作类型 */
  op: StepOp;
  /** i18n key 后缀：渲染为 `type_${label}` */
  label: string;
  /** 步骤默认作用域 */
  defaultScope: StepScope;
  /** 是否展示整段/逐行作用域切换（批量操作固定逐行、统计固定整段） */
  scopeSupported: boolean;
}

export interface StepCategoryDef {
  /** i18n key 后缀：渲染为 `cat_${label}` */
  label: string;
  value: StepCategoryValue;
  items: StepDefinition[];
}

const s = (
  op: StepOp,
  defaultScope: StepScope = 'whole',
  scopeSupported = true,
): StepDefinition => ({ op, label: op, defaultScope, scopeSupported });

export const STEP_CATEGORIES: StepCategoryDef[] = [
  {
    label: 'case',
    value: 'case',
    items: [s('upper'), s('lower'), s('capitalize'), s('title_case'), s('sentence_case')],
  },
  {
    label: 'space',
    value: 'space',
    items: [s('trim'), s('remove_space'), s('merge_empty_lines')],
  },
  {
    label: 'encode',
    value: 'encode',
    items: [
      s('remove_escape'),
      s('base64_encode'),
      s('base64_decode'),
      s('url_encode'),
      s('url_decode'),
      s('utf8_encode'),
      s('utf8_decode'),
      s('html_encode'),
      s('html_decode'),
    ],
  },
  {
    label: 'naming',
    value: 'naming',
    items: [s('snake_to_camel'), s('camel_to_snake'), s('camel_to_kebab'), s('kebab_to_camel')],
  },
  {
    label: 'char',
    value: 'char',
    items: [s('full_to_half'), s('half_to_full'), s('reverse')],
  },
  {
    label: 'other',
    value: 'other',
    items: [s('markdown_to_plain'), s('number_format')],
  },
  {
    label: 'batch',
    value: 'batch',
    items: [
      s('line_filter', 'line', false),
      s('batch_replace', 'line', false),
      s('column_extract', 'line', false),
      s('line_number', 'line', false),
      s('line_decorate', 'line', false),
      s('line_dedup', 'line', false),
      s('line_join', 'line', false),
      s('line_split', 'line', false),
    ],
  },
  {
    label: 'hash',
    value: 'hash',
    // hash 步骤固定整段作用域：逐行哈希输出多行摘要（合法但易误解），设计约定默认整段。
    items: [
      s('hash_md5', 'whole', false),
      s('hash_sha1', 'whole', false),
      s('hash_sha256', 'whole', false),
      s('hash_sha512', 'whole', false),
    ],
  },
  {
    label: 'stats',
    value: 'stats',
    items: [s('stats', 'whole', false)],
  },
];

/** 兼容旧导出：类别 + 操作列表（value 已放宽为 StepOp）。 */
export interface ProcessorCategory {
  label: string; // i18n key suffix
  value: string;
  items: {
    label: string; // i18n key suffix
    value: StepOp;
  }[];
}

export const PROCESSOR_CATEGORIES: ProcessorCategory[] = STEP_CATEGORIES.map((cat) => ({
  label: cat.label,
  value: cat.value,
  items: cat.items.map((item) => ({ label: item.label, value: item.op })),
}));

/** 各操作的默认参数（与 steps.ts 引擎默认值保持一致）。 */
export const STEP_DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  number_format: { decimals: 2 },
  line_filter: { mode: 'keep', text: '', regex: false, ignoreCase: false },
  batch_replace: { find: '', replace: '', regex: false, global: true, ignoreCase: false },
  column_extract: { delimiter: ',', index: 0, ignoreEmpty: false },
  line_number: { start: 1, step: 1, padding: 0 },
  line_decorate: { prefix: '', suffix: '' },
  line_dedup: { trimLine: false, ignoreCase: false, removeEmpty: false, sortOutput: false, keepOrder: true },
  line_join: { delimiter: ',', trimLine: false, removeEmpty: false, quote: false, quoteChar: '"' },
  line_split: { delimiter: ',', trimParts: false, removeEmpty: false },
  stats: { topN: 10, ignoreCase: false, ignoreWhitespace: false },
};

export interface StepParamField {
  key: string;
  type: 'text' | 'number' | 'checkbox' | 'select';
  /** i18n key 后缀：渲染为 `param_${label}`（select 选项与占位符另见 options/placeholder） */
  label: string;
  options?: { value: string | number | boolean; label: string }[];
  /** i18n key 后缀：渲染为 `ph_${placeholder}` */
  placeholder?: string;
}

/** 各操作的参数表单字段描述（无字段的操作不渲染参数区）。 */
export const STEP_PARAM_FIELDS: Record<string, StepParamField[]> = {
  number_format: [{ key: 'decimals', type: 'number', label: 'param_decimals' }],
  line_filter: [
    {
      key: 'mode',
      type: 'select',
      label: 'param_mode',
      options: [
        { value: 'keep', label: 'param_keep' },
        { value: 'drop', label: 'param_drop' },
      ],
    },
    { key: 'text', type: 'text', label: 'param_keyword', placeholder: 'ph_keyword' },
    { key: 'regex', type: 'checkbox', label: 'param_regex' },
    { key: 'ignoreCase', type: 'checkbox', label: 'param_ignore_case' },
  ],
  batch_replace: [
    { key: 'find', type: 'text', label: 'param_find', placeholder: 'ph_find' },
    { key: 'replace', type: 'text', label: 'param_replace', placeholder: 'ph_replace' },
    { key: 'regex', type: 'checkbox', label: 'param_regex' },
    { key: 'global', type: 'checkbox', label: 'param_global' },
    { key: 'ignoreCase', type: 'checkbox', label: 'param_ignore_case' },
  ],
  column_extract: [
    { key: 'delimiter', type: 'text', label: 'param_delimiter', placeholder: 'ph_delimiter' },
    { key: 'index', type: 'number', label: 'param_column_index' },
    { key: 'ignoreEmpty', type: 'checkbox', label: 'param_ignore_empty' },
  ],
  line_number: [
    { key: 'start', type: 'number', label: 'param_start' },
    { key: 'step', type: 'number', label: 'param_step' },
    { key: 'padding', type: 'number', label: 'param_padding' },
  ],
  line_decorate: [
    { key: 'prefix', type: 'text', label: 'param_prefix', placeholder: 'ph_prefix' },
    { key: 'suffix', type: 'text', label: 'param_suffix', placeholder: 'ph_suffix' },
  ],
  line_dedup: [
    { key: 'keepOrder', type: 'checkbox', label: 'param_keep_order' },
    { key: 'ignoreCase', type: 'checkbox', label: 'param_ignore_case' },
    { key: 'trimLine', type: 'checkbox', label: 'param_trim_line' },
    { key: 'removeEmpty', type: 'checkbox', label: 'param_remove_empty' },
    { key: 'sortOutput', type: 'checkbox', label: 'param_sort_output' },
  ],
  line_join: [
    { key: 'delimiter', type: 'text', label: 'param_delimiter', placeholder: 'ph_delimiter' },
    { key: 'quote', type: 'checkbox', label: 'param_quote' },
    {
      key: 'quoteChar',
      type: 'select',
      label: 'param_quote_char',
      options: [
        { value: '"', label: 'param_quote_double' },
        { value: "'", label: 'param_quote_single' },
      ],
    },
    { key: 'trimLine', type: 'checkbox', label: 'param_trim_line' },
    { key: 'removeEmpty', type: 'checkbox', label: 'param_remove_empty' },
  ],
  line_split: [
    { key: 'delimiter', type: 'text', label: 'param_delimiter', placeholder: 'ph_delimiter' },
    { key: 'trimParts', type: 'checkbox', label: 'param_trim_parts' },
    { key: 'removeEmpty', type: 'checkbox', label: 'param_remove_empty_parts' },
  ],
  stats: [
    { key: 'topN', type: 'number', label: 'param_top_n' },
    { key: 'ignoreCase', type: 'checkbox', label: 'param_ignore_case' },
    { key: 'ignoreWhitespace', type: 'checkbox', label: 'param_ignore_whitespace' },
  ],
};

// ---------------------------------------------------------------------------
// 现有转换逻辑（保留：processText 仍被 useQuickActions / steps.ts / 测试引用）
// ---------------------------------------------------------------------------

const ESCAPED_SEQUENCE_RE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/;

const hasEscapedSequence = (text: string) => ESCAPED_SEQUENCE_RE.test(text);

const wrapEscapedTextAsJsonString = (text: string) =>
  `"${text
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;

const stringifyParsedValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
};

const unwrapParsedString = (value: string): unknown => {
  let current: unknown = value;

  for (let i = 0; i < 10; i += 1) {
    if (typeof current !== 'string') {
      return current;
    }

    const trimmed = current.trim();
    if (!trimmed) {
      return current;
    }

    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }

  return current;
};

/**
 * 还原 JSON 字符串中的转义内容。
 * 优先处理完整 JSON 字符串值，其次兼容直接复制出的转义文本片段。
 */
export const removeEscapes = (text: string): string => {
  const trimmed = text.trim();

  if (!trimmed) {
    return text;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return stringifyParsedValue(unwrapParsedString(parsed));
    }

    return text;
  } catch {
    if (!hasEscapedSequence(text)) {
      return text;
    }
  }

  try {
    return stringifyParsedValue(unwrapParsedString(JSON.parse(wrapEscapedTextAsJsonString(text))));
  } catch {
    throw new Error(i18n.global.t('tools.text_processor.error_invalid_escaped_string'));
  }
};

/**
 * 核心处理函数
 */
export const processText = (text: string, type: ProcessType): string => {
  if (!text) return '';

  switch (type) {
    // Case
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/(?:^|\n|[\s])\S/g, (a) => a.toUpperCase()); // 简单的首字母大写

    // Space
    case 'trim':
      return text.trim();
    case 'remove_space':
      return text.replace(/\s+/g, '');
    case 'merge_empty_lines':
      return text.replace(/\n\s*\n/g, '\n');

    // Encode
    case 'remove_escape':
      return removeEscapes(text);
    case 'base64_encode':
      try {
        return btoa(unescape(encodeURIComponent(text)));
      } catch {
        throw new Error(i18n.global.t('tools.text_processor.error_base64_encode_failed'));
      }
    case 'base64_decode':
      try {
        return decodeURIComponent(escape(atob(text)));
      } catch {
        throw new Error(i18n.global.t('tools.text_processor.error_invalid_base64_string'));
      }
    case 'url_encode':
      return encodeURIComponent(text);
    case 'url_decode':
      try {
        return decodeURIComponent(text);
      } catch {
        throw new Error(i18n.global.t('tools.text_processor.error_invalid_url_encoded_string'));
      }
    case 'utf8_encode':
      try {
        if (typeof TextEncoder === 'undefined') throw new Error(i18n.global.t('tools.text_processor.error_encoder_not_supported'));
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        // 展示为十六进制用空格分隔
        return Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ');
      } catch {
        throw new Error(i18n.global.t('tools.text_processor.error_utf8_encode_failed'));
      }
    case 'utf8_decode':
      try {
        if (typeof TextDecoder === 'undefined') throw new Error(i18n.global.t('tools.text_processor.error_decoder_not_supported'));
        const cleaned = text.trim();
        // 支持以空格或逗号分隔的十六进制字节
        const parts = cleaned.split(/[\s,]+/).filter(Boolean);
        const bytes = new Uint8Array(parts.map((p) => parseInt(p, 16)));
        const decoder = new TextDecoder('utf-8', { fatal: true });
        return decoder.decode(bytes);
      } catch {
        throw new Error(i18n.global.t('tools.text_processor.error_invalid_utf8_bytes'));
      }

    // Naming
    case 'snake_to_camel':
      return text.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace('-', '').replace('_', '')
      );
    case 'camel_to_snake':
      return text.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');

    // Character
    case 'full_to_half':
      return text.replace(/[！-～]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
      ).replace(/\u3000/g, ' ');

    case 'half_to_full':
      return text.replace(/[\x21-\x7e]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) + 0xfee0)
      ).replace(/ /g, '\u3000');

    default:
      return text;
  }
};

export const textProcessorTool: Tool = {
  metadata: {
    id: 'text-processor',
    name: 'tools.text_processor.name',
    description: 'tools.text_processor.description',
    icon: FileText,
    keywords: [
      'text', 'process', 'convert', 'case', 'upper', 'lower', 'capitalize', 'title',
      'base64', 'url', 'trim', 'encode', 'decode', 'escape', 'json',
      'html', 'markdown', 'md', 'reverse', 'number', 'format', 'kebab', 'camel', 'snake',
      'filter', 'replace', 'column', 'line', 'numbering', 'stats', 'hash', 'md5', 'sha',
      'dedup', 'unique', 'join', 'merge', 'delimiter', 'split',
      '摘要', '统计', '批量', '过滤', '替换', '行号', '转义', '去重', '拼接', '合并', '分割',
    ],
  },
  component: () => import('./TextProcessor.vue'),
  match: (input: string) => {
    if (!input || input.trim().length === 0) return null;

    const trimmed = input.trim();
    const looksEscapedJsonString = (() => {
      if (!hasEscapedSequence(trimmed)) return false;

      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || trimmed.includes('\\"')) {
        return true;
      }

      return trimmed.startsWith('{\\') || trimmed.startsWith('[\\');
    })();

    const looksBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 20 && !trimmed.includes(' ');
    const looksUrlEncoded = /%[0-9a-fA-F]{2}/.test(trimmed) || (trimmed.includes('+') && trimmed.includes('%'));
    const looksUtf8Hex = (() => {
      const parts = trimmed.split(/[\s,]+/).filter(Boolean);
      if (parts.length < 2) return false;
      return parts.every(p => /^[0-9a-fA-F]{2}$/.test(p));
    })();

    if (looksEscapedJsonString) {
      return {
        toolId: 'text-processor',
        score: 80,
        matchedData: { presetType: 'remove_escape', raw: input },
      };
    }

    if (looksUrlEncoded) {
      return {
        toolId: 'text-processor',
        score: 75,
        matchedData: { presetType: 'url_decode', raw: input },
      };
    }

    if (looksUtf8Hex) {
      return {
        toolId: 'text-processor',
        score: 70,
        matchedData: { presetType: 'utf8_decode', raw: input },
      };
    }

    if (looksBase64) {
      return {
        toolId: 'text-processor',
        score: 60,
        matchedData: { presetType: 'base64_decode', raw: input },
      };
    }

    return {
      toolId: 'text-processor',
      score: 10,
      matchedData: { raw: input },
    };
  },
};
