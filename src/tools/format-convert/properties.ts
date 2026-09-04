/**
 * 简易 Java Properties 解析与序列化。
 * 支持 key=value / key: value，# 与 ! 注释，\ 行续接。
 */

export type PropertiesObject = Record<string, string>;

const isCommentOrEmpty = (line: string) => {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith('#') || trimmed.startsWith('!');
};

/**
 * 解析 properties 文本为扁平对象。
 * @param text 源文本
 */
export const parseProperties = (text: string): PropertiesObject => {
  const result: PropertiesObject = {};
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let buffer = '';
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    // 续行：上一行以奇数个反斜杠结尾时拼接
    if (buffer) {
      line = buffer + line.replace(/^\s+/, '');
      buffer = '';
    }

    const endsWithContinuation = /(?<!\\)(?:\\\\)*\\$/.test(line);
    if (endsWithContinuation) {
      buffer = line.slice(0, -1);
      continue;
    }

    if (isCommentOrEmpty(line)) {
      continue;
    }

    let separatorIndex = -1;
    let separatorChar = '';
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '\\') {
        j += 1;
        continue;
      }
      if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t') {
        separatorIndex = j;
        separatorChar = ch;
        break;
      }
    }

    if (separatorIndex < 0) {
      const key = unescapeProperties(line.trim());
      if (key) {
        result[key] = '';
      }
      continue;
    }

    let key = line.slice(0, separatorIndex);
    let value = line.slice(separatorIndex + 1);

    // 跳过 key 与 value 之间的空白与重复分隔符
    if (separatorChar === ' ' || separatorChar === '\t') {
      value = value.replace(/^[\s=:]+/, '');
    } else {
      value = value.replace(/^\s+/, '');
    }

    key = unescapeProperties(key.trimEnd());
    value = unescapeProperties(value);
    if (key) {
      result[key] = value;
    }
  }

  return result;
};

/**
 * 将扁平对象序列化为 properties 文本。
 * @param data 数据（嵌套对象会先扁平化）
 */
export const stringifyProperties = (data: unknown): string => {
  const flat = flattenToProperties(data);
  const keys = Object.keys(flat).sort();
  return keys
    .map((key) => `${escapePropertiesKey(key)}=${escapePropertiesValue(flat[key])}`)
    .join('\n');
};

/**
 * 将任意 JSON 值扁平化为点号 key。
 * @param data 任意数据
 * @param prefix 前缀
 */
export const flattenToProperties = (data: unknown, prefix = ''): PropertiesObject => {
  const result: PropertiesObject = {};

  if (data === null || data === undefined) {
    if (prefix) {
      result[prefix] = '';
    }
    return result;
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    if (prefix) {
      result[prefix] = String(data);
    }
    return result;
  }

  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const nextKey = prefix ? `${prefix}.${index}` : String(index);
      Object.assign(result, flattenToProperties(item, nextKey));
    });
    return result;
  }

  if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      Object.assign(result, flattenToProperties(value, nextKey));
    }
    return result;
  }

  if (prefix) {
    result[prefix] = String(data);
  }
  return result;
};

const unescapeProperties = (value: string): string => {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '\\') {
      result += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === undefined) {
      break;
    }
    switch (next) {
      case 'n':
        result += '\n';
        break;
      case 't':
        result += '\t';
        break;
      case 'r':
        result += '\r';
        break;
      case 'u': {
        const hex = value.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          result += next;
        }
        break;
      }
      default:
        result += next;
    }
    i += 1;
  }
  return result;
};

const escapePropertiesKey = (key: string): string =>
  key
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/:/g, '\\:')
    .replace(/ /g, '\\ ')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

const escapePropertiesValue = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
