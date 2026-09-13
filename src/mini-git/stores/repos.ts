import { defineStore } from 'pinia';
import { fuzzyMatch, type FuzzyMatchResult } from '../lib/fuzzy';
import { gitIpc } from '../lib/ipc';

export interface RepoEntry {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  addedAt: number;
  isValid: boolean;
  errorReason?: string;
}

export interface MatchedRepoEntry {
  repo: RepoEntry;
  matchResult?: FuzzyMatchResult;
}

const STORAGE_KEY = 'minigit:repos';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function extractRepoName(p: string): string {
  const normalized = normalizePath(p);
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

export const useReposStore = defineStore('minigit-repos', {
  state: () => ({
    repos: [] as RepoEntry[],
    searchKeyword: '',
    selectedIndex: 0,
    isLoading: false,
    errorMessage: '',
  }),

  getters: {
    /**
     * Repos sorted by lastOpened DESC.
     * In case of tie, sorted by addedAt ASC for stability.
     */
    sortedRepos(state): RepoEntry[] {
      return [...state.repos].sort((a, b) => {
        if (b.lastOpened !== a.lastOpened) {
          return b.lastOpened - a.lastOpened;
        }
        return a.addedAt - b.addedAt;
      });
    },

    /**
     * Filtered repos by fuzzy search against name and path.
     */
    filteredRepos(): MatchedRepoEntry[] {
      const list = this.sortedRepos;
      const kw = this.searchKeyword.trim();
      if (!kw) {
        return list.map((repo) => ({ repo }));
      }

      const results: MatchedRepoEntry[] = [];
      for (const repo of list) {
        const match = fuzzyMatch(kw, repo.name, repo.path);
        if (match && match.matched) {
          results.push({ repo, matchResult: match });
        }
      }

      // Sort by score DESC
      results.sort((a, b) => (b.matchResult?.score ?? 0) - (a.matchResult?.score ?? 0));
      return results;
    },

    selectedRepo(): RepoEntry | null {
      const list = this.filteredRepos;
      if (this.selectedIndex >= 0 && this.selectedIndex < list.length) {
        return list[this.selectedIndex].repo;
      }
      return null;
    },
  },

  actions: {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.repos = JSON.parse(raw);
        }
      } catch (e) {
        console.error('Failed to load minigit repos from localStorage', e);
      }
    },

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.repos));
      } catch (e) {
        console.error('Failed to save minigit repos to localStorage', e);
      }
    },

    async addRepo(path: string): Promise<RepoEntry> {
      this.isLoading = true;
      this.errorMessage = '';
      try {
        const validated = await gitIpc.validateRepo(path);
        const norm = normalizePath(validated.path);

        const existing = this.repos.find((r) => normalizePath(r.path).toLowerCase() === norm.toLowerCase());
        const now = Date.now();

        if (existing) {
          existing.path = validated.path;
          existing.name = validated.name || extractRepoName(validated.path);
          existing.lastOpened = now;
          existing.isValid = true;
          existing.errorReason = undefined;
          this.save();
          return existing;
        }

        const newRepo: RepoEntry = {
          id: norm,
          name: validated.name || extractRepoName(validated.path),
          path: validated.path,
          lastOpened: now,
          addedAt: now,
          isValid: true,
        };

        this.repos.push(newRepo);
        this.save();
        return newRepo;
      } catch (err: any) {
        const msg = (err && typeof err === 'object' && 'message' in err)
          ? err.message
          : (typeof err === 'string' ? err : '添加仓库失败');
        this.errorMessage = msg;
        throw new Error(msg);
      } finally {
        this.isLoading = false;
      }
    },

    removeRepo(path: string) {
      const norm = normalizePath(path).toLowerCase();
      this.repos = this.repos.filter((r) => normalizePath(r.path).toLowerCase() !== norm);
      this.save();
      // Also clean up persisted session if any
      try {
        localStorage.removeItem(`minigit:session:${norm}`);
      } catch {}
      if (this.selectedIndex >= this.filteredRepos.length) {
        this.selectedIndex = Math.max(0, this.filteredRepos.length - 1);
      }
    },

    async relocateRepo(oldPath: string, newPath: string) {
      const normOld = normalizePath(oldPath).toLowerCase();
      const target = this.repos.find((r) => normalizePath(r.path).toLowerCase() === normOld);
      if (!target) return;

      const validated = await gitIpc.validateRepo(newPath);
      target.path = validated.path;
      target.name = validated.name || extractRepoName(validated.path);
      target.id = normalizePath(validated.path);
      target.isValid = true;
      target.errorReason = undefined;
      this.save();
    },

    touchRepo(path: string) {
      const norm = normalizePath(path).toLowerCase();
      const target = this.repos.find((r) => normalizePath(r.path).toLowerCase() === norm);
      if (target) {
        target.lastOpened = Date.now();
        this.save();
      }
    },

    markInvalid(path: string, reason: string) {
      const norm = normalizePath(path).toLowerCase();
      const target = this.repos.find((r) => normalizePath(r.path).toLowerCase() === norm);
      if (target) {
        target.isValid = false;
        target.errorReason = reason;
        this.save();
      }
    },
  },
});
