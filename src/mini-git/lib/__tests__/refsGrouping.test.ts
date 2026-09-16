import { describe, it, expect } from 'vitest';
import { buildRefsTree } from '../refsGrouping';
import type { Refs } from '@/lib/ipc/bindings';

describe('refsGrouping buildRefsTree', () => {
  it('builds 4 main groups and handles hierarchical branches and remotes', () => {
    const refs: Refs = {
      head: {
        name: 'refs/heads/master',
        short_name: 'master',
        target_oid: '1111111111111111111111111111111111111111',
        is_head: true,
        is_tag: false,
      },
      local_branches: [
        {
          name: 'refs/heads/master',
          short_name: 'master',
          target_oid: '1111111111111111111111111111111111111111',
          is_head: true,
          is_tag: false,
        },
        {
          name: 'refs/heads/feature/a/b',
          short_name: 'feature/a/b',
          target_oid: '2222222222222222222222222222222222222222',
          is_head: false,
          is_tag: false,
        },
      ],
      remote_branches: [
        {
          name: 'refs/remotes/origin/master',
          short_name: 'origin/master',
          target_oid: '1111111111111111111111111111111111111111',
          is_head: false,
          is_tag: false,
        },
        {
          name: 'refs/remotes/upstream/main',
          short_name: 'upstream/main',
          target_oid: '3333333333333333333333333333333333333333',
          is_head: false,
          is_tag: false,
        },
      ],
      tags: [
        {
          name: 'refs/tags/v1.0.0',
          short_name: 'v1.0.0',
          target_oid: '1111111111111111111111111111111111111111',
          is_head: false,
          is_tag: true,
        },
      ],
    };

    const tree = buildRefsTree(refs);
    expect(tree).toHaveLength(4);
    expect(tree[0].label).toBe('当前 HEAD');
    expect(tree[0].children?.[0].short_name).toBe('master');

    // Local branches check
    const local = tree[1];
    expect(local.label).toBe('本地分支');
    // Folders first: feature/ should be before master leaf
    expect(local.children?.[0].label).toBe('feature');
    expect(local.children?.[0].is_leaf).toBe(false);
    expect(local.children?.[1].label).toBe('master');
    expect(local.children?.[1].is_leaf).toBe(true);

    const featureA = local.children![0].children![0];
    expect(featureA.label).toBe('a');
    expect(featureA.is_leaf).toBe(false);

    const featureB = featureA.children![0];
    expect(featureB.label).toBe('b');
    expect(featureB.is_leaf).toBe(true);
    expect(featureB.full_name).toBe('refs/heads/feature/a/b');

    // Remote branches check (origin and upstream)
    const remote = tree[2];
    expect(remote.children?.[0].label).toBe('origin');
    expect(remote.children?.[1].label).toBe('upstream');
  });

  it('handles detached HEAD state', () => {
    const refs: Refs = {
      head: null,
      local_branches: [],
      remote_branches: [],
      tags: [],
    };

    const tree = buildRefsTree(refs, {
      is_detached: true,
      head_oid: 'abcdef0123456789',
    });

    expect(tree[0].children?.[0].label).toBe('HEAD 游离于 abcdef0');
    expect(tree[0].children?.[0].is_head).toBe(true);
  });
});
