<script setup lang="ts">
import { computed } from 'vue';
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  Boxes,
} from 'lucide-vue-next';
import { useSessionStore } from '../stores/session';
import type { TreeEntry } from '@/lib/ipc/bindings';

const props = defineProps<{
  entry: TreeEntry;
  childrenMap: Map<string, TreeEntry[]>;
  loadingPaths: Set<string>;
  fileStatusMap: Map<string, string>;
}>();

const emit = defineEmits<{
  (e: 'toggle', entry: TreeEntry): void;
  (e: 'open', entry: TreeEntry, isPinned: boolean): void;
  (e: 'contextmenu', event: MouseEvent, entry: TreeEntry): void;
}>();

const sessionStore = useSessionStore();

const isExpanded = computed(() => {
  return props.entry.is_dir && sessionStore.expandedTreeNodes.has(props.entry.rel_path);
});

const children = computed(() => {
  return props.childrenMap.get(props.entry.rel_path) || [];
});

const isLoading = computed(() => {
  return props.loadingPaths.has(props.entry.rel_path);
});
</script>

<template>
  <div class="select-none">
    <!-- Node row -->
    <div
      class="group flex items-center h-6 px-1 rounded hover:bg-muted/50 cursor-pointer space-x-1.5 transition-colors"
      @click="emit('open', entry, false)"
      @dblclick="emit('open', entry, true)"
      @contextmenu.prevent.stop="emit('contextmenu', $event, entry)"
    >
      <!-- Expand/Collapse arrow -->
      <button
        v-if="entry.is_dir && !entry.is_submodule"
        type="button"
        class="p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
        @click.stop="emit('toggle', entry)"
      >
        <ChevronDown v-if="isExpanded" class="w-3.5 h-3.5" />
        <ChevronRight v-else class="w-3.5 h-3.5" />
      </button>
      <span v-else class="w-3.5 flex-shrink-0" />

      <!-- Icon -->
      <Boxes v-if="entry.is_submodule" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      <FolderOpen v-else-if="entry.is_dir && isExpanded" class="w-3.5 h-3.5 text-amber-500/90 flex-shrink-0" />
      <Folder v-else-if="entry.is_dir" class="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />
      <FileCode v-else class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

      <!-- Name -->
      <span class="truncate flex-1 font-sans text-foreground/90">{{ entry.name }}</span>

      <!-- Submodule label -->
      <span v-if="entry.is_submodule" class="text-[10px] text-amber-500 border border-amber-500/30 px-1 rounded">
        子模块
      </span>

      <!-- Status badge (M, A, D, U, C) -->
      <span
        v-if="fileStatusMap.has(entry.rel_path)"
        class="text-[10px] font-bold px-1 rounded flex-shrink-0"
        :class="{
          'text-amber-500': fileStatusMap.get(entry.rel_path) === 'M',
          'text-emerald-500': fileStatusMap.get(entry.rel_path) === 'A',
          'text-rose-500': fileStatusMap.get(entry.rel_path) === 'D',
          'text-sky-500': fileStatusMap.get(entry.rel_path) === 'U',
          'text-destructive': fileStatusMap.get(entry.rel_path) === 'C',
        }"
      >
        {{ fileStatusMap.get(entry.rel_path) }}
      </span>
    </div>

    <!-- Recursive children rendering if expanded -->
    <div
      v-if="isExpanded"
      class="pl-3 border-l border-border/40 ml-2.5 my-0.5"
    >
      <div v-if="isLoading && children.length === 0" class="h-5 flex items-center text-[10.5px] text-muted-foreground px-2">
        加载中...
      </div>
      <div v-else-if="!isLoading && children.length === 0" class="h-5 flex items-center text-[10.5px] text-muted-foreground/60 px-2 italic">
        (空目录)
      </div>
      <FileTreeNode
        v-for="child in children"
        :key="child.rel_path"
        :entry="child"
        :children-map="childrenMap"
        :loading-paths="loadingPaths"
        :file-status-map="fileStatusMap"
        @toggle="emit('toggle', $event)"
        @open="(e, p) => emit('open', e, p)"
        @contextmenu="(evt, entry) => emit('contextmenu', evt, entry)"
      />
    </div>
  </div>
</template>
