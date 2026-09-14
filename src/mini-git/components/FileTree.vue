<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { RefreshCw, Copy, Check } from 'lucide-vue-next';
import { useGitDataStore } from '../stores/gitdata';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import { compareTreeEntries } from '../lib/naturalSort';
import FileTreeNode from './FileTreeNode.vue';
import type { TreeEntry } from '@/lib/ipc/bindings';

const gitData = useGitDataStore();
const sessionStore = useSessionStore();
const tabsStore = useTabsStore();

// Loaded children cache: relPath -> TreeEntry[]
const childrenMap = ref(new Map<string, TreeEntry[]>());
const loadingPaths = ref(new Set<string>());
const rootEntries = ref<TreeEntry[]>([]);

// Context menu state
const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  entry: TreeEntry | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  entry: null,
});

const copiedTip = ref<string | null>(null);

// Mapping of relPath -> status flag (M, A, D, U, C)
const fileStatusMap = computed(() => {
  const map = new Map<string, string>();
  const st = gitData.workingStatus;
  if (!st) return map;

  for (const f of st.unstaged) map.set(f.path, 'M');
  for (const f of st.staged) map.set(f.path, 'A');
  for (const f of st.untracked) map.set(f.path, 'U');
  for (const f of st.conflicted) map.set(f.path, 'C');
  return map;
});

// Load entries for a directory
const loadDirEntries = async (relPath: string) => {
  if (loadingPaths.value.has(relPath)) return;
  const nextLoading = new Set(loadingPaths.value);
  nextLoading.add(relPath);
  loadingPaths.value = nextLoading;

  try {
    const raw = await gitData.listDirectory(relPath);
    // Filter ignored untracked files
    const visible = raw.filter((e) => !e.is_ignored || e.is_tracked);
    visible.sort((a, b) => compareTreeEntries({ name: a.name, isDir: a.is_dir }, { name: b.name, isDir: b.is_dir }));

    if (relPath === '') {
      rootEntries.value = visible;
    } else {
      const nextMap = new Map(childrenMap.value);
      nextMap.set(relPath, visible);
      childrenMap.value = nextMap;
    }
  } finally {
    const nextLoading = new Set(loadingPaths.value);
    nextLoading.delete(relPath);
    loadingPaths.value = nextLoading;
  }
};

const refreshTree = async () => {
  childrenMap.value = new Map();
  await loadDirEntries('');
  // Re-expand previously expanded nodes
  for (const p of sessionStore.expandedTreeNodes) {
    loadDirEntries(p);
  }
};

const onWindowKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && contextMenu.value.visible) {
    closeContextMenu();
  }
};

onMounted(() => {
  refreshTree();
  window.addEventListener('keydown', onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});

watch(() => gitData.repoId, () => {
  refreshTree();
});

const toggleDirectory = async (entry: TreeEntry) => {
  if (!entry.is_dir || entry.is_submodule) return;
  const isExpanded = sessionStore.expandedTreeNodes.has(entry.rel_path);

  if (isExpanded) {
    sessionStore.setTreeNodeExpanded(entry.rel_path, false);
  } else {
    sessionStore.setTreeNodeExpanded(entry.rel_path, true);
    if (!childrenMap.value.has(entry.rel_path)) {
      await loadDirEntries(entry.rel_path);
    }
  }
};

const openFile = (entry: TreeEntry, isPinned: boolean) => {
  if (entry.is_dir) {
    toggleDirectory(entry);
    return;
  }

  tabsStore.openTab({
    path: entry.rel_path,
    title: entry.name,
    type: 'content',
    isPinned,
  });
};

const onContextMenu = (event: MouseEvent, entry: TreeEntry) => {
  event.preventDefault();
  event.stopPropagation();
  const width = 170;
  const height = 90;
  const x = Math.min(event.clientX, window.innerWidth - width - 8);
  const y = Math.min(event.clientY, window.innerHeight - height - 8);
  contextMenu.value = {
    visible: true,
    x,
    y,
    entry,
  };
};

const closeContextMenu = () => {
  contextMenu.value.visible = false;
  contextMenu.value.entry = null;
};

const showCopiedFeedback = (tip: string) => {
  copiedTip.value = tip;
  setTimeout(() => {
    if (copiedTip.value === tip) {
      copiedTip.value = null;
    }
  }, 1500);
};

const copyAbsolutePath = async () => {
  if (!contextMenu.value.entry) return;
  const rel = contextMenu.value.entry.rel_path;
  const isWin = gitData.repoPath.includes('\\');
  const fullPath = isWin
    ? `${gitData.repoPath}\\${rel}`.replace(/\//g, '\\')
    : `${gitData.repoPath}/${rel}`.replace(/\\/g, '/');
  try {
    await navigator.clipboard.writeText(fullPath);
    showCopiedFeedback('已复制绝对路径');
  } catch {}
  closeContextMenu();
};

const copyRelativePath = async () => {
  if (!contextMenu.value.entry) return;
  const rel = contextMenu.value.entry.rel_path;
  try {
    await navigator.clipboard.writeText(rel);
    showCopiedFeedback('已复制相对路径');
  } catch {}
  closeContextMenu();
};
</script>

<template>
  <div class="h-full flex flex-col bg-background text-xs select-none overflow-hidden relative">
    <!-- Header / Root Bar -->
    <div class="h-7 min-h-[28px] px-2.5 bg-muted/30 border-b border-border/60 flex items-center justify-between text-muted-foreground text-[11px]">
      <span class="font-medium truncate text-foreground">工作区文件</span>
      <button
        type="button"
        class="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
        title="刷新文件树"
        @click="refreshTree"
      >
        <RefreshCw class="w-3 h-3" />
      </button>
    </div>

    <!-- Tree Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden p-1 font-mono text-[11.5px]">
      <div v-if="rootEntries.length === 0" class="h-32 flex flex-col items-center justify-center text-muted-foreground/60 text-xs">
        暂无文件
      </div>
      <FileTreeNode
        v-for="entry in rootEntries"
        :key="entry.rel_path"
        :entry="entry"
        :children-map="childrenMap"
        :loading-paths="loadingPaths"
        :file-status-map="fileStatusMap"
        @toggle="toggleDirectory"
        @open="openFile"
        @contextmenu="onContextMenu"
      />
    </div>

    <!-- Floating Feedback Toast -->
    <div
      v-if="copiedTip"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 bg-foreground text-background px-2.5 py-1 rounded shadow-md text-[11px] font-sans flex items-center space-x-1.5 z-40 transition-opacity pointer-events-none"
    >
      <Check class="w-3 h-3 text-emerald-400" />
      <span>{{ copiedTip }}</span>
    </div>

    <!-- Context Menu Teleport -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="fixed inset-0 z-50 pointer-events-auto"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <div
          class="fixed bg-popover text-popover-foreground border border-border shadow-md rounded-md p-1 min-w-[160px] text-xs font-sans animate-in fade-in zoom-in-95 duration-75 select-none"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          @click.stop
        >
          <div class="px-2 py-1 text-[10px] text-muted-foreground truncate border-b border-border/40 font-mono mb-1 max-w-[200px]">
            {{ contextMenu.entry?.name }}
          </div>
          <button
            type="button"
            class="w-full px-2 py-1.5 flex items-center space-x-2 text-left hover:bg-accent hover:text-accent-foreground rounded cursor-pointer transition-colors text-foreground"
            @click="copyAbsolutePath"
          >
            <Copy class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>复制绝对路径</span>
          </button>
          <button
            type="button"
            class="w-full px-2 py-1.5 flex items-center space-x-2 text-left hover:bg-accent hover:text-accent-foreground rounded cursor-pointer transition-colors text-foreground"
            @click="copyRelativePath"
          >
            <Copy class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>复制相对路径</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

