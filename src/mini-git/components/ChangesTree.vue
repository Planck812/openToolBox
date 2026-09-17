<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';
import { isWindowsPath } from '../lib/pathUtils';
import { buildChangesTree, statusLetter, statusColorClass } from '../lib/changesTree';
import ChangesTreeNode from './ChangesTreeNode.vue';
import type { ChangedFile } from '@/lib/ipc/bindings';

const props = defineProps<{
  files: ChangedFile[];
  /** Namespaces expand state so groups collapse independently */
  groupKey: string;
  /** Status letter used when a file carries none */
  fallbackStatus: string;
}>();

const emit = defineEmits<{
  (e: 'open', file: ChangedFile, isPinned: boolean): void;
}>();

const sessionStore = useSessionStore();

const separator = computed(() => (isWindowsPath(sessionStore.currentRepoPath) ? '\\' : '/'));

const tree = computed(() => buildChangesTree(props.files, props.groupKey));

const letterOf = (file: ChangedFile) => statusLetter(file, props.fallbackStatus);
</script>

<template>
  <!-- Tree view -->
  <div v-if="sessionStore.changesViewMode === 'tree'" class="py-0.5 px-1">
    <ChangesTreeNode
      v-for="node in tree"
      :key="node.id"
      :node="node"
      :separator="separator"
      :fallback-status="fallbackStatus"
      @open="(file, pinned) => emit('open', file, pinned)"
    />
  </div>

  <!-- Flat list view -->
  <div v-else class="divide-y divide-border/40">
    <div
      v-for="file in files"
      :key="file.path"
      class="px-2 py-1 flex items-center justify-between hover:bg-muted/50 cursor-pointer"
      :title="file.old_path ? `${file.path}\n重命名自 ${file.old_path}` : file.path"
      @click="emit('open', file, false)"
      @dblclick="emit('open', file, true)"
    >
      <span class="truncate">{{ file.path }}</span>
      <span class="font-bold flex-shrink-0 ml-2" :class="statusColorClass(letterOf(file))">
        {{ letterOf(file) }}
      </span>
    </div>
  </div>
</template>
