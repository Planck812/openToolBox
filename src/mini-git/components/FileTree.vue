<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
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

onMounted(() => {
  refreshTree();
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

const copyPath = async (relPath: string, isAbsolute: boolean) => {
  const text = isAbsolute ? `${gitData.repoPath}/${relPath}`.replace(/\\/g, '/') : relPath;
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
};
</script>

<template>
  <div class="h-full flex flex-col bg-background text-xs select-none overflow-hidden">
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
        @copy-path="copyPath"
      />
    </div>
  </div>
</template>
