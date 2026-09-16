import type { RefInfo, Refs } from '@/lib/ipc/bindings';
import { compareNatural } from './naturalSort';

export interface RefTreeNode {
  id: string;
  label: string;
  full_name?: string;
  short_name?: string;
  target_oid?: string | null;
  is_leaf: boolean;
  is_head?: boolean;
  is_tag?: boolean;
  children?: RefTreeNode[];
}

export interface BuildRefsTreeOptions {
  head_name?: string | null;
  is_detached?: boolean;
  head_oid?: string | null;
}

/**
 * Inserts a slash-delimited ref name into a folder hierarchy.
 */
function insertRefIntoHierarchy(
  rootNodes: RefTreeNode[],
  segments: string[],
  ref: RefInfo,
  prefixId: string
) {
  let currentList = rootNodes;
  let currentPath = prefixId;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    currentPath += '/' + segment;

    if (isLast) {
      currentList.push({
        id: ref.name,
        label: segment,
        full_name: ref.name,
        short_name: ref.short_name,
        target_oid: ref.target_oid,
        is_leaf: true,
        is_head: ref.is_head,
        is_tag: ref.is_tag,
      });
    } else {
      let folder = currentList.find((node) => !node.is_leaf && node.label === segment);
      if (!folder) {
        folder = {
          id: currentPath,
          label: segment,
          is_leaf: false,
          children: [],
        };
        currentList.push(folder);
      }
      currentList = folder.children!;
    }
  }
}

/**
 * Recursively sort children nodes: folders first, then natural sort by label.
 */
function sortTreeNodes(nodes: RefTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.is_leaf !== b.is_leaf) {
      return a.is_leaf ? 1 : -1; // folders first
    }
    return compareNatural(a.label, b.label);
  });
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      sortTreeNodes(node.children);
    }
  }
}

export function buildRefsTree(refs: Refs, options?: BuildRefsTreeOptions): RefTreeNode[] {
  const root: RefTreeNode[] = [];

  // 1. HEAD Group
  const headChildren: RefTreeNode[] = [];
  if (options?.is_detached) {
    const shortOid = options.head_oid ? options.head_oid.slice(0, 7) : 'detached';
    headChildren.push({
      id: 'head:detached',
      label: `HEAD 游离于 ${shortOid}`,
      full_name: 'HEAD',
      short_name: shortOid,
      target_oid: options.head_oid ?? null,
      is_leaf: true,
      is_head: true,
    });
  } else if (refs.head) {
    headChildren.push({
      id: refs.head.name,
      label: refs.head.short_name,
      full_name: refs.head.name,
      short_name: refs.head.short_name,
      target_oid: refs.head.target_oid,
      is_leaf: true,
      is_head: true,
    });
  }

  root.push({
    id: 'group:head',
    label: '当前 HEAD',
    is_leaf: false,
    children: headChildren,
  });

  // 2. Local Branches Group
  const localBranchNodes: RefTreeNode[] = [];
  for (const branch of refs.local_branches) {
    // short_name e.g. "master", "feature/a/b"
    const segments = branch.short_name.split('/');
    insertRefIntoHierarchy(localBranchNodes, segments, branch, 'local');
  }
  sortTreeNodes(localBranchNodes);
  root.push({
    id: 'group:local',
    label: '本地分支',
    is_leaf: false,
    children: localBranchNodes,
  });

  // 3. Remote Branches Group
  // Remote branches short_name: e.g. "origin/master", "upstream/feature/xyz"
  const remoteBranchNodes: RefTreeNode[] = [];
  for (const branch of refs.remote_branches) {
    const segments = branch.short_name.split('/');
    insertRefIntoHierarchy(remoteBranchNodes, segments, branch, 'remote');
  }
  sortTreeNodes(remoteBranchNodes);
  root.push({
    id: 'group:remote',
    label: '远程分支',
    is_leaf: false,
    children: remoteBranchNodes,
  });

  // 4. Tags Group
  const tagNodes: RefTreeNode[] = [];
  for (const tag of refs.tags) {
    const segments = tag.short_name.split('/');
    insertRefIntoHierarchy(tagNodes, segments, tag, 'tag');
  }
  sortTreeNodes(tagNodes);
  root.push({
    id: 'group:tags',
    label: '标签',
    is_leaf: false,
    children: tagNodes,
  });

  return root;
}
