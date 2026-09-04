export type DataFormat = 'json' | 'yaml' | 'toml' | 'xml' | 'properties' | 'auto';

export type DetectedFormat = Exclude<DataFormat, 'auto'>;

export type DetectResult = {
  format: DetectedFormat | null;
  confidence: number;
  reasons: string[];
};

const looksLikeJson = (text: string): boolean => {
  if (!(text.startsWith('{') || text.startsWith('['))) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const looksLikeXml = (text: string): boolean => {
  if (text.startsWith('<?xml') || /^<[A-Za-z_!][\s\S]*>[\s\S]*<\/[A-Za-z_][\w:.-]*>\s*$/.test(text)) {
    return true;
  }
  return /^<[A-Za-z_][\w:.-]*(\s[^>]*)?>[\s\S]*<\/[A-Za-z_][\w:.-]*>\s*$/.test(text);
};

const looksLikeYaml = (text: string): boolean => {
  if (text.startsWith('---') || text.startsWith('...')) {
    return true;
  }
  // 多行 key: value，且无 = 主导的 properties 形态
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  let yamlish = 0;
  let listish = 0;
  for (const line of lines.slice(0, 40)) {
    if (line.startsWith('#') || line === '---' || line === '...') {
      yamlish += 1;
      continue;
    }
    if (/^-\s+\S/.test(line) || /^-\s*$/.test(line)) {
      listish += 1;
      continue;
    }
    if (/^[A-Za-z_][\w.-]*:\s*(#.*)?$/.test(line) || /^[A-Za-z_][\w.-]*:\s+\S/.test(line)) {
      yamlish += 1;
      continue;
    }
    if (/^\s+[A-Za-z_][\w.-]*:/.test(line)) {
      yamlish += 1;
    }
  }

  return yamlish + listish >= 2 || (yamlish >= 1 && lines.length >= 2);
};

const looksLikeToml = (text: string): boolean => {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) {
    return false;
  }

  let score = 0;
  for (const line of lines.slice(0, 40)) {
    if (/^\[[\w.-]+\]$/.test(line) || /^\[[\w.-]+\.[^\]]+\]$/.test(line)) {
      score += 2;
      continue;
    }
    if (/^[\w.-]+\s*=\s*/.test(line)) {
      score += 1;
    }
  }
  return score >= 2;
};

const looksLikeProperties = (text: string): boolean => {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));

  if (lines.length === 0) {
    return false;
  }

  let matched = 0;
  for (const line of lines.slice(0, 40)) {
    if (/^[^=:\s][^=:]*[=:][^=].*$/.test(line) || /^[^=:\s][^=:]*=\s*.*$/.test(line)) {
      matched += 1;
    }
  }
  return matched >= Math.max(1, Math.ceil(lines.length * 0.5));
};

/**
 * 自动检测输入文本的数据格式。
 * @param input 原始文本
 */
export const detectFormat = (input: string): DetectResult => {
  const text = input.trim();
  if (!text) {
    return { format: null, confidence: 0, reasons: ['empty'] };
  }

  if (looksLikeJson(text)) {
    return { format: 'json', confidence: 95, reasons: ['json-parse'] };
  }

  if (looksLikeXml(text)) {
    return { format: 'xml', confidence: 90, reasons: ['xml-tag'] };
  }

  const yaml = looksLikeYaml(text);
  const toml = looksLikeToml(text);
  const props = looksLikeProperties(text);

  // TOML 表头特征更强
  if (toml && text.includes('[')) {
    const hasSection = /^\s*\[[\w.-]+\]/m.test(text);
    if (hasSection) {
      return { format: 'toml', confidence: 88, reasons: ['toml-table'] };
    }
  }

  if (yaml && !props) {
    return { format: 'yaml', confidence: 80, reasons: ['yaml-mapping'] };
  }

  if (props && !yaml) {
    return { format: 'properties', confidence: 78, reasons: ['key-value-lines'] };
  }

  if (yaml && props) {
    // 同时像 yaml 与 properties 时：含缩进列表/多级缩进偏向 yaml，否则 properties
    if (/^\s{2,}\S/m.test(text) || /^-\s/m.test(text) || text.includes(': ')) {
      return { format: 'yaml', confidence: 70, reasons: ['yaml-over-properties'] };
    }
    return { format: 'properties', confidence: 70, reasons: ['properties-over-yaml'] };
  }

  if (toml) {
    return { format: 'toml', confidence: 72, reasons: ['toml-kv'] };
  }

  if (yaml) {
    return { format: 'yaml', confidence: 65, reasons: ['yaml-weak'] };
  }

  if (props) {
    return { format: 'properties', confidence: 65, reasons: ['properties-weak'] };
  }

  return { format: null, confidence: 0, reasons: ['unknown'] };
};
