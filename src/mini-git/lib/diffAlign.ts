import type { DiffLine, DiffPlan } from '@/lib/ipc/bindings';
import { computeInlineDiff, type HighlightRange } from './inlineDiff';

export type DiffRowType = 'context' | 'delete' | 'insert' | 'modify' | 'fold';

export interface DiffSideCell {
  lineno: number | null;
  content: string;
  type: 'context' | 'delete' | 'insert' | 'empty';
  highlights?: HighlightRange[];
}

export interface AlignedDiffRow {
  id: string;
  type: DiffRowType;
  left: DiffSideCell;
  right: DiffSideCell;
  foldInfo?: {
    collapsed: boolean;
    startOldLineno: number;
    endOldLineno: number;
    hiddenRows: AlignedDiffRow[];
  };
}

/**
 * Aligns the git diff lines inside a single DiffHunk into side-by-side rows.
 * Pairs consecutive deletions and additions into 'modify' rows with word-level inline diffs.
 */
export function alignHunkLines(lines: DiffLine[]): AlignedDiffRow[] {
  const rows: AlignedDiffRow[] = [];
  let i = 0;
  let rowId = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.origin === ' ') {
      // Context line
      rows.push({
        id: `hunk-row-${rowId++}`,
        type: 'context',
        left: {
          lineno: line.old_lineno,
          content: line.content,
          type: 'context',
        },
        right: {
          lineno: line.new_lineno,
          content: line.content,
          type: 'context',
        },
      });
      i++;
    } else {
      // Collect consecutive deleted (-) and added (+) lines
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];

      while (i < lines.length && (lines[i].origin === '-' || lines[i].origin === '+')) {
        if (lines[i].origin === '-') {
          dels.push(lines[i]);
        } else if (lines[i].origin === '+') {
          adds.push(lines[i]);
        }
        i++;
      }

      const maxLen = Math.max(dels.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        const hasDel = k < dels.length;
        const hasAdd = k < adds.length;

        if (hasDel && hasAdd) {
          const delLine = dels[k];
          const addLine = adds[k];
          const inline = computeInlineDiff(delLine.content, addLine.content);

          rows.push({
            id: `hunk-row-${rowId++}`,
            type: 'modify',
            left: {
              lineno: delLine.old_lineno,
              content: delLine.content,
              type: 'delete',
              highlights: inline.oldHighlights,
            },
            right: {
              lineno: addLine.new_lineno,
              content: addLine.content,
              type: 'insert',
              highlights: inline.newHighlights,
            },
          });
        } else if (hasDel) {
          const delLine = dels[k];
          rows.push({
            id: `hunk-row-${rowId++}`,
            type: 'delete',
            left: {
              lineno: delLine.old_lineno,
              content: delLine.content,
              type: 'delete',
            },
            right: {
              lineno: null,
              content: '',
              type: 'empty',
            },
          });
        } else {
          const addLine = adds[k];
          rows.push({
            id: `hunk-row-${rowId++}`,
            type: 'insert',
            left: {
              lineno: null,
              content: '',
              type: 'empty',
            },
            right: {
              lineno: addLine.new_lineno,
              content: addLine.content,
              type: 'insert',
            },
          });
        }
      }
    }
  }

  return rows;
}

export interface ProjectedDiffItem {
  old_lineno: number | null;
  new_lineno: number | null;
  type: DiffRowType;
  content: string;
}

/**
 * Projector for test assertion and ground-truth comparison.
 * Projects aligned rows into a sequential list of (old_lineno, new_lineno, type, content).
 */
export function projectDiff(rows: AlignedDiffRow[]): ProjectedDiffItem[] {
  const result: ProjectedDiffItem[] = [];

  for (const row of rows) {
    if (row.type === 'context') {
      result.push({
        old_lineno: row.left.lineno,
        new_lineno: row.right.lineno,
        type: 'context',
        content: row.left.content,
      });
    } else if (row.type === 'delete') {
      result.push({
        old_lineno: row.left.lineno,
        new_lineno: null,
        type: 'delete',
        content: row.left.content,
      });
    } else if (row.type === 'insert') {
      result.push({
        old_lineno: null,
        new_lineno: row.right.lineno,
        type: 'insert',
        content: row.right.content,
      });
    } else if (row.type === 'modify') {
      result.push({
        old_lineno: row.left.lineno,
        new_lineno: null,
        type: 'delete',
        content: row.left.content,
      });
      result.push({
        old_lineno: null,
        new_lineno: row.right.lineno,
        type: 'insert',
        content: row.right.content,
      });
    }
  }

  return result;
}

const FOLD_THRESHOLD = 8; // continuous unchanged lines > 8 are folded

/**
 * Builds the complete side-by-side rows for a DiffPlan, including context folding between hunks.
 */
export function buildDiffRows(plan: DiffPlan): AlignedDiffRow[] {
  // If untracked file or newly added without hunks
  if (plan.hunks.length === 0) {
    if (plan.new_content && !plan.old_content) {
      // Entirely new file
      const lines = plan.new_content.split('\n');
      return lines.map((line, idx) => ({
        id: `row-new-${idx + 1}`,
        type: 'insert',
        left: { lineno: null, content: '', type: 'empty' },
        right: { lineno: idx + 1, content: line, type: 'insert' },
      }));
    }
    if (plan.old_content && !plan.new_content) {
      // Entirely deleted file
      const lines = plan.old_content.split('\n');
      return lines.map((line, idx) => ({
        id: `row-del-${idx + 1}`,
        type: 'delete',
        left: { lineno: idx + 1, content: line, type: 'delete' },
        right: { lineno: null, content: '', type: 'empty' },
      }));
    }
    return [];
  }

  // In degraded mode or without full content, render hunks directly with separators
  if (!plan.old_content || !plan.new_content || plan.tier === 'Degraded') {
    const allRows: AlignedDiffRow[] = [];
    for (let hIdx = 0; hIdx < plan.hunks.length; hIdx++) {
      const hunk = plan.hunks[hIdx];
      const hunkRows = alignHunkLines(hunk.lines);
      allRows.push(...hunkRows);
    }
    return allRows;
  }

  // In Full mode with full text, fold untouched lines between hunks
  const oldLines = plan.old_content.split('\n');
  const newLines = plan.new_content.split('\n');
  const allRows: AlignedDiffRow[] = [];
  let currentOldLine = 1;
  let currentNewLine = 1;
  let rowId = 0;

  const createFoldOrContextRows = (
    fromOld: number,
    toOld: number,
    fromNew: number,
    _toNew: number
  ) => {
    const count = toOld - fromOld + 1;
    if (count <= 0) return;

    const contextRows: AlignedDiffRow[] = [];
    for (let k = 0; k < count; k++) {
      const oldNo = fromOld + k;
      const newNo = fromNew + k;
      const content = oldLines[oldNo - 1] ?? '';
      contextRows.push({
        id: `gap-row-${rowId++}`,
        type: 'context',
        left: { lineno: oldNo, content, type: 'context' },
        right: { lineno: newNo, content, type: 'context' },
      });
    }

    if (count > FOLD_THRESHOLD) {
      // Fold block
      allRows.push({
        id: `fold-${rowId++}`,
        type: 'fold',
        left: { lineno: null, content: '', type: 'empty' },
        right: { lineno: null, content: '', type: 'empty' },
        foldInfo: {
          collapsed: true,
          startOldLineno: fromOld,
          endOldLineno: toOld,
          hiddenRows: contextRows,
        },
      });
    } else {
      allRows.push(...contextRows);
    }
  };

  for (const hunk of plan.hunks) {
    // Gap before this hunk
    if (hunk.old_start > currentOldLine) {
      const gapOldEnd = hunk.old_start - 1;
      const gapNewEnd = hunk.new_start - 1;
      createFoldOrContextRows(currentOldLine, gapOldEnd, currentNewLine, gapNewEnd);
    }

    // Process hunk lines
    const hunkRows = alignHunkLines(hunk.lines);
    allRows.push(...hunkRows);

    currentOldLine = hunk.old_start + hunk.old_lines;
    currentNewLine = hunk.new_start + hunk.new_lines;
  }

  // Trailing gap after last hunk
  if (currentOldLine <= oldLines.length) {
    createFoldOrContextRows(
      currentOldLine,
      oldLines.length,
      currentNewLine,
      newLines.length
    );
  }

  return allRows;
}
