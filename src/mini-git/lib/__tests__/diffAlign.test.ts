import { describe, it, expect } from 'vitest';
import { alignHunkLines, projectDiff, buildDiffRows } from '../diffAlign';
import type { DiffLine, DiffPlan } from '@/lib/ipc/bindings';

describe('diffAlign alignHunkLines & projectDiff', () => {
  it('aligns pure context lines', () => {
    const lines: DiffLine[] = [
      { origin: ' ', old_lineno: 1, new_lineno: 1, content: 'line 1' },
      { origin: ' ', old_lineno: 2, new_lineno: 2, content: 'line 2' },
    ];
    const rows = alignHunkLines(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('context');
    expect(rows[0].left.content).toBe('line 1');
    expect(rows[0].right.content).toBe('line 1');

    const projected = projectDiff(rows);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toEqual({
      old_lineno: 1,
      new_lineno: 1,
      type: 'context',
      content: 'line 1',
    });
  });

  it('pairs deletions and additions into modify rows', () => {
    const lines: DiffLine[] = [
      { origin: ' ', old_lineno: 1, new_lineno: 1, content: 'head' },
      { origin: '-', old_lineno: 2, new_lineno: null, content: 'const a = 1;' },
      { origin: '+', old_lineno: null, new_lineno: 2, content: 'const a = 2;' },
      { origin: ' ', old_lineno: 3, new_lineno: 3, content: 'tail' },
    ];
    const rows = alignHunkLines(lines);
    expect(rows).toHaveLength(3);
    expect(rows[1].type).toBe('modify');
    expect(rows[1].left.content).toBe('const a = 1;');
    expect(rows[1].right.content).toBe('const a = 2;');
    expect(rows[1].left.highlights).toBeDefined();
    expect(rows[1].right.highlights).toBeDefined();

    const projected = projectDiff(rows);
    expect(projected).toHaveLength(4);
    expect(projected[1].type).toBe('delete');
    expect(projected[2].type).toBe('insert');
  });

  it('handles unequal number of deletions and additions', () => {
    const lines: DiffLine[] = [
      { origin: '-', old_lineno: 10, new_lineno: null, content: 'del 1' },
      { origin: '-', old_lineno: 11, new_lineno: null, content: 'del 2' },
      { origin: '+', old_lineno: null, new_lineno: 10, content: 'add 1' },
    ];
    const rows = alignHunkLines(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('modify');
    expect(rows[1].type).toBe('delete');
    expect(rows[1].right.type).toBe('empty');
  });

  it('folds unchanged lines exceeding threshold (8 lines)', () => {
    const oldContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const newContent = oldContent.replace('line 20', 'line 20 modified');

    const plan: DiffPlan = {
      tier: 'Full',
      source: 'working',
      rel_path: 'test.txt',
      old_content: oldContent,
      new_content: newContent,
      hunks: [
        {
          old_start: 17,
          old_lines: 7,
          new_start: 17,
          new_lines: 7,
          header: '@@ -17,7 +17,7 @@',
          lines: [
            { origin: ' ', old_lineno: 17, new_lineno: 17, content: 'line 17' },
            { origin: ' ', old_lineno: 18, new_lineno: 18, content: 'line 18' },
            { origin: ' ', old_lineno: 19, new_lineno: 19, content: 'line 19' },
            { origin: '-', old_lineno: 20, new_lineno: null, content: 'line 20' },
            { origin: '+', old_lineno: null, new_lineno: 20, content: 'line 20 modified' },
            { origin: ' ', old_lineno: 21, new_lineno: 21, content: 'line 21' },
            { origin: ' ', old_lineno: 22, new_lineno: 22, content: 'line 22' },
            { origin: ' ', old_lineno: 23, new_lineno: 23, content: 'line 23' },
          ],
        },
      ],
      additions: 1,
      deletions: 1,
      is_binary: false,
      old_size: 100,
      new_size: 110,
      reason: null,
      old_path: null,
    };

    const rows = buildDiffRows(plan);
    const foldRows = rows.filter((r) => r.type === 'fold');
    expect(foldRows.length).toBeGreaterThanOrEqual(1);
    expect(foldRows[0].foldInfo?.collapsed).toBe(true);
    expect(foldRows[0].foldInfo?.startOldLineno).toBe(1);
    expect(foldRows[0].foldInfo?.endOldLineno).toBe(16);
  });
});
