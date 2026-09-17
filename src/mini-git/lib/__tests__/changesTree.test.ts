import { describe, it, expect } from 'vitest';
import { buildChangesTree, collectDirIds, statusLetter, statusColorClass } from '../changesTree';
import type { ChangedFile } from '@/lib/ipc/bindings';

function file(path: string, status = 'M'): ChangedFile {
  return {
    path,
    old_path: null,
    status,
    staged_status: null,
    unstaged_status: status,
    additions: 0,
    deletions: 0,
  };
}

describe('buildChangesTree', () => {
  it('returns an empty tree for no files', () => {
    expect(buildChangesTree([], 'unstaged')).toEqual([]);
  });

  it('keeps root level files as leaves', () => {
    const tree = buildChangesTree([file('README.md')], 'unstaged');
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'README.md', isDir: false, fileCount: 1 });
  });

  it('compacts middle directories into one row', () => {
    const tree = buildChangesTree([file('src/main/java/com/patpat/Foo.java')], 'unstaged');
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('src/main/java/com/patpat');
    expect(tree[0].path).toBe('src/main/java/com/patpat');
    expect(tree[0].children.map((n) => n.name)).toEqual(['Foo.java']);
  });

  it('stops compacting where a directory holds a file of its own', () => {
    const tree = buildChangesTree([file('src/main/App.vue'), file('src/main/java/Foo.java')], 'unstaged');
    expect(tree[0].name).toBe('src/main');
    expect(tree[0].children.map((n) => n.name)).toEqual(['java', 'App.vue']);
  });

  it('stops compacting where a directory branches', () => {
    const tree = buildChangesTree([file('src/a/Foo.java'), file('src/b/Bar.java')], 'unstaged');
    expect(tree[0].name).toBe('src');
    expect(tree[0].children.map((n) => n.name)).toEqual(['a', 'b']);
  });

  it('sorts directories before files and uses natural ordering', () => {
    const tree = buildChangesTree(
      [file('file10.txt'), file('file2.txt'), file('zdir/a.txt'), file('adir/a.txt')],
      'unstaged',
    );
    expect(tree.map((n) => n.name)).toEqual(['adir', 'zdir', 'file2.txt', 'file10.txt']);
  });

  it('accumulates file counts up the tree', () => {
    const tree = buildChangesTree(
      [file('src/a/Foo.java'), file('src/a/Bar.java'), file('src/b/Baz.java')],
      'unstaged',
    );
    expect(tree[0].fileCount).toBe(3);
    expect(tree[0].children[0].fileCount).toBe(2);
    expect(tree[0].children[1].fileCount).toBe(1);
  });

  it('handles backslash separated paths', () => {
    const tree = buildChangesTree([file('frontend\\src\\api\\pmc.ts')], 'unstaged');
    expect(tree[0].name).toBe('frontend/src/api');
    expect(tree[0].children[0].name).toBe('pmc.ts');
  });

  it('namespaces node ids by group so groups expand independently', () => {
    const staged = buildChangesTree([file('src/Foo.java')], 'staged');
    const unstaged = buildChangesTree([file('src/Foo.java')], 'unstaged');
    expect(staged[0].id).toBe('staged:src');
    expect(unstaged[0].id).toBe('unstaged:src');
  });

  it('keeps the changed file on leaf nodes', () => {
    const renamed: ChangedFile = { ...file('src/New.java', 'R'), old_path: 'src/Old.java' };
    const tree = buildChangesTree([renamed], 'staged');
    expect(tree[0].children[0].file).toBe(renamed);
  });
});

describe('statusLetter', () => {
  it('shortens the full "Conflicted" status the backend sends', () => {
    expect(statusLetter(file('a.txt', 'Conflicted'), 'C')).toBe('C');
  });

  it('keeps single letter statuses as is', () => {
    expect(statusLetter(file('a.txt', 'A'), 'M')).toBe('A');
  });

  it('falls back when the file carries no status', () => {
    expect(statusLetter(file('a.txt', ''), 'U')).toBe('U');
    expect(statusLetter(null, 'M')).toBe('M');
  });

  it('maps letters to colors, with a neutral default', () => {
    expect(statusColorClass('A')).toBe('text-emerald-500');
    expect(statusColorClass('C')).toBe('text-destructive');
    expect(statusColorClass('T')).toBe('text-muted-foreground');
  });
});

describe('collectDirIds', () => {
  it('collects every directory id, depth first', () => {
    const tree = buildChangesTree([file('src/a/Foo.java'), file('src/b/Bar.java'), file('README.md')], 'unstaged');
    expect(collectDirIds(tree)).toEqual(['unstaged:src', 'unstaged:src/a', 'unstaged:src/b']);
  });
});
