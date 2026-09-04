import i18n from '@/i18n';
import { detectFormat, type DataFormat, type DetectedFormat, type DetectResult } from './detect';
import { flattenToProperties, parseProperties, stringifyProperties } from './properties';

export type { DataFormat, DetectedFormat, DetectResult };
export { detectFormat, flattenToProperties, parseProperties, stringifyProperties };

export const SUPPORTED_FORMATS: DetectedFormat[] = ['json', 'yaml', 'toml', 'xml', 'properties'];

export type ConvertOptions = {
  sourceFormat?: DataFormat;
  targetFormat: DetectedFormat;
  /** JSON / XML 缩进空格数，默认 2 */
  indent?: number;
};

export type ConvertSuccess = {
  ok: true;
  output: string;
  sourceFormat: DetectedFormat;
  targetFormat: DetectedFormat;
  /** 当复杂结构扁平化为 properties 时为 true */
  degraded: boolean;
  warning?: string;
};

export type ConvertFailure = {
  ok: false;
  error: string;
  sourceFormat?: DetectedFormat | null;
};

export type ConvertResult = ConvertSuccess | ConvertFailure;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const MISSING_DEP_HINT = i18n.global.t('tools.format_convert.engine_missing_dep_hint');

const loadYaml = async () => {
  try {
    return await import('yaml');
  } catch {
    throw new Error(i18n.global.t('tools.format_convert.yaml_unavailable', { hint: MISSING_DEP_HINT }));
  }
};

const loadToml = async () => {
  try {
    return await import('smol-toml');
  } catch {
    throw new Error(i18n.global.t('tools.format_convert.toml_unavailable', { hint: MISSING_DEP_HINT }));
  }
};

const loadXml = async () => {
  try {
    return await import('fast-xml-parser');
  } catch {
    throw new Error(i18n.global.t('tools.format_convert.xml_unavailable', { hint: MISSING_DEP_HINT }));
  }
};

const resolveSourceFormat = (input: string, preferred?: DataFormat): DetectedFormat | null => {
  if (preferred && preferred !== 'auto') {
    return preferred;
  }
  return detectFormat(input).format;
};

const parseJson = (text: string): JsonValue => {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.json_parse_fail', { message }));
  }
};

const parseYamlText = async (text: string): Promise<JsonValue> => {
  const yaml = await loadYaml();
  try {
    const parsed = yaml.parse(text);
    return parsed as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.yaml_parse_fail', { message }));
  }
};

const parseTomlText = async (text: string): Promise<JsonValue> => {
  const toml = await loadToml();
  try {
    return toml.parse(text) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.toml_parse_fail', { message }));
  }
};

const parseXmlText = async (text: string): Promise<JsonValue> => {
  const { XMLParser } = await loadXml();
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      allowBooleanAttributes: true,
      trimValues: true,
    });
    return parser.parse(text) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.xml_parse_fail', { message }));
  }
};

/**
 * 将源文本解析为中间 JSON 值。
 * @param text 源文本
 * @param format 源格式
 */
export const parseToValue = async (text: string, format: DetectedFormat): Promise<JsonValue> => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(i18n.global.t('tools.format_convert.empty_input'));
  }

  switch (format) {
    case 'json':
      return parseJson(trimmed);
    case 'yaml':
      return parseYamlText(trimmed);
    case 'toml':
      return parseTomlText(trimmed);
    case 'xml':
      return parseXmlText(trimmed);
    case 'properties':
      return parseProperties(trimmed);
    default:
      throw new Error(i18n.global.t('tools.format_convert.unsupported_source_format', { format }));
  }
};

const needsPropertiesDegrade = (value: JsonValue): boolean => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  return Object.values(value).some((item) => {
    if (item !== null && typeof item === 'object') {
      return true;
    }
    return false;
  });
};

const stringifyJson = (value: JsonValue, indent: number): string =>
  JSON.stringify(value, null, indent);

const stringifyYaml = async (value: JsonValue, indent: number): Promise<string> => {
  const yaml = await loadYaml();
  return yaml.stringify(value, { indent }).trimEnd();
};

const stringifyToml = async (value: JsonValue): Promise<string> => {
  const toml = await loadToml();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(i18n.global.t('tools.format_convert.toml_object_root_only'));
  }
  try {
    return toml.stringify(value as Record<string, unknown>).trimEnd();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.toml_serialize_fail', { message }));
  }
};

const stringifyXml = async (value: JsonValue, indent: number): Promise<string> => {
  const { XMLBuilder } = await loadXml();
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format: true,
    indentBy: ' '.repeat(Math.max(0, indent)),
    suppressEmptyNode: true,
  });

  let payload: Record<string, unknown>;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    payload = value as Record<string, unknown>;
  } else {
    payload = { root: value as unknown };
  }

  try {
    const body = builder.build(payload);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`.trimEnd();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(i18n.global.t('tools.format_convert.xml_serialize_fail', { message }));
  }
};

/**
 * 将中间值序列化为目标格式文本。
 * @param value 中间 JSON 值
 * @param format 目标格式
 * @param indent 缩进
 */
export const stringifyFromValue = async (
  value: JsonValue,
  format: DetectedFormat,
  indent = 2,
): Promise<{ text: string; degraded: boolean; warning?: string }> => {
  switch (format) {
    case 'json':
      return { text: stringifyJson(value, indent), degraded: false };
    case 'yaml':
      return { text: await stringifyYaml(value, indent), degraded: false };
    case 'toml':
      return { text: await stringifyToml(value), degraded: false };
    case 'xml':
      return { text: await stringifyXml(value, indent), degraded: false };
    case 'properties': {
      const degraded = needsPropertiesDegrade(value);
      return {
        text: stringifyProperties(value),
        degraded,
        warning: degraded ? i18n.global.t('tools.format_convert.warning_properties') : undefined,
      };
    }
    default:
      throw new Error(i18n.global.t('tools.format_convert.unsupported_target_format', { format }));
  }
};

/**
 * 在支持的数据格式之间转换。
 * @param input 源文本
 * @param options 转换选项
 */
export const convertFormat = async (
  input: string,
  options: ConvertOptions,
): Promise<ConvertResult> => {
  const indent = options.indent ?? 2;
  let sourceFormat: DetectedFormat | null = null;

  try {
    sourceFormat = resolveSourceFormat(input, options.sourceFormat);
    if (!sourceFormat) {
      return {
        ok: false,
        error: i18n.global.t('tools.format_convert.cannot_detect_source'),
        sourceFormat: null,
      };
    }

    if (sourceFormat === options.targetFormat && options.sourceFormat && options.sourceFormat !== 'auto') {
      // 同格式时仍重新格式化输出
    }

    const value = await parseToValue(input, sourceFormat);
    const serialized = await stringifyFromValue(value, options.targetFormat, indent);

    return {
      ok: true,
      output: serialized.text,
      sourceFormat,
      targetFormat: options.targetFormat,
      degraded: serialized.degraded,
      warning: serialized.warning,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      sourceFormat,
    };
  }
};

/**
 * 同步检测，供 match 与 UI 使用。
 * @param input 输入文本
 */
export const detectFormatSync = (input: string): DetectResult => detectFormat(input);
