<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  GitCommit,
  GitBranch,
  Search,
  Copy,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  User,
  Hash,
  CheckCircle2,
  ArrowUp,
  ArrowUpCircle,
  ListTree,
  List,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderSync,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import { useGitDataStore } from '../stores/gitdata';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import { buildChangesTree, collectDirIds } from '../lib/changesTree';
import ChangesTree from './ChangesTree.vue';
import type { ChangedFile, CommitSummary } from '@/lib/ipc/bindings';
import type { RefTreeNode } from '../lib/refsGrouping';

const gitData = useGitDataStore();
const sessionStore = useSessionStore();
const tabsStore = useTabsStore();

const searchInput = ref('');
const authorInput = ref('');

// Collapsed state for groups in Changes Tab
const unpushedCollapsed = ref(false);
const expandedUnpushedCommits = ref(new Set<string>());
const stagedCollapsed = ref(false);
const unstagedCollapsed = ref(false);
const untrackedCollapsed = ref(false);
const conflictedCollapsed = ref(false);

const toggleUnpushedCommitFiles = (oid: string) => {
  if (expandedUnpushedCommits.value.has(oid)) {
    expandedUnpushedCommits.value.delete(oid);
  } else {
    expandedUnpushedCommits.value.add(oid);
    gitData.loadUnpushedCommitFiles(oid);
  }
};

const unpushedFilesOf = (oid: string) => gitData.unpushedFiles.get(oid);

const navigateToHistoryCommit = async (oid: string) => {
  sessionStore.activeGitTab = 'history';
  sessionStore.selectedCommitOid = oid;
  await gitData.selectCommit(oid);
};

const expandedRefNodes = ref(new Set<string>(['group:head', 'group:local', 'group:remote', 'group:tags']));

const allChangedFiles = computed(() => {
  const st = gitData.workingStatus;
  if (!st) return [];
  return [...st.conflicted, ...st.staged, ...st.unstaged, ...st.untracked];
});

const changeGroups = computed<Array<[string, ChangedFile[]]>>(() => {
  const st = gitData.workingStatus;
  if (!st) return [];
  return [
    ['conflicted', st.conflicted],
    ['staged', st.staged],
    ['unstaged', st.unstaged],
    ['untracked', st.untracked],
  ];
});

const collapseAllChanges = () => {
  const ids = changeGroups.value.flatMap(([key, files]) => collectDirIds(buildChangesTree(files, key)));
  for (const [oid, files] of gitData.unpushedFiles) {
    ids.push(...collectDirIds(buildChangesTree(files, `commit:${oid}`)));
  }
  sessionStore.setChangesNodesCollapsed(ids, true);
};

const openChangedFileDiff = (file: ChangedFile, isPinned: boolean) => {
  tabsStore.openTab({
    path: file.path,
    title: file.path.split(/[/\\]/).pop() || file.path,
    type: 'diff',
    isPinned,
    diffSource: 'working',
  });
};

const openCommitFileDiff = (
  file: ChangedFile,
  commitOid: string,
  isPinned: boolean,
  diffSource: 'commit' | 'commit-local' = 'commit',
) => {
  const name = file.path.split(/[/\\]/).pop() || file.path;
  const short = commitOid.slice(0, 7);
  tabsStore.openTab({
    path: file.path,
    title: diffSource === 'commit-local' ? `${name} (${short} ↔ 本地)` : `${name} (${short})`,
    type: 'diff',
    isPinned,
    diffSource,
    commitOid,
  });
};

// 「与本地对比」模式：详情面板里的文件改为和工作区当前内容比对，
// 而不是和父提交比对，所以尚未提交的改动也会显示出来。
const compareWithLocal = ref(false);

const openDetailFileDiff = (file: ChangedFile, commitOid: string, isPinned: boolean) => {
  openCommitFileDiff(file, commitOid, isPinned, compareWithLocal.value ? 'commit-local' : 'commit');
};

const commitMenu = ref<{ visible: boolean; x: number; y: number; commit: CommitSummary | null }>({
  visible: false,
  x: 0,
  y: 0,
  commit: null,
});

const openCommitMenu = (event: MouseEvent, commit: CommitSummary) => {
  commitMenu.value = { visible: true, x: event.clientX, y: event.clientY, commit };
};

const closeCommitMenu = () => {
  commitMenu.value.visible = false;
  commitMenu.value.commit = null;
};

const compareCommitWithLocal = async () => {
  const commit = commitMenu.value.commit;
  closeCommitMenu();
  if (!commit) return;
  compareWithLocal.value = true;
  // 对比是在历史面板的详情列表里进行的，从变更页右键时也要切过去
  sessionStore.activeGitTab = 'history';
  sessionStore.selectedCommitOid = commit.oid;
  await gitData.selectCommit(commit.oid);
};

const copyCommitOid = async () => {
  const commit = commitMenu.value.commit;
  closeCommitMenu();
  if (commit) await copyText(commit.oid);
};

const copyAllChangedPaths = async () => {
  const paths = allChangedFiles.value.map((f) => f.path).join('\n');
  try {
    await navigator.clipboard.writeText(paths);
  } catch {}
};

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
};

const toggleRefNode = (node: RefTreeNode) => {
  if (node.is_leaf) {
    selectRef(node);
    return;
  }
  if (expandedRefNodes.value.has(node.id)) {
    expandedRefNodes.value.delete(node.id);
  } else {
    expandedRefNodes.value.add(node.id);
  }
};

const selectRef = async (node: RefTreeNode) => {
  sessionStore.selectedRefName = node.full_name || node.short_name || null;
  await gitData.startLogWalk(sessionStore.selectedRefName, authorInput.value || null);
};

const onCommitListScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  if (!el) return;
  // If scrolled within 100px from bottom, load next batch
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    gitData.loadMoreCommits();
  }
};

const selectCommit = async (commit: CommitSummary) => {
  sessionStore.selectedCommitOid = commit.oid;
  await gitData.selectCommit(commit.oid);
};

const handleSearch = () => {
  const q = searchInput.value.trim();
  if (!q) {
    gitData.cancelSearch();
    return;
  }
  gitData.startSearch(q, sessionStore.selectedRefName, authorInput.value.trim() || null);
};

const displayedCommits = computed(() => {
  if (gitData.isSearching || gitData.searchResults.length > 0) {
    return gitData.searchResults;
  }
  return gitData.commits;
});

const formatDate = (epochSec: number) => {
  return dayjs(epochSec * 1000).format('YYYY-MM-DD HH:mm');
};
</script>

<template>
  <div class="h-full flex flex-col bg-background text-xs select-none overflow-hidden">
    <!-- Top Tab Selector -->
    <div class="h-8 min-h-[32px] bg-muted/40 border-b border-border/70 flex items-center justify-between px-3">
      <div class="flex items-center space-x-2">
        <!-- Changes Tab Button -->
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition-colors"
          :class="[
            sessionStore.activeGitTab === 'changes'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="sessionStore.activeGitTab = 'changes'"
        >
          <span>变更</span>
          <span
            v-if="gitData.totalChanges > 0"
            class="px-1.5 py-0.2 rounded-full text-[10px] font-bold"
            :class="[
              gitData.statusPulse ? 'bg-primary text-primary-foreground scale-110' : 'bg-primary/20 text-primary'
            ]"
          >
            {{ gitData.totalChanges }}
          </span>
          <span
            v-if="gitData.unpushedCommits.length > 0"
            class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary/15 text-primary flex items-center space-x-0.5"
            :title="`有 ${gitData.unpushedTotal} 个已提交未推送`"
          >
            <ArrowUp class="w-2.5 h-2.5" />
            <span>{{ gitData.unpushedTotal }}</span>
          </span>
        </button>

        <!-- History Tab Button -->
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition-colors"
          :class="[
            sessionStore.activeGitTab === 'history'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          ]"
          @click="sessionStore.activeGitTab = 'history'"
        >
          <GitCommit class="w-3.5 h-3.5" />
          <span>历史</span>
        </button>
      </div>

      <!-- Right controls -->
      <div class="flex items-center space-x-2 text-[11px] text-muted-foreground">
        <span v-if="gitData.lastStatusRefreshTime">
          已更新于 {{ dayjs(gitData.lastStatusRefreshTime).format('HH:mm:ss') }}
        </span>
        <button
          type="button"
          class="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
          title="刷新 (F5)"
          @click="gitData.refreshAll"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': gitData.isRefreshing }" />
        </button>
      </div>
    </div>

    <!-- Tab 1: Changes View -->
    <div v-if="sessionStore.activeGitTab === 'changes'" class="flex-1 flex flex-col overflow-hidden">
      <!-- Toolbar -->
      <div class="h-7 min-h-[28px] px-3 bg-muted/20 border-b border-border/50 flex items-center justify-between text-muted-foreground text-[11px]">
        <div class="flex items-center space-x-2">
          <span>共 {{ gitData.totalChanges }} 个变更文件</span>
          <span
            v-if="gitData.unpushedCommits.length > 0"
            class="text-primary font-medium flex items-center space-x-1"
          >
            <span>·</span>
            <ArrowUp class="w-3 h-3" />
            <span>{{ gitData.unpushedTotal }} 个已提交未推送</span>
          </span>
        </div>
        <div class="flex items-center space-x-2">
          <button
            type="button"
            class="p-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
            :class="{ 'bg-muted text-foreground': sessionStore.changesViewMode === 'tree' }"
            :title="sessionStore.changesViewMode === 'tree' ? '切换为列表视图' : '切换为目录树视图'"
            @click="sessionStore.setChangesViewMode(sessionStore.changesViewMode === 'tree' ? 'list' : 'tree')"
          >
            <ListTree v-if="sessionStore.changesViewMode === 'tree'" class="w-3.5 h-3.5" />
            <List v-else class="w-3.5 h-3.5" />
          </button>

          <template v-if="sessionStore.changesViewMode === 'tree'">
            <button
              type="button"
              class="p-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
              title="全部展开"
              @click="sessionStore.expandAllChangesNodes"
            >
              <ChevronsUpDown class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              class="p-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
              title="全部折叠"
              @click="collapseAllChanges"
            >
              <ChevronsDownUp class="w-3.5 h-3.5" />
            </button>
          </template>

          <button
            v-if="gitData.totalChanges > 0"
            type="button"
            class="hover:underline flex items-center space-x-1"
            @click="copyAllChangedPaths"
          >
            <Copy class="w-3 h-3" />
            <span>复制全部路径</span>
          </button>
        </div>
      </div>

      <!-- Changes List -->
      <div class="flex-1 overflow-y-auto p-2 space-y-2">
        <div
          v-if="gitData.isClean && gitData.unpushedCommits.length === 0"
          class="h-32 flex flex-col items-center justify-center text-muted-foreground space-y-1"
        >
          <CheckCircle2 class="w-6 h-6 text-emerald-500/80" />
          <p class="text-xs">工作区干净，所有提交均已推送</p>
        </div>

        <div
          v-else-if="gitData.isClean"
          class="px-2.5 py-1.5 bg-muted/25 rounded border border-border/40 flex items-center space-x-1.5 text-muted-foreground text-[11px]"
        >
          <CheckCircle2 class="w-3.5 h-3.5 text-emerald-500/80 flex-shrink-0" />
          <span>工作区干净，无未暂存改动</span>
        </div>

        <!-- 0. Outgoing Commits (已提交未推送) -->
        <div v-if="gitData.unpushedCommits.length" class="border border-primary/30 rounded overflow-hidden shadow-xs">
          <div
            class="bg-primary/10 px-2.5 py-1.5 flex items-center justify-between font-medium text-primary cursor-pointer select-none transition-colors hover:bg-primary/15"
            @click="unpushedCollapsed = !unpushedCollapsed"
          >
            <div class="flex items-center space-x-1.5">
              <ArrowUpCircle class="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span>已提交未推送 ({{ gitData.unpushedTotal }})</span>
              <span
                v-if="gitData.unpushedBasis"
                class="text-[10px] text-muted-foreground font-normal"
                :title="`与 ${gitData.unpushedBasis} 比较得出`"
              >
                相对 {{ gitData.unpushedBasis }}
              </span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-[10px] text-muted-foreground font-normal">点击展开查看改动</span>
              <ChevronDown v-if="!unpushedCollapsed" class="w-3.5 h-3.5" />
              <ChevronRight v-else class="w-3.5 h-3.5" />
            </div>
          </div>

          <div v-if="!unpushedCollapsed" class="divide-y divide-border/40 bg-background/50">
            <div
              v-for="commit in gitData.unpushedCommits"
              :key="commit.oid"
              class="p-2 space-y-1 hover:bg-muted/50 transition-colors"
              @contextmenu.prevent="openCommitMenu($event, commit)"
            >
              <!-- Commit Row -->
              <div class="flex items-center justify-between gap-2">
                <div
                  class="flex items-center space-x-1.5 min-w-0 flex-1 cursor-pointer"
                  @click="toggleUnpushedCommitFiles(commit.oid)"
                >
                  <button
                    type="button"
                    class="p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                    :title="expandedUnpushedCommits.has(commit.oid) ? '折叠文件列表' : '展开文件列表'"
                    @click.stop="toggleUnpushedCommitFiles(commit.oid)"
                  >
                    <ChevronDown v-if="expandedUnpushedCommits.has(commit.oid)" class="w-3 h-3" />
                    <ChevronRight v-else class="w-3 h-3" />
                  </button>
                  <span class="font-mono text-[11px] text-primary font-medium flex-shrink-0">
                    {{ commit.short_oid }}
                  </span>
                  <span class="font-medium text-foreground truncate text-[11.5px]" :title="commit.summary">
                    {{ commit.summary || '无提交说明' }}
                  </span>
                </div>

                <div class="flex items-center space-x-2 flex-shrink-0 text-muted-foreground text-[10.5px]">
                  <span :title="commit.author_name">{{ formatDate(commit.author_time) }}</span>
                  <button
                    type="button"
                    class="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex items-center space-x-1 border border-border/40"
                    title="在历史面板查看此提交"
                    @click="navigateToHistoryCommit(commit.oid)"
                  >
                    <GitCommit class="w-2.5 h-2.5" />
                    <span>历史</span>
                  </button>
                </div>
              </div>

              <!-- Changed files inside commit -->
              <div
                v-if="expandedUnpushedCommits.has(commit.oid)"
                class="mt-1 pl-4 pr-1 py-1 border-l-2 border-primary/30 ml-2 space-y-0.5 font-mono text-[11px]"
              >
                <div v-if="unpushedFilesOf(commit.oid) === undefined" class="text-muted-foreground/60 italic text-[10px]">
                  加载中…
                </div>
                <div v-else-if="unpushedFilesOf(commit.oid)?.length === 0" class="text-muted-foreground/60 italic text-[10px]">
                  (无文件变动或为空提交)
                </div>
                <ChangesTree
                  v-else
                  :files="unpushedFilesOf(commit.oid) || []"
                  :group-key="`commit:${commit.oid}`"
                  fallback-status="M"
                  @open="(file, pinned) => openCommitFileDiff(file, commit.oid, pinned)"
                />
              </div>
            </div>

            <div v-if="gitData.unpushedTruncated" class="px-2.5 py-1.5 text-[10px] text-muted-foreground italic">
              仅显示前 {{ gitData.unpushedCommits.length }} 条，共 {{ gitData.unpushedTotal }} 条
            </div>
          </div>
        </div>

        <!-- 1. Conflicted -->
        <div v-if="gitData.workingStatus?.conflicted.length" class="border border-destructive/30 rounded overflow-hidden">
          <div
            class="bg-destructive/10 px-2 py-1 flex items-center justify-between font-medium text-destructive cursor-pointer"
            @click="conflictedCollapsed = !conflictedCollapsed"
          >
            <span>冲突文件 ({{ gitData.workingStatus.conflicted.length }})</span>
            <ChevronDown v-if="!conflictedCollapsed" class="w-3.5 h-3.5" />
            <ChevronRight v-else class="w-3.5 h-3.5" />
          </div>
          <ChangesTree
            v-if="!conflictedCollapsed"
            :files="gitData.workingStatus.conflicted"
            group-key="conflicted"
            fallback-status="C"
            @open="openChangedFileDiff"
          />
        </div>

        <!-- 2. Staged -->
        <div v-if="gitData.workingStatus?.staged.length" class="border border-border/70 rounded overflow-hidden">
          <div
            class="bg-muted/40 px-2 py-1 flex items-center justify-between font-medium cursor-pointer"
            @click="stagedCollapsed = !stagedCollapsed"
          >
            <span>暂存的改动 ({{ gitData.workingStatus.staged.length }})</span>
            <ChevronDown v-if="!stagedCollapsed" class="w-3.5 h-3.5" />
            <ChevronRight v-else class="w-3.5 h-3.5" />
          </div>
          <ChangesTree
            v-if="!stagedCollapsed"
            :files="gitData.workingStatus.staged"
            group-key="staged"
            fallback-status="A"
            @open="openChangedFileDiff"
          />
        </div>

        <!-- 3. Unstaged -->
        <div v-if="gitData.workingStatus?.unstaged.length" class="border border-border/70 rounded overflow-hidden">
          <div
            class="bg-muted/40 px-2 py-1 flex items-center justify-between font-medium cursor-pointer"
            @click="unstagedCollapsed = !unstagedCollapsed"
          >
            <span>未暂存的改动 ({{ gitData.workingStatus.unstaged.length }})</span>
            <ChevronDown v-if="!unstagedCollapsed" class="w-3.5 h-3.5" />
            <ChevronRight v-else class="w-3.5 h-3.5" />
          </div>
          <ChangesTree
            v-if="!unstagedCollapsed"
            :files="gitData.workingStatus.unstaged"
            group-key="unstaged"
            fallback-status="M"
            @open="openChangedFileDiff"
          />
        </div>

        <!-- 4. Untracked -->
        <div v-if="gitData.workingStatus?.untracked.length" class="border border-border/70 rounded overflow-hidden">
          <div
            class="bg-muted/40 px-2 py-1 flex items-center justify-between font-medium cursor-pointer"
            @click="untrackedCollapsed = !untrackedCollapsed"
          >
            <span>未跟踪的文件 ({{ gitData.workingStatus.untracked.length }})</span>
            <ChevronDown v-if="!untrackedCollapsed" class="w-3.5 h-3.5" />
            <ChevronRight v-else class="w-3.5 h-3.5" />
          </div>
          <ChangesTree
            v-if="!untrackedCollapsed"
            :files="gitData.workingStatus.untracked"
            group-key="untracked"
            fallback-status="U"
            @open="openChangedFileDiff"
          />
        </div>
      </div>
    </div>

    <!-- Tab 2: History View (3 columns) -->
    <div v-else class="flex-1 flex overflow-hidden divide-x divide-border/60">
      <!-- Col 1: Refs Tree -->
      <div class="w-48 min-w-[160px] flex flex-col bg-muted/10 overflow-y-auto p-1 font-mono text-[11px]">
        <div class="px-2 py-1 text-muted-foreground font-sans font-medium text-[10px] border-b border-border/40">
          引用过滤
        </div>

        <template v-for="group in gitData.refsTree" :key="group.id">
          <div class="mt-1">
            <!-- Group Header -->
            <div
              class="px-1.5 py-1 rounded hover:bg-muted/50 cursor-pointer flex items-center space-x-1 font-sans text-muted-foreground"
              @click="toggleRefNode(group)"
            >
              <ChevronDown v-if="expandedRefNodes.has(group.id)" class="w-3 h-3" />
              <ChevronRight v-else class="w-3 h-3" />
              <span class="font-medium truncate">{{ group.label }}</span>
            </div>

            <!-- Children -->
            <div v-if="expandedRefNodes.has(group.id)" class="pl-2.5 border-l border-border/40 ml-2">
              <div
                v-for="node in group.children || []"
                :key="node.id"
                class="px-1.5 py-0.5 rounded hover:bg-muted/50 cursor-pointer flex items-center space-x-1 truncate"
                :class="{
                  'bg-primary/10 text-primary font-bold': sessionStore.selectedRefName === (node.full_name || node.short_name)
                }"
                @click="toggleRefNode(node)"
              >
                <GitBranch class="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                <span class="truncate" :title="node.label">{{ node.label }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Col 2: Commit List -->
      <div class="w-80 min-w-[240px] flex flex-col overflow-hidden">
        <!-- Search Bar -->
        <div class="p-1.5 border-b border-border/60 bg-muted/20 flex items-center space-x-1">
          <div class="relative flex-1">
            <Search class="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
            <input
              v-model="searchInput"
              type="text"
              placeholder="搜索提交信息或哈希 (前缀≥4)..."
              class="w-full pl-6 pr-2 py-1 bg-background border border-input rounded text-[11px] focus:outline-none"
              @keydown.enter="handleSearch"
            />
          </div>
          <button
            v-if="gitData.isSearching"
            type="button"
            class="px-1.5 py-0.5 bg-destructive text-destructive-foreground rounded text-[10px]"
            @click="gitData.cancelSearch"
          >
            取消
          </button>
        </div>

        <!-- Progress during search -->
        <div v-if="gitData.isSearching" class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] flex items-center justify-between">
          <span>已扫描 {{ gitData.searchScannedCount }} / 已命中 {{ gitData.searchMatchedCount }}</span>
          <RefreshCw class="w-2.5 h-2.5 animate-spin" />
        </div>

        <!-- Virtual List -->
        <div
          class="flex-1 overflow-y-auto divide-y divide-border/40"
          @scroll="onCommitListScroll"
        >
          <div
            v-for="c in displayedCommits"
            :key="c.oid"
            data-testid="commit-card"
            class="p-2 hover:bg-muted/40 cursor-pointer space-y-0.5"
            :class="{
              'bg-accent/70': sessionStore.selectedCommitOid === c.oid
            }"
            @click="selectCommit(c)"
            @contextmenu.prevent="openCommitMenu($event, c)"
          >
            <div class="flex items-center justify-between text-muted-foreground text-[10px]">
              <span class="font-mono text-primary font-medium">{{ c.short_oid }}</span>
              <span>{{ formatDate(c.committer_time) }}</span>
            </div>
            <p class="font-medium text-foreground truncate text-[11.5px]" :title="c.summary">
              {{ c.summary || '无提交说明' }}
            </p>
            <div class="flex items-center space-x-1 text-muted-foreground text-[10px]">
              <User class="w-2.5 h-2.5" />
              <span class="truncate">{{ c.author_name }}</span>
            </div>
          </div>

          <div v-if="gitData.isLoadingCommits" class="p-2 text-center text-muted-foreground text-[10px]">
            加载提交中...
          </div>
        </div>
      </div>

      <!-- Col 3: Commit Detail -->
      <div class="flex-1 flex flex-col overflow-y-auto p-3 space-y-3">
        <div v-if="!gitData.selectedCommitDetail" class="h-full flex items-center justify-center text-muted-foreground">
          从列表中选择一个提交查看详情
        </div>

        <template v-else>
          <!-- Message -->
          <div class="space-y-1">
            <h2 class="text-xs font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
              {{ gitData.selectedCommitDetail.message }}
            </h2>
          </div>

          <!-- Metadata -->
          <div class="p-2 bg-muted/30 border border-border/50 rounded space-y-1 text-[11px] text-muted-foreground">
            <div class="flex items-center justify-between">
              <span>作者: {{ gitData.selectedCommitDetail.author_name }} &lt;{{ gitData.selectedCommitDetail.author_email }}&gt;</span>
              <span>{{ formatDate(gitData.selectedCommitDetail.author_time) }}</span>
            </div>
            <div class="flex items-center space-x-1 font-mono text-[10px]">
              <Hash class="w-3 h-3 flex-shrink-0" />
              <span class="select-all">{{ gitData.selectedCommitDetail.oid }}</span>
              <button
                type="button"
                class="hover:text-foreground ml-1"
                title="复制完整哈希"
                @click="copyText(gitData.selectedCommitDetail.oid)"
              >
                <Copy class="w-3 h-3" />
              </button>
            </div>
          </div>

          <!-- Changed Files -->
          <div class="space-y-1">
            <div class="font-medium text-foreground text-[11px] flex items-center justify-between">
              <span>变更文件 ({{ gitData.selectedCommitDetail.files.length }})</span>
              <button
                type="button"
                class="px-1.5 py-0.5 rounded border text-[10px] font-normal flex items-center space-x-1 transition-colors"
                :class="compareWithLocal
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted'"
                :title="compareWithLocal ? '当前与工作区当前内容对比，点击改回与父提交对比' : '改为与工作区当前内容对比'"
                @click="compareWithLocal = !compareWithLocal"
              >
                <FolderSync class="w-3 h-3" />
                <span>{{ compareWithLocal ? '与本地对比中' : '与父提交对比' }}</span>
              </button>
            </div>

            <p v-if="compareWithLocal" class="text-[10px] text-muted-foreground">
              左侧为该提交的版本，右侧为磁盘上的当前内容（含未提交改动）
            </p>

            <div class="divide-y divide-border/40 border border-border/60 rounded">
              <div
                v-for="file in gitData.selectedCommitDetail.files"
                :key="file.path"
                class="px-2.5 py-1.5 flex items-center justify-between hover:bg-muted/40 cursor-pointer text-[11px]"
                @click="openDetailFileDiff(file, gitData.selectedCommitDetail.oid, false)"
                @dblclick="openDetailFileDiff(file, gitData.selectedCommitDetail.oid, true)"
              >
                <span class="truncate max-w-sm">{{ file.path }}</span>
                <span
                  class="font-bold text-[10px] px-1 rounded"
                  :class="{
                    'text-emerald-500': file.status === 'A',
                    'text-amber-500': file.status === 'M',
                    'text-rose-500': file.status === 'D',
                    'text-sky-500': file.status === 'R',
                  }"
                >
                  {{ file.status }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 提交卡片右键菜单 -->
    <Teleport to="body">
      <div
        v-if="commitMenu.visible"
        class="fixed inset-0 z-50"
        @click="closeCommitMenu"
        @contextmenu.prevent="closeCommitMenu"
      >
        <div
          data-testid="commit-context-menu"
          class="fixed bg-popover text-popover-foreground border border-border shadow-md rounded-md p-1 min-w-[180px] text-xs font-sans select-none"
          :style="{ left: `${commitMenu.x}px`, top: `${commitMenu.y}px` }"
          @click.stop
        >
          <div class="px-2 py-1 text-[10px] text-muted-foreground truncate border-b border-border/40 font-mono mb-1 max-w-[220px]">
            {{ commitMenu.commit?.short_oid }} {{ commitMenu.commit?.summary }}
          </div>
          <button
            type="button"
            data-testid="compare-with-local"
            class="w-full px-2 py-1.5 flex items-center space-x-2 text-left hover:bg-accent hover:text-accent-foreground rounded cursor-pointer transition-colors text-foreground"
            title="把该提交里的文件与磁盘上的当前内容对比"
            @click="compareCommitWithLocal"
          >
            <FolderSync class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>与本地对比</span>
          </button>
          <button
            type="button"
            class="w-full px-2 py-1.5 flex items-center space-x-2 text-left hover:bg-accent hover:text-accent-foreground rounded cursor-pointer transition-colors text-foreground"
            @click="copyCommitOid"
          >
            <Copy class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>复制提交哈希</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
