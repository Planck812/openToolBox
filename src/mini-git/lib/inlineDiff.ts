export interface HighlightRange {
  start: number;
  end: number;
}

export interface InlineDiffResult {
  oldHighlights: HighlightRange[];
  newHighlights: HighlightRange[];
}

interface Token {
  text: string;
  start: number;
  end: number;
}

const MAX_LINE_CHAR_LIMIT = 10000;
const MAX_TOKEN_LIMIT = 1000;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /\w+|[^\s\w]|\s+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Merge adjacent or overlapping highlight ranges.
 */
function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length <= 1) return ranges;
  const merged: HighlightRange[] = [];
  let current = { ...ranges[0] };

  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Computes word-level inline differences between two modified lines.
 * Skips computation if either line exceeds 10,000 characters (returns empty highlights).
 */
export function computeInlineDiff(oldStr: string, newStr: string): InlineDiffResult {
  if (oldStr.length > MAX_LINE_CHAR_LIMIT || newStr.length > MAX_LINE_CHAR_LIMIT) {
    return { oldHighlights: [], newHighlights: [] };
  }

  if (oldStr === newStr) {
    return { oldHighlights: [], newHighlights: [] };
  }

  if (oldStr.length === 0) {
    return {
      oldHighlights: [],
      newHighlights: newStr.length > 0 ? [{ start: 0, end: newStr.length }] : [],
    };
  }

  if (newStr.length === 0) {
    return {
      oldHighlights: oldStr.length > 0 ? [{ start: 0, end: oldStr.length }] : [],
      newHighlights: [],
    };
  }

  const oldTokens = tokenize(oldStr);
  const newTokens = tokenize(newStr);

  if (oldTokens.length > MAX_TOKEN_LIMIT || newTokens.length > MAX_TOKEN_LIMIT) {
    return {
      oldHighlights: [{ start: 0, end: oldStr.length }],
      newHighlights: [{ start: 0, end: newStr.length }],
    };
  }

  const m = oldTokens.length;
  const n = newTokens.length;

  // dp[i][j] stores the length of LCS of oldTokens[0..i-1] and newTokens[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1].text === newTokens[j - 1].text) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find unchanged token indices
  const oldMatched = new Set<number>();
  const newMatched = new Set<number>();

  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1].text === newTokens[j - 1].text) {
      oldMatched.add(i - 1);
      newMatched.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const rawOldHighlights: HighlightRange[] = [];
  for (let idx = 0; idx < m; idx++) {
    if (!oldMatched.has(idx)) {
      rawOldHighlights.push({ start: oldTokens[idx].start, end: oldTokens[idx].end });
    }
  }

  const rawNewHighlights: HighlightRange[] = [];
  for (let idx = 0; idx < n; idx++) {
    if (!newMatched.has(idx)) {
      rawNewHighlights.push({ start: newTokens[idx].start, end: newTokens[idx].end });
    }
  }

  return {
    oldHighlights: mergeRanges(rawOldHighlights),
    newHighlights: mergeRanges(rawNewHighlights),
  };
}
