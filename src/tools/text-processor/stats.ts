/**
 * 文本统计引擎（纯函数，无 Vue 依赖）。
 *
 * - 字符按 Unicode code point 计数（`[...text]`）。
 * - 中文字符用 `\p{Script=Han}`，单词用 `[\p{L}\p{N}]+`（连续中文天然视为一个词）。
 * - 段落以空行分隔；最长行保留完整文本与长度。
 */
export interface TextStats {
  /** 总字符数（按 Unicode code point 计数） */
  chars: number;
  /** 不含空白字符数 */
  charsNoSpace: number;
  /** 单词数（字母/数字序列，连续中文计为单个词） */
  words: number;
  /** 行数（按换行符切分，空文本计 1 行） */
  lines: number;
  /** 段落数（空行分隔） */
  paragraphs: number;
  /** 中文字符数（\p{Script=Han}） */
  chineseChars: number;
  /** Top N 字符频率（按计数降序，同频按字符升序） */
  topChars: Array<{ char: string; count: number }>;
  /** 最长行 */
  longestLine: { text: string; length: number };
}

export interface StatsOptions {
  /** 字符频率 Top N，默认 10 */
  topN?: number;
  /** 字符频率统计是否忽略大小写，默认 false */
  ignoreCase?: boolean;
  /** 字符频率统计是否忽略空白，默认 false */
  ignoreWhitespace?: boolean;
}

const WHITESPACE_RE = /\s/;

const countParagraphs = (text: string): number => {
  let count = 0;
  let inParagraph = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      inParagraph = false;
    } else if (!inParagraph) {
      count += 1;
      inParagraph = true;
    }
  }
  return count;
};

const computeTopChars = (
  text: string,
  topN: number,
  ignoreCase: boolean,
  ignoreWhitespace: boolean,
): Array<{ char: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const raw of [...text]) {
    if (ignoreWhitespace && WHITESPACE_RE.test(raw)) {
      continue;
    }
    const key = ignoreCase ? raw.toLocaleLowerCase() : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([char, count]) => ({ char, count }))
    .sort((a, b) => b.count - a.count || a.char.localeCompare(b.char))
    .slice(0, topN);
};

const computeLongestLine = (text: string): { text: string; length: number } => {
  let best = { text: '', length: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (line.length > best.length) {
      best = { text: line, length: line.length };
    }
  }
  return best;
};

export const computeStats = (text: string, opts: StatsOptions = {}): TextStats => {
  const topN = Math.max(0, opts.topN ?? 10);
  const ignoreCase = opts.ignoreCase ?? false;
  const ignoreWhitespace = opts.ignoreWhitespace ?? false;

  const chars = [...text].length;
  const charsNoSpace = [...text].filter((ch) => !WHITESPACE_RE.test(ch)).length;
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const lines = text.split(/\r?\n/).length;
  const paragraphs = countParagraphs(text);
  const chineseChars = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const topChars = computeTopChars(text, topN, ignoreCase, ignoreWhitespace);
  const longestLine = computeLongestLine(text);

  return {
    chars,
    charsNoSpace,
    words,
    lines,
    paragraphs,
    chineseChars,
    topChars,
    longestLine,
  };
};
