import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTabsStore } from '../tabs';

describe('useTabsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reuses the preview slot when opening another preview tab', () => {
    const store = useTabsStore();

    store.openTab({ path: 'a.ts', type: 'content', isPinned: false });
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].path).toBe('a.ts');
    expect(store.tabs[0].isPinned).toBe(false);

    // Opening b.ts as preview should reuse the slot
    store.openTab({ path: 'b.ts', type: 'content', isPinned: false });
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].path).toBe('b.ts');
    expect(store.tabs[0].isPinned).toBe(false);
  });

  it('creates new tab when pinned', () => {
    const store = useTabsStore();

    store.openTab({ path: 'a.ts', type: 'content', isPinned: false });
    store.pinActiveTab();
    expect(store.tabs[0].isPinned).toBe(true);

    // Opening b.ts as preview should now create a second tab
    store.openTab({ path: 'b.ts', type: 'content', isPinned: false });
    expect(store.tabs).toHaveLength(2);
    expect(store.tabs[0].path).toBe('a.ts');
    expect(store.tabs[1].path).toBe('b.ts');
  });

  it('evicts LRU non-active pinned tab when exceeding 30 tabs', () => {
    const store = useTabsStore();

    for (let i = 1; i <= 30; i++) {
      store.openTab({ path: `file_${i}.ts`, type: 'content', isPinned: true });
    }
    expect(store.tabs).toHaveLength(30);

    // Open 31st tab
    store.openTab({ path: 'file_31.ts', type: 'content', isPinned: true });
    expect(store.tabs).toHaveLength(30);
    // file_1 was oldest and should have been evicted
    expect(store.tabs.find((t) => t.path === 'file_1.ts')).toBeUndefined();
    expect(store.tabs.find((t) => t.path === 'file_31.ts')).toBeDefined();
  });
});
