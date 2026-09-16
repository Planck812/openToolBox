<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  ChevronLeft,
  RefreshCw,
  GitBranch,
  AlertTriangle,
  FolderTree,
  GitPullRequest,
  Search,
  X,
  FileCode,
} from 'lucide-vue-next';
import { useGitDataStore } from '../stores/gitdata';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import { useReposStore } from '../stores/repos';
import { gitIpc } from '../lib/ipc';
import { fuzzyMatch } from '../lib/fuzzy';
import FileTree from '../components/FileTree.vue';
import FileViewer from '../components/FileViewer.vue';
import GitPanel from '../components/GitPanel.vue';

const router = useRouter();
const route = useRoute();
const gitData = useGitDataStore();
const sessionStore = useSessionStore();
const tabsStore = useTabsStore();
const reposStore = useReposStore();

// Quick Open (Ctrl+P) modal state
const isQuickOpenOpen = ref(false);
const quickOpenQuery = ref('');
const trackedFiles = ref<string[]>([]);
const quickOpenIndex = ref(0);
const quickOpenInputRef = ref<HTMLInputElement | null>(null);

// Dragging splitter state
const isDraggingV = ref(false);
const isDraggingH = ref(false);

const repoName = computed(() => {
  if (!gitData.repoPath) return '仓库';
  return gitData.repoPath.split(/[/\\]/).filter(Boolean).pop() || '仓库';
});

// Stale check (> 60s since last status scan)
const isDataStale = computed(() => {
  if (!gitData.lastStatusRefreshTime) return false;
  return Date.now() - gitData.lastStatusRefreshTime > 60000;
});

const openQuickFinder = async () => {
  if (!gitData.repoId) return;
  isQuickOpenOpen.value = true;
  quickOpenQuery.value = '';
  quickOpenIndex.value = 0;
  try {
    trackedFiles.value = await gitIpc.listTrackedFiles(gitData.repoId);
  } catch {}
  setTimeout(() => quickOpenInputRef.value?.focus(), 50);
};

const closeQuickFinder = () => {
  isQuickOpenOpen.value = false;
};

const filteredTrackedFiles = computed(() => {
  const q = quickOpenQuery.value.trim();
  if (!q) return trackedFiles.value.slice(0, 50);

  const matched = trackedFiles.value
    .map((path) => {
      const name = path.split('/').pop() || path;
      return { path, res: fuzzyMatch(q, name, path) };
    })
    .filter((item) => item.res && item.res.matched);

  matched.sort((a, b) => (b.res?.score ?? 0) - (a.res?.score ?? 0));
  return matched.slice(0, 50).map((m) => m.path);
});

const selectQuickOpenFile = (path: string) => {
  tabsStore.openTab({
    path,
    type: 'content',
    isPinned: false,
  });
  closeQuickFinder();
};

// Global keyboard listeners
const onGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openQuickFinder();
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    backToPicker();
  } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
    e.preventDefault();
    gitData.refreshAll();
  } else if (e.altKey && e.key === '1') {
    e.preventDefault();
    sessionStore.toggleTreeCollapse();
  } else if (e.altKey && e.key === '9') {
    e.preventDefault();
    sessionStore.toggleGitPanelCollapse();
  } else if (e.key === 'Escape' && isQuickOpenOpen.value) {
    closeQuickFinder();
  }
};

// Advance to next / previous changed file in diff viewer
const advanceFile = (direction: 'next' | 'prev') => {
  const st = gitData.workingStatus;
  if (!st) return;
  const list = [...st.conflicted, ...st.staged, ...st.unstaged, ...st.untracked];
  if (list.length === 0) return;

  let nextIdx = sessionStore.fileCursor;
  if (direction === 'next') {
    if (nextIdx < list.length - 1) {
      nextIdx++;
    }
  } else {
    if (nextIdx > 0) {
      nextIdx--;
    }
  }

  sessionStore.fileCursor = nextIdx;
  const file = list[nextIdx];
  tabsStore.openTab({
    path: file.path,
    title: file.path.split(/[/\\]/).pop() || file.path,
    type: 'diff',
    isPinned: false,
    diffSource: 'working',
  });
};

const backToPicker = () => {
  sessionStore.saveSession();
  router.push('/');
};

// Splitter mouse handlers
const startDragV = (e: MouseEvent) => {
  e.preventDefault();
  isDraggingV.value = true;
  const onMove = (moveEv: MouseEvent) => {
    if (!isDraggingV.value) return;
    const newWidth = Math.max(160, Math.min(600, moveEv.clientX));
    sessionStore.treeWidth = newWidth;
  };
  const onUp = () => {
    isDraggingV.value = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    sessionStore.saveSession();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

const startDragH = (e: MouseEvent) => {
  e.preventDefault();
  isDraggingH.value = true;
  const onMove = (moveEv: MouseEvent) => {
    if (!isDraggingH.value) return;
    const totalHeight = window.innerHeight;
    const newHeight = Math.max(140, Math.min(totalHeight - 200, totalHeight - moveEv.clientY));
    sessionStore.gitPanelHeight = newHeight;
  };
  const onUp = () => {
    isDraggingH.value = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    sessionStore.saveSession();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// Window focus listener for 3s-throttled status refresh (TC-7.2)
const onWindowFocus = () => {
  if (Date.now() - gitData.lastStatusRefreshTime > 3000) {
    gitData.refreshWorkingStatus();
  }
};

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown);
  window.addEventListener('focus', onWindowFocus);

  const queryPath = route.query.path as string;
  if (queryPath) {
    if (queryPath !== gitData.repoPath) {
      try {
        await gitData.openRepo(queryPath);
      } catch {
        reposStore.markInvalid(queryPath, '仓库无法打开');
        backToPicker();
        return;
      }
    }
    sessionStore.initRepo(queryPath, repoName.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  window.removeEventListener('focus', onWindowFocus);
});
</script>

<template>
  <div class="h-full flex flex-col bg-background text-xs select-none overflow-hidden">
    <!-- Top Action / Breadcrumb Bar -->
    <div class="h-8 min-h-[32px] bg-muted/30 border-b border-border/70 flex items-center justify-between px-3 text-xs">
      <div class="flex items-center space-x-2">
        <button
          type="button"
          class="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground flex items-center space-x-1"
          title="返回仓库选择首屏 (Ctrl+Shift+O)"
          @click="backToPicker"
        >
          <ChevronLeft class="w-3.5 h-3.5" />
          <span class="text-xs font-medium">返回</span>
        </button>

        <span class="text-muted-foreground/50">|</span>

        <!-- Repo & Branch indicator -->
        <div class="flex items-center space-x-1.5 font-medium text-foreground">
          <span>{{ repoName }}</span>
          <span class="text-muted-foreground">·</span>
          <span class="text-primary flex items-center space-x-1">
            <GitBranch class="w-3 h-3" />
            <span>{{ gitData.repoState?.head_name || 'HEAD' }}</span>
          </span>
        </div>
      </div>

      <!-- Right tools -->
      <div class="flex items-center space-x-2">
        <!-- Stale Warning Banner -->
        <div
          v-if="isDataStale"
          class="flex items-center space-x-1 px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded text-[11px] border border-amber-500/30"
        >
          <AlertTriangle class="w-3 h-3 flex-shrink-0" />
          <span>数据可能已陈旧</span>
          <button type="button" class="underline ml-1" @click="gitData.refreshWorkingStatus">刷新</button>
        </div>

        <button
          type="button"
          class="px-2 py-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground flex items-center space-x-1 text-[11px]"
          title="快速查找文件 (Ctrl+P)"
          @click="openQuickFinder"
        >
          <Search class="w-3 h-3" />
          <span>查找文件</span>
        </button>

        <button
          type="button"
          class="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
          title="全量刷新 (F5)"
          @click="gitData.refreshAll"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': gitData.isRefreshing }" />
        </button>
      </div>
    </div>

    <!-- Main 3-Pane Body -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Upper: FileTree + FileViewer -->
      <div class="flex-1 flex overflow-hidden">
        <!-- 1. File Tree (or 24px bar if collapsed) -->
        <div
          v-if="sessionStore.treeCollapsed"
          class="w-6 min-w-[24px] bg-muted/40 border-r border-border/70 flex flex-col items-center py-3 cursor-pointer hover:bg-muted/70 transition-colors"
          title="展开文件树 (Alt+1)"
          @click="sessionStore.toggleTreeCollapse"
        >
          <FolderTree class="w-3.5 h-3.5 text-muted-foreground mb-3" />
          <span class="text-[10px] text-muted-foreground font-medium [writing-mode:vertical-lr] tracking-widest">
            文件树
          </span>
        </div>

        <div
          v-else
          class="flex flex-col border-r border-border/70 overflow-hidden"
          :style="{ width: `${sessionStore.treeWidth}px` }"
        >
          <FileTree />
        </div>

        <!-- Vertical Splitter -->
        <div
          v-if="!sessionStore.treeCollapsed"
          class="w-1 hover:w-1.5 bg-transparent hover:bg-primary/50 cursor-col-resize transition-all z-20 select-none flex-shrink-0"
          @mousedown="startDragV"
          @dblclick="sessionStore.toggleTreeCollapse"
        />

        <!-- 2. File Viewer -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <FileViewer
            @next-file="advanceFile('next')"
            @prev-file="advanceFile('prev')"
          />
        </div>
      </div>

      <!-- Horizontal Splitter -->
      <div
        class="h-1 hover:h-1.5 bg-border/70 hover:bg-primary/50 cursor-row-resize transition-all z-20 select-none flex-shrink-0"
        @mousedown="startDragH"
        @dblclick="sessionStore.toggleGitPanelCollapse"
      />

      <!-- Lower: Git Panel (or 24px bar if collapsed) -->
      <div
        v-if="sessionStore.gitPanelCollapsed"
        class="h-6 min-h-[24px] bg-muted/40 border-t border-border/70 flex items-center justify-between px-3 cursor-pointer hover:bg-muted/70 transition-colors"
        title="展开 Git 面板 (Alt+9)"
        @click="sessionStore.toggleGitPanelCollapse"
      >
        <div class="flex items-center space-x-2">
          <GitPullRequest class="w-3.5 h-3.5 text-muted-foreground" />
          <span class="text-[11px] text-muted-foreground font-medium">Git 面板</span>
        </div>
        <span
          v-if="gitData.totalChanges > 0"
          class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary text-primary-foreground"
        >
          {{ gitData.totalChanges }}
        </span>
      </div>

      <div
        v-else
        class="border-t border-border/70 overflow-hidden"
        :style="{ height: `${sessionStore.gitPanelHeight}px` }"
      >
        <GitPanel />
      </div>
    </div>

    <!-- Quick Open Modal (Ctrl+P) -->
    <div
      v-if="isQuickOpenOpen"
      class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16"
      @click.self="closeQuickFinder"
    >
      <div class="w-[500px] max-w-full bg-background border border-border shadow-2xl rounded-lg overflow-hidden flex flex-col">
        <!-- Input header -->
        <div class="p-3 border-b border-border/70 flex items-center space-x-2 bg-muted/20">
          <Search class="w-4 h-4 text-muted-foreground" />
          <input
            ref="quickOpenInputRef"
            v-model="quickOpenQuery"
            type="text"
            placeholder="输入文件名进行模糊查找..."
            class="flex-1 bg-transparent text-xs text-foreground focus:outline-none"
            @keydown.down.prevent="quickOpenIndex = Math.min(quickOpenIndex + 1, filteredTrackedFiles.length - 1)"
            @keydown.up.prevent="quickOpenIndex = Math.max(quickOpenIndex - 1, 0)"
            @keydown.enter="filteredTrackedFiles[quickOpenIndex] && selectQuickOpenFile(filteredTrackedFiles[quickOpenIndex])"
            @keydown.esc="closeQuickFinder"
          />
          <button type="button" class="p-1 hover:bg-muted rounded" @click="closeQuickFinder">
            <X class="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <!-- Result list -->
        <div class="max-h-72 overflow-y-auto divide-y divide-border/30">
          <div
            v-if="filteredTrackedFiles.length === 0"
            class="p-4 text-center text-muted-foreground text-xs"
          >
            无匹配文件
          </div>
          <div
            v-for="(path, idx) in filteredTrackedFiles"
            :key="path"
            class="px-3 py-2 flex items-center space-x-2 cursor-pointer hover:bg-muted/40 text-xs"
            :class="{ 'bg-accent/70': quickOpenIndex === idx }"
            @click="selectQuickOpenFile(path)"
          >
            <FileCode class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span class="font-medium text-foreground truncate">{{ path.split('/').pop() }}</span>
            <span class="text-[11px] text-muted-foreground truncate">{{ path }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
