<script setup lang="ts">
import { computed } from 'vue';
import { Folder, FolderOpen, FileCode, ChevronRight, ChevronDown } from 'lucide-vue-next';
import { useSessionStore } from '../stores/session';
import { statusLetter, statusColorClass } from '../lib/changesTree';
// Aliased so it cannot be confused with this component's own self reference
import type { ChangesTreeNode as ChangesNode } from '../lib/changesTree';
import type { ChangedFile } from '@/lib/ipc/bindings';

const props = defineProps<{
  node: ChangesNode;
  /** Path separator for display ('\' on Windows) */
  separator: string;
  /** Status letter used when the file carries none */
  fallbackStatus: string;
}>();

const emit = defineEmits<{
  (e: 'open', file: ChangedFile, isPinned: boolean): void;
}>();

const sessionStore = useSessionStore();

const isExpanded = computed(() => !sessionStore.collapsedChangesNodes.has(props.node.id));

const displayName = computed(() => props.node.name.split('/').join(props.separator));

const status = computed(() => statusLetter(props.node.file, props.fallbackStatus));

const statusClass = computed(() => statusColorClass(status.value));

const fileTitle = computed(() => {
  const file = props.node.file;
  if (!file) return '';
  return file.old_path ? `${file.path}\n重命名自 ${file.old_path}` : file.path;
});
</script>

<template>
  <!-- Directory row -->
  <div v-if="node.isDir" class="select-none">
    <div
      data-testid="changes-dir"
      class="flex items-center h-6 px-1 rounded hover:bg-muted/50 cursor-pointer space-x-1.5 transition-colors"
      :title="node.path"
      @click="sessionStore.toggleChangesNode(node.id)"
    >
      <ChevronDown v-if="isExpanded" class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <ChevronRight v-else class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

      <FolderOpen v-if="isExpanded" class="w-3.5 h-3.5 text-amber-500/90 flex-shrink-0" />
      <Folder v-else class="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />

      <span class="truncate flex-1 text-foreground/90">{{ displayName }}</span>
      <span class="text-[10px] text-muted-foreground flex-shrink-0 ml-2">{{ node.fileCount }} 个文件</span>
    </div>

    <div v-if="isExpanded" class="pl-3 border-l border-border/40 ml-2.5">
      <ChangesTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :separator="separator"
        :fallback-status="fallbackStatus"
        @open="(file, pinned) => emit('open', file, pinned)"
      />
    </div>
  </div>

  <!-- File row -->
  <div
    v-else
    data-testid="changes-file"
    class="flex items-center h-6 px-1 rounded hover:bg-muted/50 cursor-pointer space-x-1.5 transition-colors select-none"
    :title="fileTitle"
    @click="emit('open', node.file!, false)"
    @dblclick="emit('open', node.file!, true)"
  >
    <span class="w-3.5 flex-shrink-0" />
    <FileCode class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
    <span class="truncate flex-1 text-foreground/90">{{ node.name }}</span>
    <span class="text-[10px] font-bold px-1 rounded flex-shrink-0" :class="statusClass">{{ status }}</span>
  </div>
</template>
