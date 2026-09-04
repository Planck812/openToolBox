/**
 * 行级批量处理引擎（全部同步纯函数，逐行处理，无 Vue 依赖）。
 *
 * 所有函数入参为 string[]（调用方按 `/\r?\n/` 拆行），返回 string[]。
 * 行为在 `batch.test.ts` 中锁定，供 `steps.ts` 的批量步骤委托调用。
 */

export interface LineFilterOptions {
  /** keep：保留命中行；drop：剔除命中行 */
  mode: 'keep' | 'drop';
  /** 关键词或正则表达式文本 */
  text: string;
  /** 是否按正则匹配（非法正则抛错） */
  regex?: boolean;
  ignoreCase?: boolean;
}

/**
 * 保留 / 剔除包含关键词或正则匹配的行。
 */
export const lineFilter = (lines: string[], options: LineFilterOptions): string[] => {
  const { mode, text, regex = false, ignoreCase = false } = options;

  if (!text) {
    return [...lines];
  }

  const matches = (line: string): boolean => {
    if (regex) {
      const flags = ignoreCase ? 'i' : '';
      return new RegExp(text, flags).test(line);
    }
    const haystack = ignoreCase ? line.toLowerCase() : line;
    const needle = ignoreCase ? text.toLowerCase() : text;
    return haystack.includes(needle);
  };

  return mode === 'keep' ? lines.filter(matches) : lines.filter((line) => !matches(line));
};

export interface BatchReplaceOptions {
  /** 查找文本（regex 时为正则模式串） */
  find: string;
  /** 替换文本 */
  replace: string;
  regex?: boolean;
  /** 是否替换全部；非正则时 false 仅替换首个，正则时强制带 g */
  global?: boolean;
  ignoreCase?: boolean;
}

/**
 * 对每行执行查找替换。正则用 `new RegExp(find, flags)`（global 强制 g），
 * 非正则用字面量替换（首处或全部由 global 决定）。
 */
export const batchReplace = (lines: string[], options: BatchReplaceOptions): string[] => {
  const { find, replace, regex = false, global = true, ignoreCase = false } = options;

  if (!find) {
    return [...lines];
  }

  return lines.map((line) => {
    if (regex) {
      const flags = `${global ? 'g' : ''}${ignoreCase ? 'i' : ''}`;
      return line.replace(new RegExp(find, flags), replace);
    }
    return global ? line.split(find).join(replace) : line.replace(find, replace);
  });
};

export interface ColumnExtractOptions {
  delimiter: string;
  /** 提取列下标；支持负数（从右数，-1 为最后一列），越界输出空串 */
  index: number;
  /** 跳过空行（不输出） */
  ignoreEmpty?: boolean;
}

/**
 * 按分隔符拆行后提取第 N 列。
 */
export const columnExtract = (lines: string[], options: ColumnExtractOptions): string[] => {
  const { delimiter, index, ignoreEmpty = false } = options;
  const result: string[] = [];

  for (const line of lines) {
    if (ignoreEmpty && line.trim() === '') {
      continue;
    }
    const parts = line.split(delimiter);
    const idx = index < 0 ? parts.length + index : index;
    result.push(idx >= 0 && idx < parts.length ? parts[idx] : '');
  }

  return result;
};

export interface LineNumberOptions {
  /** 起始序号，默认 1 */
  start?: number;
  /** 步长，默认 1 */
  step?: number;
  /** 补零位数，默认 0（不补零） */
  padding?: number;
}

/**
 * 每行添加行号，格式 `${label}\t${line}`。
 */
export const lineNumber = (lines: string[], options: LineNumberOptions = {}): string[] => {
  const start = options.start ?? 1;
  const step = options.step ?? 1;
  const padding = Math.max(0, options.padding ?? 0);

  return lines.map((line, i) => {
    const label = String(start + i * step).padStart(padding, '0');
    return `${label}\t${line}`;
  });
};

export interface LineDecorateOptions {
  prefix?: string;
  suffix?: string;
}

/**
 * 每行添加前缀/后缀。
 */
export const lineDecorate = (lines: string[], options: LineDecorateOptions = {}): string[] => {
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  return lines.map((line) => `${prefix}${line}${suffix}`);
};

export interface LineDedupOptions {
  /** 去重前 trim 行（trim 后的行内容写入输出） */
  trimLine?: boolean;
  /** 比较时忽略大小写（保留首次出现的行原文） */
  ignoreCase?: boolean;
  /** 过滤空行 */
  removeEmpty?: boolean;
  /** 输出按字典序排序（覆盖 keepOrder） */
  sortOutput?: boolean;
  /** true：保留首次出现顺序；false：保留末次出现顺序 */
  keepOrder?: boolean;
}

/**
 * 按行去重。默认保留首次出现顺序且精确匹配；
 * `ignoreCase` 时去重键忽略大小写，输出仍为首次出现的行原文。
 */
export const lineDedup = (lines: string[], options: LineDedupOptions = {}): string[] => {
  const {
    trimLine = false,
    ignoreCase = false,
    removeEmpty = false,
    sortOutput = false,
    keepOrder = true,
  } = options;

  const keyOf = (line: string): string => (ignoreCase ? line.toLowerCase() : line);
  const normalize = (line: string): string => (trimLine ? line.trim() : line);
  const seen = new Set<string>();
  const result: string[] = [];

  const collect = (line: string): void => {
    const value = normalize(line);
    if (removeEmpty && !value) {
      return;
    }
    const key = keyOf(value);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(value);
  };

  if (keepOrder) {
    for (const line of lines) {
      collect(line);
    }
  } else {
    // 保留末次出现顺序：逆序遍历后反转
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      collect(lines[i]);
    }
    result.reverse();
  }

  if (sortOutput) {
    result.sort((a, b) => a.localeCompare(b));
  }

  return result;
};

export interface LineJoinOptions {
  /** 拼接分隔符，默认英文逗号 */
  delimiter?: string;
  /** 拼接前是否 trim 每行 */
  trimLine?: boolean;
  /** 跳过空行 */
  removeEmpty?: boolean;
  /** 是否给每个元素加引号包裹 */
  quote?: boolean;
  /** 引号字符，仅 quote 为 true 时生效 */
  quoteChar?: '"' | "'";
}

/**
 * 将各行拼接为单个字符串（结果始终为单元素数组）。
 * 开启 quote 时元素内出现的引号字符用反斜杠转义。
 */
export const lineJoin = (lines: string[], options: LineJoinOptions = {}): string[] => {
  const {
    delimiter = ',',
    trimLine = false,
    removeEmpty = false,
    quote = false,
    quoteChar = '"',
  } = options;

  const parts: string[] = [];
  for (const raw of lines) {
    const line = trimLine ? raw.trim() : raw;
    if (removeEmpty && !line) {
      continue;
    }
    if (quote) {
      const escaped = line.split(quoteChar).join(`\\${quoteChar}`);
      parts.push(`${quoteChar}${escaped}${quoteChar}`);
    } else {
      parts.push(line);
    }
  }

  return [parts.join(delimiter)];
};

export interface LineSplitOptions {
  /** 拆分分隔符，默认英文逗号 */
  delimiter?: string;
  /** 拆分后是否 trim 每个片段 */
  trimParts?: boolean;
  /** 过滤空片段 */
  removeEmpty?: boolean;
}

/**
 * 将每行按分隔符拆分为多个片段，展开输出为单列（结果元素数可能多于入参行数）。
 * 空字符串分隔符按 Unicode 码点拆分（即逐字符拆分）。
 */
export const lineSplit = (lines: string[], options: LineSplitOptions = {}): string[] => {
  const { delimiter = ',', trimParts = false, removeEmpty = false } = options;

  const parts: string[] = [];
  for (const line of lines) {
    for (const segment of line.split(delimiter)) {
      const value = trimParts ? segment.trim() : segment;
      if (removeEmpty && !value) {
        continue;
      }
      parts.push(value);
    }
  }

  return parts;
};
