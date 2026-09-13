<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  X,
  Pin,
  FileText,
  FileCode,
  GitCompare,
  Eye,
  Code2,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-vue-next';
import { useTabsStore } from '../stores/tabs';
import { useGitDataStore } from '../stores/gitdata';
import { gitIpc } from '../lib/ipc';
import { renderMarkdown } from '../lib/markdownSanitize';
import DiffViewer from './DiffViewer.vue';

const tabsStore = useTabsStore();
const gitData = useGitDataStore();

const activeTab = computed(() => tabsStore.activeTab);

const isMarkdownRender = ref(true);
const content = ref('');
const isLoadingContent = ref(false);
const contentError = ref('');
const copied = ref(false);

const isMarkdown = computed(() => {
  if (!activeTab.value || activeTab.value.type !== 'content') return false;
  return activeTab.value.path.toLowerCase().endsWith('.md');
});

const renderedMarkdownHtml = computed(() => {
  if (!isMarkdown.value || !content.value) return '';
  return renderMarkdown(content.value);
});

const loadContent = async () => {
  if (!activeTab.value || activeTab.value.type !== 'content' || !gitData.repoId) return;
  isLoadingContent.value = true;
  contentError.value = '';
  content.value = '';

  try {
    const text = await gitIpc.readFileContent(gitData.repoId, activeTab.value.path);
    content.value = text;
  } catch (err: any) {
    contentError.value = err.message || '读取文件失败';
  } finally {
    isLoadingContent.value = false;
  }
};

onMounted(() => {
  loadContent();
});

watch(() => activeTab.value?.id, () => {
  if (activeTab.value?.type === 'content') {
    loadContent();
  }
});

const closeTab = (tabId: string) => {
  tabsStore.closeTab(tabId);
};

const pinTab = (tabId: string) => {
  tabsStore.pinTab(tabId);
};

const copyContent = async () => {
  if (!content.value) return;
  try {
    await navigator.clipboard.writeText(content.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {}
};

const openDiffForCurrentFile = () => {
  if (!activeTab.value) return;
  tabsStore.openTab({
    path: activeTab.value.path,
    type: 'diff',
    isPinned: true,
    diffSource: 'working',
  });
};

const toggleMarkdownMode = () => {
  isMarkdownRender.value = !isMarkdownRender.value;
};
</script>

<template>
  <div class="h-full flex flex-col bg-background overflow-hidden border-b border-border/70 text-xs select-none">
    <!-- Tabs Header Bar -->
    <div class="h-9 min-h-[36px] bg-muted/40 border-b border-border/70 flex items-center px-1 overflow-x-auto select-none space-x-1">
      <div
        v-for="tab in tabsStore.tabs"
        :key="tab.id"
        class="group h-7 px-2.5 flex items-center space-x-1.5 rounded-t text-xs border border-b-0 cursor-pointer max-w-[200px] transition-colors"
        :class="[
          tab.id === tabsStore.activeTabId
            ? 'bg-background border-border font-medium text-foreground'
            : 'bg-muted/20 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        ]"
        @click="tabsStore.setActiveTab(tab.id)"
        @dblclick="pinTab(tab.id)"
        @mouseup.middle.prevent="closeTab(tab.id)"
      >
        <!-- Icon -->
        <GitCompare v-if="tab.type === 'diff'" class="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <FileCode v-else class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

        <!-- Title -->
        <span
          class="truncate flex-1"
          :class="{ 'italic text-muted-foreground': !tab.isPinned }"
          :title="tab.path"
        >
          {{ tab.title }}
        </span>

        <!-- Pin icon if preview -->
        <button
          v-if="!tab.isPinned"
          type="button"
          class="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 transition-opacity"
          title="固定为常驻标签页"
          @click.stop="pinTab(tab.id)"
        >
          <Pin class="w-2.5 h-2.5" />
        </button>

        <!-- Close Button -->
        <button
          type="button"
          class="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="关闭 (Ctrl+W)"
          @click.stop="closeTab(tab.id)"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-hidden relative">
      <!-- Empty State -->
      <div
        v-if="!activeTab"
        class="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2 p-6"
      >
        <FileText class="w-10 h-10 stroke-[1.5] text-muted-foreground/50" />
        <p class="text-xs">未打开任何文件</p>
        <p class="text-[11px] text-muted-foreground/70">从左侧文件树选择文件，或从下方选择变更查看差异</p>
      </div>

      <!-- Diff View -->
      <div v-else-if="activeTab.type === 'diff'" class="h-full w-full">
        <DiffViewer
          :rel-path="activeTab.path"
          :source="activeTab.diffSource || 'working'"
          :commit-oid="activeTab.commitOid"
          @next-file="$emit('next-file')"
          @prev-file="$emit('prev-file')"
        />
      </div>

      <!-- File Content View -->
      <div v-else-if="activeTab.type === 'content'" class="h-full flex flex-col overflow-hidden">
        <!-- Header Bar -->
        <div class="h-8 min-h-[32px] bg-muted/20 border-b border-border/60 flex items-center justify-between px-3 text-xs select-none">
          <span class="text-muted-foreground font-mono truncate" :title="activeTab.path">
            {{ activeTab.path }}
          </span>

          <div class="flex items-center space-x-2">
            <!-- Markdown Render/Source Toggle -->
            <button
              v-if="isMarkdown"
              type="button"
              class="px-2 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground flex items-center space-x-1 border border-border/60"
              @click="toggleMarkdownMode"
            >
              <Eye v-if="!isMarkdownRender" class="w-3 h-3" />
              <Code2 v-else class="w-3 h-3" />
              <span>{{ isMarkdownRender ? '查看源码' : '渲染预览' }}</span>
            </button>

            <!-- Compare / Diff button -->
            <button
              type="button"
              class="px-2 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground flex items-center space-x-1 border border-border/60"
              title="查看当前文件的未提交改动差异"
              @click="openDiffForCurrentFile"
            >
              <GitCompare class="w-3 h-3" />
              <span>查看差异</span>
            </button>

            <!-- Copy button -->
            <button
              type="button"
              class="px-2 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground flex items-center space-x-1 border border-border/60"
              @click="copyContent"
            >
              <Check v-if="copied" class="w-3 h-3 text-emerald-500" />
              <Copy v-else class="w-3 h-3" />
              <span>{{ copied ? '已复制' : '复制内容' }}</span>
            </button>
          </div>
        </div>

        <!-- Content Body -->
        <div class="flex-1 overflow-auto p-4 select-text">
          <div v-if="isLoadingContent" class="flex items-center justify-center h-48 space-x-2 text-muted-foreground">
            <RefreshCw class="w-5 h-5 animate-spin text-primary" />
            <span>正在加载文件内容...</span>
          </div>

          <div v-else-if="contentError" class="p-4 bg-destructive/10 text-destructive rounded flex items-center space-x-2">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            <span>{{ contentError }}</span>
          </div>

          <!-- Markdown rendered HTML -->
          <div
            v-else-if="isMarkdown && isMarkdownRender"
            class="prose prose-sm dark:prose-invert max-w-none text-foreground font-sans leading-relaxed"
            v-html="renderedMarkdownHtml"
          />

          <!-- Text / Code viewer with line numbers -->
          <div v-else class="font-mono text-[11.5px] leading-5 whitespace-pre">
            <div
              v-for="(line, idx) in content.split('\n')"
              :key="idx"
              class="flex hover:bg-muted/30 -mx-4 px-4"
            >
              <span class="w-12 text-right pr-4 select-none text-muted-foreground/60 flex-shrink-0">
                {{ idx + 1 }}
              </span>
              <span class="flex-1 overflow-x-auto">{{ line }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
