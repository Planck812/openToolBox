import { defineStore } from 'pinia';
import type {
  ChangedFile,
  CommitDetail,
  CommitSummary,
  Refs,
  RepoState,
  TreeEntry,
  UnpushedCommits,
  WorkingStatus,
} from '@/lib/ipc/bindings';
import { buildRefsTree, type RefTreeNode } from '../lib/refsGrouping';
import { gitIpc } from '../lib/ipc';

export const useGitDataStore = defineStore('minigit-gitdata', {
  state: () => ({
    repoId: null as string | null,
    repoPath: '' as string,
    repoState: null as RepoState | null,
    workingStatus: null as WorkingStatus | null,
    refs: null as Refs | null,
    refsTree: [] as RefTreeNode[],
    unpushedCommits: [] as CommitSummary[],
    unpushedTotal: 0,
    unpushedTruncated: false,
    // oid -> 该提交的改动文件列表，按需加载
    unpushedFiles: new Map<string, ChangedFile[]>(),

    // File tree cache: relPath -> TreeEntry[]
    treeCache: new Map<string, TreeEntry[]>(),

    // Commit log
    walkId: null as string | null,
    commits: [] as CommitSummary[],
    hasMoreCommits: false,
    traversedCount: 0,
    isLoadingCommits: false,
    selectedCommitOid: null as string | null,
    selectedCommitDetail: null as CommitDetail | null,
    isLoadingCommitDetail: false,

    // Search commits
    searchId: null as string | null,
    isSearching: false,
    searchResults: [] as CommitSummary[],
    searchScannedCount: 0,
    searchMatchedCount: 0,

    // Timing & feedback
    lastStatusRefreshTime: 0,
    isRefreshing: false,
    statusPulse: false,
  }),

  getters: {
    totalChanges(state): number {
      return state.workingStatus?.total_changes ?? 0;
    },
    isClean(state): boolean {
      return state.workingStatus?.is_clean ?? true;
    },
  },

  actions: {
    async openRepo(path: string): Promise<string> {
      this.closeRepo();
      this.repoPath = path;
      this.isRefreshing = true;

      try {
        const repoId = await gitIpc.openSession(path);
        this.repoId = repoId;

        // Fetch state and refs in parallel
        const [state, refs] = await Promise.all([
          gitIpc.getRepoState(repoId),
          gitIpc.listRefs(repoId),
        ]);

        this.repoState = state;
        this.refs = refs;
        this.refsTree = buildRefsTree(refs, {
          head_name: state.head_name,
          is_detached: state.is_detached,
          head_oid: state.head_oid,
        });

        // Start log walk
        await this.startLogWalk(null, null);

        // Async load working status so it doesn't block initial screen
        this.refreshWorkingStatus();

        return repoId;
      } finally {
        this.isRefreshing = false;
      }
    },

    async closeRepo() {
      if (this.repoId) {
        try {
          await gitIpc.closeSession(this.repoId);
        } catch {}
      }
      this.repoId = null;
      this.repoPath = '';
      this.repoState = null;
      this.workingStatus = null;
      this.refs = null;
      this.refsTree = [];
      this.unpushedCommits = [];
      this.unpushedTotal = 0;
      this.unpushedTruncated = false;
      this.unpushedFiles.clear();
      this.treeCache.clear();
      this.commits = [];
      this.walkId = null;
      this.selectedCommitOid = null;
      this.selectedCommitDetail = null;
      this.cancelSearch();
    },

    async refreshWorkingStatus() {
      if (!this.repoId) return;
      try {
        const prevChanges = this.workingStatus?.total_changes;
        const [status, unpushed] = await Promise.all([
          gitIpc.status(this.repoId),
          gitIpc.unpushedCommits(this.repoId).catch(
            (): UnpushedCommits => ({ commits: [], total: 0, truncated: false })
          ),
        ]);
        this.workingStatus = status;
        this.unpushedCommits = unpushed.commits;
        this.unpushedTotal = unpushed.total;
        this.unpushedTruncated = unpushed.truncated;
        this.pruneUnpushedFiles();
        this.lastStatusRefreshTime = Date.now();

        if (prevChanges !== undefined && prevChanges !== status.total_changes) {
          this.statusPulse = true;
          setTimeout(() => {
            this.statusPulse = false;
          }, 800);
        }
      } catch (e) {
        console.error('Failed to refresh working status', e);
      }
    },

    // 提交内容按 oid 不可变，缓存无需失效；只丢掉已不在列表里的条目，防止无限增长。
    // 不能整体 clear：已展开的提交会因缓存被清而卡在「加载中」——没人会再触发加载。
    pruneUnpushedFiles() {
      const alive = new Set(this.unpushedCommits.map((c) => c.oid));
      for (const oid of this.unpushedFiles.keys()) {
        if (!alive.has(oid)) this.unpushedFiles.delete(oid);
      }
    },

    async loadUnpushedCommitFiles(oid: string) {
      if (!this.repoId || this.unpushedFiles.has(oid)) return;
      try {
        const detail = await gitIpc.commitDetail(this.repoId, oid);
        this.unpushedFiles.set(oid, detail.files);
      } catch (e) {
        console.error('Failed to load unpushed commit files', e);
        this.unpushedFiles.set(oid, []);
      }
    },

    async refreshAll() {
      if (!this.repoId) return;
      this.isRefreshing = true;
      try {
        const [state, refs, status, unpushed] = await Promise.all([
          gitIpc.getRepoState(this.repoId),
          gitIpc.listRefs(this.repoId),
          gitIpc.status(this.repoId),
          gitIpc.unpushedCommits(this.repoId).catch(
            (): UnpushedCommits => ({ commits: [], total: 0, truncated: false })
          ),
        ]);

        this.repoState = state;
        this.refs = refs;
        this.workingStatus = status;
        this.unpushedCommits = unpushed.commits;
        this.unpushedTotal = unpushed.total;
        this.unpushedTruncated = unpushed.truncated;
        this.pruneUnpushedFiles();
        this.lastStatusRefreshTime = Date.now();
        this.refsTree = buildRefsTree(refs, {
          head_name: state.head_name,
          is_detached: state.is_detached,
          head_oid: state.head_oid,
        });

        // Restart log walk
        await this.startLogWalk(null, null);
      } finally {
        this.isRefreshing = false;
      }
    },

    async listDirectory(relPath: string): Promise<TreeEntry[]> {
      if (!this.repoId) return [];
      if (this.treeCache.has(relPath)) {
        return this.treeCache.get(relPath)!;
      }

      const entries = await gitIpc.listDir(this.repoId, relPath);
      this.treeCache.set(relPath, entries);
      return entries;
    },

    async startLogWalk(refname: string | null, author: string | null) {
      if (!this.repoId) return;
      this.isLoadingCommits = true;
      try {
        if (this.walkId) {
          try {
            await gitIpc.logClose(this.walkId);
          } catch {}
          this.walkId = null;
        }

        const walkId = await gitIpc.logOpen(this.repoId, {
          refname,
          author_contains: author,
        });
        this.walkId = walkId;

        const page = await gitIpc.logNext(walkId, 100);
        this.commits = page.commits;
        this.hasMoreCommits = page.has_more;
        this.traversedCount = page.traversed_count;
      } finally {
        this.isLoadingCommits = false;
      }
    },

    async loadMoreCommits() {
      if (!this.walkId || !this.hasMoreCommits || this.isLoadingCommits) return;
      this.isLoadingCommits = true;
      try {
        const page = await gitIpc.logNext(this.walkId, 100);
        this.commits.push(...page.commits);
        this.hasMoreCommits = page.has_more;
        this.traversedCount += page.traversed_count;
      } finally {
        this.isLoadingCommits = false;
      }
    },

    async selectCommit(oid: string) {
      if (!this.repoId) return;
      this.selectedCommitOid = oid;
      this.isLoadingCommitDetail = true;
      try {
        const detail = await gitIpc.commitDetail(this.repoId, oid);
        this.selectedCommitDetail = detail;
      } finally {
        this.isLoadingCommitDetail = false;
      }
    },

    async startSearch(text: string, refname: string | null, author: string | null) {
      if (!this.repoId) return;
      this.cancelSearch();
      this.isSearching = true;
      this.searchResults = [];
      this.searchScannedCount = 0;
      this.searchMatchedCount = 0;

      try {
        const searchId = await gitIpc.searchStart(this.repoId, {
          text,
          refname,
          author_contains: author,
        });
        this.searchId = searchId;

        // Poll search progress
        const poll = async () => {
          if (!this.isSearching || this.searchId !== searchId) return;
          try {
            const progress = await gitIpc.searchPoll(searchId);
            this.searchScannedCount = progress.scanned_count;
            this.searchMatchedCount = progress.matched_count;
            this.searchResults = progress.results;

            if (progress.is_done) {
              this.isSearching = false;
            } else {
              setTimeout(poll, 150);
            }
          } catch {
            this.isSearching = false;
          }
        };

        poll();
      } catch {
        this.isSearching = false;
      }
    },

    async cancelSearch() {
      if (this.searchId) {
        try {
          await gitIpc.searchCancel(this.searchId);
        } catch {}
        this.searchId = null;
      }
      this.isSearching = false;
    },
  },
});
