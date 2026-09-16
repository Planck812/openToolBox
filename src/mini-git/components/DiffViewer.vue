<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import {
  ChevronUp,
  ChevronDown,
  CheckCircle,
  FileCode,
  AlertTriangle,
  RefreshCw,
  FolderSync,
} from 'lucide-vue-next';
import { useGitDataStore } from '../stores/gitdata';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import { gitIpc } from '../lib/ipc';
import { buildDiffRows, type AlignedDiffRow } from '../lib/diffAlign';
import type { DiffPlan } from '@/lib/ipc/bindings';

const props = defineProps<{
  relPath: string;
  source: string;
  commitOid?: string;
}>();

const emit = defineEmits<{
  (e: 'next-file'): void;
  (e: 'prev-file'): void;
  (e: 'view-content', path: string): void;
}>();

const gitData = useGitDataStore();
const sessionStore = useSessionStore();
const tabsStore = useTabsStore();

const isLoading = ref(false);
const errorMsg = ref('');
const diffPlan = ref<DiffPlan | null>(null);
const diffRows = ref<AlignedDiffRow[]>([]);
const scrollContainerRef = ref<HTMLDivElement | null>(null);

const currentChangeIndex = ref(0);

const isReviewed = computed(() => sessionStore.reviewedFiles.has(props.relPath));

const totalChanges = computed(() => {
  return diffRows.value.filter((r) => r.type === 'modify' || r.type === 'delete' || r.type === 'insert').length;
});

const loadDiff = async () => {
  if (!gitData.repoId || !props.relPath) return;
  isLoading.value = true;
  errorMsg.value = '';
  diffPlan.value = null;
  diffRows.value = [];

  try {
    const effectiveSource = (props.source === 'commit' && props.commitOid)
      ? `commit:${props.commitOid}`
      : props.source;
    const plan = await gitIpc.diffPrepare(gitData.repoId, effectiveSource, props.relPath);
    diffPlan.value = plan;
    diffRows.value = buildDiffRows(plan);
    currentChangeIndex.value = totalChanges.value > 0 ? 1 : 0;

    // Auto mark reviewed if content fits in viewport without scrolling (FR-6.7)
    nextTick(() => {
      const el = scrollContainerRef.value;
      if (el && el.scrollHeight <= el.clientHeight + 5) {
        sessionStore.markReviewed(props.relPath);
      }
    });
  } catch (err: any) {
    errorMsg.value = err.message || '差异计算失败';
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  loadDiff();
});

watch(() => [props.relPath, props.source, props.commitOid], () => {
  loadDiff();
});

const toggleFold = (row: AlignedDiffRow) => {
  if (!row.foldInfo) return;
  row.foldInfo.collapsed = !row.foldInfo.collapsed;
};

const markReviewed = () => {
  sessionStore.markReviewed(props.relPath);
};

const onScroll = () => {
  const el = scrollContainerRef.value;
  if (!el) return;
  // If user scrolls through content, mark as reviewed (FR-6.7)
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
    sessionStore.markReviewed(props.relPath);
  }
};

const jumpChange = (direction: 'next' | 'prev') => {
  const changeRowIndices: number[] = [];
  diffRows.value.forEach((r, idx) => {
    if (r.type === 'modify' || r.type === 'delete' || r.type === 'insert') {
      changeRowIndices.push(idx);
    }
  });

  if (changeRowIndices.length === 0) return;

  if (direction === 'next') {
    if (currentChangeIndex.value < changeRowIndices.length) {
      currentChangeIndex.value++;
    } else {
      // Reached end of changes in this file, advance to next file (FR-6.6)
      emit('next-file');
      return;
    }
  } else {
    if (currentChangeIndex.value > 1) {
      currentChangeIndex.value--;
    } else {
      emit('prev-file');
      return;
    }
  }

  const targetRowIdx = changeRowIndices[currentChangeIndex.value - 1];
  const rowEl = document.getElementById(`diff-row-${targetRowIdx}`);
  rowEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

const openContentViewer = () => {
  tabsStore.openTab({
    path: props.relPath,
    type: 'content',
    isPinned: true,
  });
};
</script>

<template>
  <div class="h-full flex flex-col bg-background overflow-hidden select-text text-xs">
    <!-- Action Bar -->
    <div class="h-8 min-h-[32px] bg-muted/40 border-b border-border/70 flex items-center justify-between px-3 text-xs select-none">
      <div class="flex items-center space-x-2 truncate">
        <span class="font-medium text-foreground truncate max-w-sm" :title="relPath">
          {{ relPath }}
        </span>
        <span
          v-if="diffPlan?.old_path && diffPlan.old_path !== relPath"
          class="text-muted-foreground text-[11px]"
        >
          (重命名自: {{ diffPlan.old_path }})
        </span>

        <!-- Stats -->
        <span v-if="diffPlan" class="text-[11px] font-mono flex items-center space-x-1.5 ml-2">
          <span class="text-emerald-600 dark:text-emerald-400">+{{ diffPlan.additions }}</span>
          <span class="text-rose-600 dark:text-rose-400">-{{ diffPlan.deletions }}</span>
        </span>
      </div>

      <!-- Controls -->
      <div class="flex items-center space-x-2">
        <!-- Change navigator -->
        <div v-if="totalChanges > 0" class="flex items-center space-x-1 text-muted-foreground text-[11px]">
          <span>变更 {{ currentChangeIndex }} / {{ totalChanges }}</span>
          <button
            type="button"
            class="p-0.5 hover:bg-muted rounded"
            title="上一处变更 (Shift+F7)"
            @click="jumpChange('prev')"
          >
            <ChevronUp class="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            class="p-0.5 hover:bg-muted rounded"
            title="下一处变更 (F7)"
            @click="jumpChange('next')"
          >
            <ChevronDown class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- File navigator -->
        <div class="flex items-center space-x-1 text-muted-foreground text-[11px] border-l border-border/70 pl-2">
          <button
            type="button"
            class="px-1.5 py-0.5 hover:bg-muted rounded flex items-center space-x-1"
            title="上一个变更文件 (Alt+↑)"
            @click="emit('prev-file')"
          >
            <ChevronUp class="w-3 h-3" />
            <span>上一个</span>
          </button>
          <button
            type="button"
            class="px-1.5 py-0.5 hover:bg-muted rounded flex items-center space-x-1"
            title="下一个变更文件 (Alt+↓)"
            @click="emit('next-file')"
          >
            <ChevronDown class="w-3 h-3" />
            <span>下一个</span>
          </button>
        </div>

        <!-- Review toggle -->
        <button
          type="button"
          class="px-2 py-0.5 rounded text-[11px] flex items-center space-x-1 transition-colors border"
          :class="[
            isReviewed
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'hover:bg-muted text-muted-foreground border-border/70'
          ]"
          @click="markReviewed"
        >
          <CheckCircle class="w-3 h-3" />
          <span>{{ isReviewed ? '已审阅' : '标记已看' }}</span>
        </button>

        <!-- View Full Content button -->
        <button
          type="button"
          class="px-2 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground text-[11px] flex items-center space-x-1 border border-border/70"
          title="查看完整内容"
          @click="openContentViewer"
        >
          <FileCode class="w-3 h-3" />
          <span>查看内容</span>
        </button>
      </div>
    </div>

    <!-- Degraded / Binary / Error Notices -->
    <div
      v-if="diffPlan?.tier === 'Degraded'"
      class="bg-amber-500/10 border-b border-amber-500/30 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400 flex items-center space-x-1.5"
    >
      <AlertTriangle class="w-3.5 h-3.5" />
      <span>文件较大，已降级为 Unified Hunk 展示（{{ diffPlan.reason || '超出完整档上限' }}）</span>
    </div>

    <div
      v-if="diffPlan?.tier === 'Rejected' || diffPlan?.is_binary"
      class="flex-1 flex flex-col items-center justify-center space-y-3 text-muted-foreground p-6"
    >
      <AlertTriangle class="w-10 h-10 stroke-[1.5] text-amber-500/80" />
      <p class="text-xs font-medium text-foreground">
        {{ diffPlan?.reason || (diffPlan?.is_binary ? '二进制文件，不展示内容' : '文件超出差异计算上限') }}
      </p>
      <div v-if="diffPlan" class="text-[11px] space-x-4">
        <span>变更前大小: {{ (diffPlan.old_size / 1024).toFixed(1) }} KB</span>
        <span>变更后大小: {{ (diffPlan.new_size / 1024).toFixed(1) }} KB</span>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-else-if="isLoading"
      class="flex-1 flex flex-col items-center justify-center space-y-2 text-muted-foreground"
    >
      <RefreshCw class="w-6 h-6 animate-spin text-primary" />
      <span class="text-xs">正在计算差异...</span>
    </div>

    <!-- Error State -->
    <div
      v-else-if="errorMsg"
      class="flex-1 flex flex-col items-center justify-center space-y-2 text-destructive p-4"
    >
      <AlertTriangle class="w-8 h-8" />
      <span class="text-xs font-medium">{{ errorMsg }}</span>
      <button
        type="button"
        class="mt-2 px-3 py-1 bg-secondary text-secondary-foreground rounded text-xs"
        @click="loadDiff"
      >
        重试
      </button>
    </div>

    <!-- Side-by-side diff table -->
    <div
      v-else
      ref="scrollContainerRef"
      class="flex-1 overflow-auto font-mono text-[11.5px] leading-5"
      @scroll="onScroll"
    >
      <table class="w-full border-collapse table-fixed select-text">
        <colgroup>
          <col class="w-10" />
          <col class="w-[calc(50%-2.5rem)]" />
          <col class="w-10" />
          <col class="w-[calc(50%-2.5rem)]" />
        </colgroup>

        <tbody>
          <template v-for="(row, rowIdx) in diffRows" :key="row.id">
            <!-- Fold row -->
            <tr v-if="row.type === 'fold'" class="bg-muted/60 border-y border-border/80 select-none">
              <td colspan="4" class="py-1 px-4 text-center text-muted-foreground text-[11px]">
                <button
                  type="button"
                  class="inline-flex items-center space-x-1.5 px-2.5 py-0.5 hover:bg-muted rounded text-primary hover:underline"
                  @click="toggleFold(row)"
                >
                  <FolderSync class="w-3 h-3" />
                  <span v-if="row.foldInfo?.collapsed">
                    展开 {{ row.foldInfo.endOldLineno - row.foldInfo.startOldLineno + 1 }} 行未变更内容
                  </span>
                  <span v-else>折叠此区域</span>
                </button>
              </td>
            </tr>

            <!-- Expanded hidden rows under fold -->
            <template v-if="row.type === 'fold' && !row.foldInfo?.collapsed">
              <tr
                v-for="subRow in row.foldInfo?.hiddenRows"
                :key="subRow.id"
                class="hover:bg-muted/50"
              >
                <td class="text-right pr-2 text-muted-foreground/60 select-none border-r border-border/50">
                  {{ subRow.left.lineno }}
                </td>
                <td class="px-2 whitespace-pre overflow-x-hidden border-r border-border/60">
                  {{ subRow.left.content }}
                </td>
                <td class="text-right pr-2 text-muted-foreground/60 select-none border-r border-border/50">
                  {{ subRow.right.lineno }}
                </td>
                <td class="px-2 whitespace-pre overflow-x-hidden">
                  {{ subRow.right.content }}
                </td>
              </tr>
            </template>

            <!-- Normal Diff Row -->
            <tr
              v-if="row.type !== 'fold'"
              :id="`diff-row-${rowIdx}`"
              class="border-b border-border/20 hover:bg-muted/30"
              :class="{
                'bg-rose-500/10 dark:bg-rose-950/30': row.type === 'delete',
                'bg-emerald-500/10 dark:bg-emerald-950/30': row.type === 'insert',
                'bg-amber-500/5': row.type === 'modify',
              }"
            >
              <!-- Left Line No -->
              <td
                class="text-right pr-2 select-none border-r border-border/50 font-mono text-muted-foreground/60"
                :class="{ 'bg-rose-500/20 text-rose-700 dark:text-rose-300': row.left.type === 'delete' }"
              >
                {{ row.left.lineno ?? '' }}
              </td>

              <!-- Left Content -->
              <td
                class="px-2 whitespace-pre overflow-x-hidden border-r border-border/70"
                :class="{ 'bg-rose-500/10 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200': row.left.type === 'delete' }"
              >
                <!-- Render inline highlights for left -->
                <template v-if="row.left.highlights && row.left.highlights.length > 0">
                  <span>{{ row.left.content.slice(0, row.left.highlights[0].start) }}</span>
                  <mark class="bg-rose-400/40 dark:bg-rose-500/40 text-inherit rounded-sm px-0.5">
                    {{ row.left.content.slice(row.left.highlights[0].start, row.left.highlights[0].end) }}
                  </mark>
                  <span>{{ row.left.content.slice(row.left.highlights[0].end) }}</span>
                </template>
                <template v-else>
                  {{ row.left.content }}
                </template>
              </td>

              <!-- Right Line No -->
              <td
                class="text-right pr-2 select-none border-r border-border/50 font-mono text-muted-foreground/60"
                :class="{ 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300': row.right.type === 'insert' }"
              >
                {{ row.right.lineno ?? '' }}
              </td>

              <!-- Right Content -->
              <td
                class="px-2 whitespace-pre overflow-x-hidden"
                :class="{ 'bg-emerald-500/10 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200': row.right.type === 'insert' }"
              >
                <!-- Render inline highlights for right -->
                <template v-if="row.right.highlights && row.right.highlights.length > 0">
                  <span>{{ row.right.content.slice(0, row.right.highlights[0].start) }}</span>
                  <mark class="bg-emerald-400/40 dark:bg-emerald-500/40 text-inherit rounded-sm px-0.5">
                    {{ row.right.content.slice(row.right.highlights[0].start, row.right.highlights[0].end) }}
                  </mark>
                  <span>{{ row.right.content.slice(row.right.highlights[0].end) }}</span>
                </template>
                <template v-else>
                  {{ row.right.content }}
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
