import { defineStore } from 'pinia';

export interface TabItem {
  id: string;
  title: string;
  path: string;
  type: 'content' | 'diff';
  isPinned: boolean;
  diffSource?: string; // 'working' | 'commit'
  commitOid?: string;
  lastAccessed: number;
}

const MAX_TABS = 30;

export const useTabsStore = defineStore('minigit-tabs', {
  state: () => ({
    tabs: [] as TabItem[],
    activeTabId: null as string | null,
  }),

  getters: {
    activeTab(state): TabItem | null {
      if (!state.activeTabId) return null;
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
    },

    previewTab(state): TabItem | null {
      return state.tabs.find((t) => !t.isPinned) ?? null;
    },
  },

  actions: {
    openTab(options: {
      path: string;
      title?: string;
      type: 'content' | 'diff';
      isPinned?: boolean;
      diffSource?: string;
      commitOid?: string;
    }): TabItem {
      const now = Date.now();
      const title = options.title || options.path.split(/[/\\]/).pop() || options.path;
      const tabId = options.type === 'diff'
        ? `diff:${options.diffSource || 'working'}:${options.commitOid || ''}:${options.path}`
        : `content:${options.path}`;

      // 1. Check if this exact tab is already open
      const existing = this.tabs.find((t) => t.id === tabId);
      if (existing) {
        if (options.isPinned) {
          existing.isPinned = true;
        }
        existing.lastAccessed = now;
        this.activeTabId = existing.id;
        return existing;
      }

      // 2. If it's a preview tab (isPinned === false or undefined)
      if (!options.isPinned) {
        const currentPreview = this.tabs.find((t) => !t.isPinned);
        if (currentPreview) {
          // Reuse existing preview slot!
          currentPreview.id = tabId;
          currentPreview.title = title;
          currentPreview.path = options.path;
          currentPreview.type = options.type;
          currentPreview.diffSource = options.diffSource;
          currentPreview.commitOid = options.commitOid;
          currentPreview.lastAccessed = now;
          this.activeTabId = currentPreview.id;
          return currentPreview;
        }
      }

      // 3. If adding a new tab exceeds MAX_TABS (30), evict LRU pinned tab (not active)
      if (this.tabs.length >= MAX_TABS) {
        let lruIndex = -1;
        let oldestTime = Infinity;

        for (let i = 0; i < this.tabs.length; i++) {
          const tab = this.tabs[i];
          if (tab.id !== this.activeTabId && tab.lastAccessed < oldestTime) {
            oldestTime = tab.lastAccessed;
            lruIndex = i;
          }
        }

        if (lruIndex !== -1) {
          this.tabs.splice(lruIndex, 1);
        }
      }

      const newTab: TabItem = {
        id: tabId,
        title,
        path: options.path,
        type: options.type,
        isPinned: !!options.isPinned,
        diffSource: options.diffSource,
        commitOid: options.commitOid,
        lastAccessed: now,
      };

      this.tabs.push(newTab);
      this.activeTabId = newTab.id;
      return newTab;
    },

    pinTab(tabId: string) {
      const tab = this.tabs.find((t) => t.id === tabId);
      if (tab) {
        tab.isPinned = true;
      }
    },

    pinActiveTab() {
      if (this.activeTabId) {
        this.pinTab(this.activeTabId);
      }
    },

    closeTab(tabId: string) {
      const index = this.tabs.findIndex((t) => t.id === tabId);
      if (index === -1) return;

      this.tabs.splice(index, 1);

      if (this.activeTabId === tabId) {
        if (this.tabs.length > 0) {
          // Switch to adjacent tab
          const nextIndex = Math.min(index, this.tabs.length - 1);
          this.activeTabId = this.tabs[nextIndex].id;
          this.tabs[nextIndex].lastAccessed = Date.now();
        } else {
          this.activeTabId = null;
        }
      }
    },

    closeOtherTabs(tabId: string) {
      this.tabs = this.tabs.filter((t) => t.id === tabId);
      this.activeTabId = tabId;
    },

    closeAllTabs() {
      this.tabs = [];
      this.activeTabId = null;
    },

    setActiveTab(tabId: string) {
      const tab = this.tabs.find((t) => t.id === tabId);
      if (tab) {
        tab.lastAccessed = Date.now();
        this.activeTabId = tabId;
      }
    },

    reorderTabs(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= this.tabs.length) return;
      if (toIndex < 0 || toIndex >= this.tabs.length) return;

      const [removed] = this.tabs.splice(fromIndex, 1);
      this.tabs.splice(toIndex, 0, removed);
    },

    clear() {
      this.tabs = [];
      this.activeTabId = null;
    },
  },
});
