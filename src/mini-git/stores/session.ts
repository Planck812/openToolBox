import { defineStore } from 'pinia';

export interface RepoSessionData {
  repoPath: string;
  activeGitTab: 'changes' | 'history';
  fileCursor: number;
  reviewedFiles: string[];
  expandedTreeNodes: string[];
  selectedRefName: string | null;
  selectedCommitOid: string | null;
  treeWidth: number;
  treeCollapsed: boolean;
  gitPanelHeight: number;
  gitPanelCollapsed: boolean;
  refsTreeWidth: number;
  commitListWidth: number;
  changesViewMode: 'tree' | 'list';
  collapsedChangesNodes: string[];
  lastUpdated: number;
}

const MAX_STORED_SESSIONS = 10;
const SESSION_INDEX_KEY = 'minigit:session_index';

function getSessionKey(repoPath: string): string {
  const norm = repoPath.replace(/\\/g, '/').toLowerCase();
  return `minigit:session:${norm}`;
}

function updateSessionLRU(repoPath: string) {
  try {
    const raw = localStorage.getItem(SESSION_INDEX_KEY);
    let index: string[] = raw ? JSON.parse(raw) : [];
    const norm = repoPath.replace(/\\/g, '/').toLowerCase();

    // Remove if already in list
    index = index.filter((p) => p !== norm);
    // Put current at front (most recently used)
    index.unshift(norm);

    // If exceeded 10, remove oldest from disk and index
    while (index.length > MAX_STORED_SESSIONS) {
      const oldest = index.pop();
      if (oldest) {
        localStorage.removeItem(`minigit:session:${oldest}`);
      }
    }

    localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.error('Failed to update session LRU', e);
  }
}

export const useSessionStore = defineStore('minigit-session', {
  state: () => ({
    currentRepoPath: '' as string,
    currentRepoName: '' as string,
    activeGitTab: 'changes' as 'changes' | 'history',
    fileCursor: 0,
    reviewedFiles: new Set<string>(),
    expandedTreeNodes: new Set<string>(),
    selectedRefName: null as string | null,
    selectedCommitOid: null as string | null,

    // Changes tree: directories are expanded unless explicitly collapsed
    changesViewMode: 'tree' as 'tree' | 'list',
    collapsedChangesNodes: new Set<string>(),

    // Layout
    treeWidth: 240,
    treeCollapsed: false,
    gitPanelHeight: 320,
    gitPanelCollapsed: false,
    refsTreeWidth: 200,
    commitListWidth: 360,
  }),

  actions: {
    initRepo(repoPath: string, repoName: string) {
      this.currentRepoPath = repoPath;
      this.currentRepoName = repoName;
      this.loadSession(repoPath);
    },

    loadSession(repoPath: string) {
      try {
        const raw = localStorage.getItem(getSessionKey(repoPath));
        if (raw) {
          const data: RepoSessionData = JSON.parse(raw);
          this.activeGitTab = data.activeGitTab || 'changes';
          this.fileCursor = data.fileCursor || 0;
          this.reviewedFiles = new Set(data.reviewedFiles || []);
          this.expandedTreeNodes = new Set(data.expandedTreeNodes || []);
          this.selectedRefName = data.selectedRefName || null;
          this.selectedCommitOid = data.selectedCommitOid || null;
          if (data.treeWidth) this.treeWidth = data.treeWidth;
          if (typeof data.treeCollapsed === 'boolean') this.treeCollapsed = data.treeCollapsed;
          if (data.gitPanelHeight) this.gitPanelHeight = data.gitPanelHeight;
          if (typeof data.gitPanelCollapsed === 'boolean') this.gitPanelCollapsed = data.gitPanelCollapsed;
          if (data.refsTreeWidth) this.refsTreeWidth = data.refsTreeWidth;
          if (data.commitListWidth) this.commitListWidth = data.commitListWidth;
          this.changesViewMode = data.changesViewMode || 'tree';
          this.collapsedChangesNodes = new Set(data.collapsedChangesNodes || []);
        } else {
          // Defaults for new repo
          this.activeGitTab = 'changes';
          this.fileCursor = 0;
          this.reviewedFiles.clear();
          this.expandedTreeNodes.clear();
          this.selectedRefName = null;
          this.selectedCommitOid = null;
          this.treeCollapsed = false;
          this.gitPanelCollapsed = false;
          this.changesViewMode = 'tree';
          this.collapsedChangesNodes.clear();
        }
        updateSessionLRU(repoPath);
      } catch (e) {
        console.error('Failed to load repo session', e);
      }
    },

    saveSession() {
      if (!this.currentRepoPath) return;
      try {
        const data: RepoSessionData = {
          repoPath: this.currentRepoPath,
          activeGitTab: this.activeGitTab,
          fileCursor: this.fileCursor,
          reviewedFiles: Array.from(this.reviewedFiles),
          expandedTreeNodes: Array.from(this.expandedTreeNodes),
          selectedRefName: this.selectedRefName,
          selectedCommitOid: this.selectedCommitOid,
          treeWidth: this.treeWidth,
          treeCollapsed: this.treeCollapsed,
          gitPanelHeight: this.gitPanelHeight,
          gitPanelCollapsed: this.gitPanelCollapsed,
          refsTreeWidth: this.refsTreeWidth,
          commitListWidth: this.commitListWidth,
          changesViewMode: this.changesViewMode,
          collapsedChangesNodes: Array.from(this.collapsedChangesNodes),
          lastUpdated: Date.now(),
        };
        localStorage.setItem(getSessionKey(this.currentRepoPath), JSON.stringify(data));
        updateSessionLRU(this.currentRepoPath);
      } catch (e) {
        console.error('Failed to save repo session', e);
      }
    },

    markReviewed(relPath: string) {
      this.reviewedFiles.add(relPath);
      this.saveSession();
    },

    resetReviewed() {
      this.reviewedFiles.clear();
      this.saveSession();
    },

    toggleTreeNode(path: string) {
      const next = new Set(this.expandedTreeNodes);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      this.expandedTreeNodes = next;
      this.saveSession();
    },

    setTreeNodeExpanded(path: string, expanded: boolean) {
      const next = new Set(this.expandedTreeNodes);
      if (expanded) {
        next.add(path);
      } else {
        next.delete(path);
      }
      this.expandedTreeNodes = next;
      this.saveSession();
    },

    toggleChangesNode(id: string) {
      const next = new Set(this.collapsedChangesNodes);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      this.collapsedChangesNodes = next;
      this.saveSession();
    },

    setChangesNodesCollapsed(ids: string[], collapsed: boolean) {
      const next = new Set(this.collapsedChangesNodes);
      for (const id of ids) {
        if (collapsed) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      this.collapsedChangesNodes = next;
      this.saveSession();
    },

    expandAllChangesNodes() {
      this.collapsedChangesNodes = new Set();
      this.saveSession();
    },

    setChangesViewMode(mode: 'tree' | 'list') {
      this.changesViewMode = mode;
      this.saveSession();
    },

    toggleTreeCollapse() {
      this.treeCollapsed = !this.treeCollapsed;
      this.saveSession();
    },

    toggleGitPanelCollapse() {
      this.gitPanelCollapsed = !this.gitPanelCollapsed;
      this.saveSession();
    },
  },
});
