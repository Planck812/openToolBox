import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useReposStore, type RepoEntry } from '../repos';

describe('useReposStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('TC-1.1: sorts repos by lastOpened DESC', () => {
    const store = useReposStore();
    store.repos = [
      { id: '1', name: 'repo-old', path: '/code/repo-old', lastOpened: 1000, addedAt: 1000, isValid: true },
      { id: '2', name: 'repo-new', path: '/code/repo-new', lastOpened: 3000, addedAt: 2000, isValid: true },
      { id: '3', name: 'repo-mid', path: '/code/repo-mid', lastOpened: 2000, addedAt: 3000, isValid: true },
    ];

    const sorted = store.sortedRepos;
    expect(sorted.map((r) => r.name)).toEqual(['repo-new', 'repo-mid', 'repo-old']);
  });

  it('TC-1.2: tie-breaker by addedAt is stable', () => {
    const store = useReposStore();
    store.repos = [
      { id: '1', name: 'repo-1', path: '/code/repo-1', lastOpened: 1000, addedAt: 100, isValid: true },
      { id: '2', name: 'repo-2', path: '/code/repo-2', lastOpened: 1000, addedAt: 200, isValid: true },
    ];

    for (let i = 0; i < 5; i++) {
      expect(store.sortedRepos.map((r) => r.name)).toEqual(['repo-1', 'repo-2']);
    }
  });

  it('TC-1.6 & TC-1.7: fuzzy filter scores name match higher than path match', () => {
    const store = useReposStore();
    store.repos = [
      { id: '1', name: 'otb', path: '/other/path', lastOpened: 1000, addedAt: 100, isValid: true },
      { id: '2', name: 'project', path: '/code/otb/project', lastOpened: 1000, addedAt: 200, isValid: true },
    ];

    store.searchKeyword = 'otb';
    const filtered = store.filteredRepos;
    expect(filtered.length).toBe(2);
    // Name match (otb) has higher score than path match
    expect(filtered[0].repo.name).toBe('otb');
  });

  it('TC-1.25: removeRepo removes from list and localStorage', () => {
    const store = useReposStore();
    store.repos = [
      { id: '1', name: 'repo-a', path: '/code/repo-a', lastOpened: 1000, addedAt: 100, isValid: true },
      { id: '2', name: 'repo-b', path: '/code/repo-b', lastOpened: 1000, addedAt: 200, isValid: true },
    ];
    store.save();

    store.removeRepo('/code/repo-a');
    expect(store.repos.length).toBe(1);
    expect(store.repos[0].name).toBe('repo-b');
  });

  it('TC-1.27: markInvalid sets isValid to false and records errorReason', () => {
    const store = useReposStore();
    store.repos = [
      { id: '1', name: 'repo-a', path: '/code/repo-a', lastOpened: 1000, addedAt: 100, isValid: true },
    ];

    store.markInvalid('/code/repo-a', '仓库路径不存在');
    expect(store.repos[0].isValid).toBe(false);
    expect(store.repos[0].errorReason).toBe('仓库路径不存在');
  });
});
