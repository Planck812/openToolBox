<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  Boxes,
  RefreshCw,
} from 'lucide-vue-next';
import { useGitDataStore } from '../stores/gitdata';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import { compareTreeEntries } from '../lib/naturalSort';
import type { TreeEntry } from '@/lib/ipc/bindings';

const gitData = useGitDataStore();
const sessionStore = useSessionStore();
const tabsStore = useTabsStore();

// Loaded children cache: relPath -> TreeEntry[]
const childrenMap = ref(new Map<string, TreeEntry[]>());
const loadingPaths = ref(new Set<string>());
const rootEntries = ref<TreeEntry[]>([]);

// Mapping of relPath -> status flag (M, A, D, U)
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
  loadingPaths.value.add(relPath);

  try {
    const raw = await gitData.listDirectory(relPath);
    // Filter ignored untracked files
    const visible = raw.filter((e) => !e.is_ignored || e.is_tracked);
    visible.sort((a, b) => compareTreeEntries({ name: a.name, isDir: a.is_dir }, { name: b.name, isDir: b.is_dir }));

    if (relPath === '') {
      rootEntries.value = visible;
    } else {
      childrenMap.value.set(relPath, visible);
    }
  } finally {
    loadingPaths.value.delete(relPath);
  }
};

const refreshTree = async () => {
  childrenMap.value.clear();
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
      <!-- Recursive template for tree entries -->
      <template v-for="entry in rootEntries" :key="entry.rel_path">
        <!-- Node row -->
        <div
          class="group flex items-center h-6 px-1 rounded hover:bg-muted/50 cursor-pointer space-x-1.5 transition-colors"
          @click="openFile(entry, false)"
          @dblclick="openFile(entry, true)"
          @contextmenu.prevent="copyPath(entry.rel_path, false)"
        >
          <!-- Expand/Collapse arrow -->
          <button
            v-if="entry.is_dir && !entry.is_submodule"
            type="button"
            class="p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
            @click.stop="toggleDirectory(entry)"
          >
            <ChevronDown v-if="sessionStore.expandedTreeNodes.has(entry.rel_path)" class="w-3.5 h-3.5" />
            <ChevronRight v-else class="w-3.5 h-3.5" />
          </button>
          <span v-else class="w-3.5 flex-shrink-0" />

          <!-- Icon -->
          <Boxes v-if="entry.is_submodule" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <FolderOpen v-else-if="entry.is_dir && sessionStore.expandedTreeNodes.has(entry.rel_path)" class="w-3.5 h-3.5 text-amber-500/90 flex-shrink-0" />
          <Folder v-else-if="entry.is_dir" class="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />
          <FileCode v-else class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

          <!-- Name -->
          <span class="truncate flex-1 font-sans text-foreground/90">{{ entry.name }}</span>

          <!-- Submodule label -->
          <span v-if="entry.is_submodule" class="text-[10px] text-amber-500 border border-amber-500/30 px-1 rounded">
            子模块
          </span>

          <!-- Status badge (M, A, D, U) -->
          <span
            v-if="fileStatusMap.has(entry.rel_path)"
            class="text-[10px] font-bold px-1 rounded flex-shrink-0"
            :class="{
              'text-amber-500': fileStatusMap.get(entry.rel_path) === 'M',
              'text-emerald-500': fileStatusMap.get(entry.rel_path) === 'A',
              'text-rose-500': fileStatusMap.get(entry.rel_path) === 'D',
              'text-sky-500': fileStatusMap.get(entry.rel_path) === 'U',
              'text-red-500': fileStatusMap.get(entry.rel_path) === 'C',
            }"
          >
            {{ fileStatusMap.get(entry.rel_path) }}
          </span>
        </div>

        <!-- Subdirectory entries if expanded -->
        <template v-if="entry.is_dir && sessionStore.expandedTreeNodes.has(entry.rel_path)">
          <div class="pl-3 border-l border-border/40 ml-2.5 my-0.5">
            <div
              v-for="sub in childrenMap.get(entry.rel_path) || []"
              :key="sub.rel_path"
              class="group flex items-center h-6 px-1 rounded hover:bg-muted/50 cursor-pointer space-x-1.5 transition-colors"
              @click="openFile(sub, false)"
              @dblclick="openFile(sub, true)"
              @contextmenu.prevent="copyPath(sub.rel_path, false)"
            >
              <button
                v-if="sub.is_dir && !sub.is_submodule"
                type="button"
                class="p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                @click.stop="toggleDirectory(sub)"
              >
                <ChevronDown v-if="sessionStore.expandedTreeNodes.has(sub.rel_path)" class="w-3.5 h-3.5" />
                <ChevronRight v-else class="w-3.5 h-3.5" />
              </button>
              <span v-else class="w-3.5 flex-shrink-0" />

              <Boxes v-if="sub.is_submodule" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <FolderOpen v-else-if="sub.is_dir && sessionStore.expandedTreeNodes.has(sub.rel_path)" class="w-3.5 h-3.5 text-amber-500/90 flex-shrink-0" />
              <Folder v-else-if="sub.is_dir" class="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />
              <FileCode v-else class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

              <span class="truncate flex-1 font-sans text-foreground/90">{{ sub.name }}</span>

              <span
                v-if="fileStatusMap.has(sub.rel_path)"
                class="text-[10px] font-bold px-1 rounded flex-shrink-0"
                :class="{
                  'text-amber-500': fileStatusMap.get(sub.rel_path) === 'M',
                  'text-emerald-500': fileStatusMap.get(sub.rel_path) === 'A',
                  'text-rose-500': fileStatusMap.get(sub.rel_path) === 'D',
                  'text-sky-500': fileStatusMap.get(sub.rel_path) === 'U',
                }"
              >
                {{ fileStatusMap.get(sub.rel_path) }}
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
