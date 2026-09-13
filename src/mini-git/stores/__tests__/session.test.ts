import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionStore } from '../session';

describe('useSessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('marks and resets reviewed files', () => {
    const store = useSessionStore();
    store.initRepo('/test/repo', 'repo');

    store.markReviewed('src/main.ts');
    expect(store.reviewedFiles.has('src/main.ts')).toBe(true);

    store.resetReviewed();
    expect(store.reviewedFiles.size).toBe(0);
  });

  it('toggles tree node expansion and persists', () => {
    const store = useSessionStore();
    store.initRepo('/test/repo', 'repo');

    store.toggleTreeNode('src/components');
    expect(store.expandedTreeNodes.has('src/components')).toBe(true);

    store.toggleTreeNode('src/components');
    expect(store.expandedTreeNodes.has('src/components')).toBe(false);
  });

  it('TC-2.8: evicts oldest session when 11 repo sessions are recorded (max 10 LRU)', () => {
    const store = useSessionStore();

    for (let i = 1; i <= 11; i++) {
      store.initRepo(`/test/repo_${i}`, `repo_${i}`);
      store.saveSession();
    }

    const rawIndex = localStorage.getItem('minigit:session_index');
    expect(rawIndex).toBeTruthy();
    const index: string[] = JSON.parse(rawIndex!);
    expect(index.length).toBe(10);
    // repo_1 was oldest and should be evicted
    expect(index.includes('/test/repo_1')).toBe(false);
    expect(index.includes('/test/repo_11')).toBe(true);
    expect(localStorage.getItem('minigit:session:/test/repo_1')).toBeNull();
    expect(localStorage.getItem('minigit:session:/test/repo_11')).not.toBeNull();
  });
});
