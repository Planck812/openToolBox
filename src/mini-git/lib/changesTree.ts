import type { ChangedFile } from '@/lib/ipc/bindings';
import { compareNatural } from './naturalSort';

export interface ChangesTreeNode {
  /** Stable key for expand state: `${groupKey}:${path}` */
  id: string;
  /** Display name. For compacted directories this spans several segments. */
  name: string;
  /** Full relative path (posix separators) */
  path: string;
  isDir: boolean;
  file: ChangedFile | null;
  children: ChangesTreeNode[];
  /** Number of files in this subtree */
  fileCount: number;
}

interface DirBuilder {
  name: string;
  path: string;
  dirs: Map<string, DirBuilder>;
  files: ChangedFile[];
}

function newDir(name: string, path: string): DirBuilder {
  return { name, path, dirs: new Map(), files: [] };
}

function splitPath(path: string): string[] {
  return path.split(/[/\\]+/).filter(Boolean);
}

/** Builds a directory tree out of a flat changed-file list, IDEA "group by directory" style. */
export function buildChangesTree(files: ChangedFile[], groupKey: string): ChangesTreeNode[] {
  const root = newDir('', '');

  for (const file of files) {
    const segments = splitPath(file.path);
    if (segments.length === 0) continue;

    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      let child = dir.dirs.get(segment);
      if (!child) {
        child = newDir(segment, dir.path ? `${dir.path}/${segment}` : segment);
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.files.push(file);
  }

  return toNodes(root, groupKey);
}

/** Converts a directory's children into sorted nodes, compacting single-child middle directories. */
function toNodes(dir: DirBuilder, groupKey: string): ChangesTreeNode[] {
  const dirNodes = Array.from(dir.dirs.values()).map((child) => toDirNode(child, groupKey));
  const fileNodes = dir.files.map((file) => toFileNode(file, groupKey));

  dirNodes.sort((a, b) => compareNatural(a.name, b.name));
  fileNodes.sort((a, b) => compareNatural(a.name, b.name));
  return [...dirNodes, ...fileNodes];
}

function toDirNode(dir: DirBuilder, groupKey: string): ChangesTreeNode {
  // Compact middle directories: a directory holding nothing but one subdirectory
  // merges into a single row, e.g. "src/main/java/com/patpat".
  let name = dir.name;
  let current = dir;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const only = current.dirs.values().next().value as DirBuilder;
    name = `${name}/${only.name}`;
    current = only;
  }

  const children = toNodes(current, groupKey);
  return {
    id: `${groupKey}:${current.path}`,
    name,
    path: current.path,
    isDir: true,
    file: null,
    children,
    fileCount: children.reduce((sum, child) => sum + child.fileCount, 0),
  };
}

function toFileNode(file: ChangedFile, groupKey: string): ChangesTreeNode {
  const segments = splitPath(file.path);
  return {
    id: `${groupKey}:${file.path}`,
    name: segments[segments.length - 1] || file.path,
    path: file.path,
    isDir: false,
    file,
    children: [],
    fileCount: 1,
  };
}

/** Single letter badge for a changed file; the backend sends "Conflicted" in full. */
export function statusLetter(file: ChangedFile | null, fallback: string): string {
  const raw = file?.status || fallback;
  return raw.length > 1 ? raw[0].toUpperCase() : raw;
}

const STATUS_COLORS: Record<string, string> = {
  A: 'text-emerald-500',
  M: 'text-amber-500',
  D: 'text-rose-500',
  R: 'text-sky-500',
  U: 'text-sky-500',
  C: 'text-destructive',
};

export function statusColorClass(letter: string): string {
  return STATUS_COLORS[letter] || 'text-muted-foreground';
}

/** Collects the ids of every directory node, used by expand-all. */
export function collectDirIds(nodes: ChangesTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.isDir) continue;
    out.push(node.id);
    collectDirIds(node.children, out);
  }
  return out;
}
