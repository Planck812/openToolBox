export type DiffTokenType = 'equal' | 'add' | 'remove';
export type DiffLineType = 'equal' | 'add' | 'remove' | 'modify';

export interface DiffToken {
  text: string;
  type: DiffTokenType;
}

export interface DiffLine {
  type: DiffLineType;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string;
  rightText: string;
  leftTokens?: DiffToken[];
  rightTokens?: DiffToken[];
  leftPlaceholder: boolean;
  rightPlaceholder: boolean;
}

export interface TextDiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

type SequenceOp = {
  type: 'equal' | 'add' | 'remove';
  leftIndex?: number;
  rightIndex?: number;
};

const splitLines = (source: string): string[] => (source === '' ? [] : source.replace(/\r\n/g, '\n').split('\n'));

const normalize = (value: string, options: TextDiffOptions): string => {
  let next = value;
  if (options.ignoreWhitespace) {
    next = next.trim().replace(/\s+/g, ' ');
  }
  if (options.ignoreCase) {
    next = next.toLowerCase();
  }
  return next;
};

const tokenize = (value: string): string[] => value.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? [];

const diffSequence = <T>(left: T[], right: T[], equals: (a: T, b: T) => boolean): SequenceOp[] => {
  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = equals(left[i], right[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: SequenceOp[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (equals(left[i], right[j])) {
      result.push({ type: 'equal', leftIndex: i, rightIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', leftIndex: i });
      i += 1;
    } else {
      result.push({ type: 'add', rightIndex: j });
      j += 1;
    }
  }

  while (i < left.length) {
    result.push({ type: 'remove', leftIndex: i });
    i += 1;
  }

  while (j < right.length) {
    result.push({ type: 'add', rightIndex: j });
    j += 1;
  }

  return result;
};

const buildTokenDiff = (leftText: string, rightText: string): Pick<DiffLine, 'leftTokens' | 'rightTokens'> => {
  const leftTokens = tokenize(leftText);
  const rightTokens = tokenize(rightText);
  const ops = diffSequence(leftTokens, rightTokens, (a, b) => a === b);

  const nextLeft: DiffToken[] = [];
  const nextRight: DiffToken[] = [];

  for (const op of ops) {
    if (op.type === 'equal') {
      nextLeft.push({ text: leftTokens[op.leftIndex!], type: 'equal' });
      nextRight.push({ text: rightTokens[op.rightIndex!], type: 'equal' });
      continue;
    }

    if (op.type === 'remove') {
      nextLeft.push({ text: leftTokens[op.leftIndex!], type: 'remove' });
      continue;
    }

    nextRight.push({ text: rightTokens[op.rightIndex!], type: 'add' });
  }

  return {
    leftTokens: nextLeft,
    rightTokens: nextRight,
  };
};

const buildModifyLine = (leftLine: DiffLine, rightLine: DiffLine): DiffLine => ({
  type: 'modify',
  leftLineNumber: leftLine.leftLineNumber,
  rightLineNumber: rightLine.rightLineNumber,
  leftText: leftLine.leftText,
  rightText: rightLine.rightText,
  leftPlaceholder: false,
  rightPlaceholder: false,
  ...buildTokenDiff(leftLine.leftText, rightLine.rightText),
});

export const buildTextDiff = (leftSource: string, rightSource: string, options: TextDiffOptions = {}): DiffLine[] => {
  if (!leftSource && !rightSource) {
    return [];
  }

  const leftLines = splitLines(leftSource);
  const rightLines = splitLines(rightSource);
  const normalizedLeft = leftLines.map((line) => normalize(line, options));
  const normalizedRight = rightLines.map((line) => normalize(line, options));
  const ops = diffSequence(normalizedLeft, normalizedRight, (a, b) => a === b);

  const draft = ops.map<DiffLine>((op) => {
    if (op.type === 'equal') {
      return {
        type: 'equal',
        leftLineNumber: op.leftIndex! + 1,
        rightLineNumber: op.rightIndex! + 1,
        leftText: leftLines[op.leftIndex!],
        rightText: rightLines[op.rightIndex!],
        leftPlaceholder: false,
        rightPlaceholder: false,
      };
    }

    if (op.type === 'remove') {
      return {
        type: 'remove',
        leftLineNumber: op.leftIndex! + 1,
        rightLineNumber: null,
        leftText: leftLines[op.leftIndex!],
        rightText: '',
        leftPlaceholder: false,
        rightPlaceholder: true,
      };
    }

    return {
      type: 'add',
      leftLineNumber: null,
      rightLineNumber: op.rightIndex! + 1,
      leftText: '',
      rightText: rightLines[op.rightIndex!],
      leftPlaceholder: true,
      rightPlaceholder: false,
    };
  });

  const merged: DiffLine[] = [];
  for (let index = 0; index < draft.length; index += 1) {
    const current = draft[index];
    const next = draft[index + 1];

    if (current?.type === 'remove') {
      let removeCount = 0;
      while (draft[index + removeCount]?.type === 'remove') {
        removeCount += 1;
      }

      let addCount = 0;
      while (draft[index + removeCount + addCount]?.type === 'add') {
        addCount += 1;
      }

      // 等长替换块优先逐行配对，避免共享行视图出现错位。
      if (removeCount > 0 && removeCount === addCount) {
        for (let offset = 0; offset < removeCount; offset += 1) {
          merged.push(buildModifyLine(draft[index + offset], draft[index + removeCount + offset]));
        }
        index += removeCount + addCount - 1;
        continue;
      }
    }

    if (current?.type === 'remove' && next?.type === 'add') {
      merged.push(buildModifyLine(current, next));
      index += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
};
