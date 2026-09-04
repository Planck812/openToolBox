<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { emitTo, listen } from '@tauri-apps/api/event';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { info as logInfo, error as logError } from '@tauri-apps/plugin-log';
import { getToolById } from '@/tools/registry';
import { loadPipelines, type SavedPipeline } from '@/tools/text-processor/pipeline-store';
import { applyThemeMode } from '@/lib/theme';
import { FileText, Home, Search } from 'lucide-vue-next';

const { t } = useI18n();
const store = useAppStore();
const currentWindow = getCurrentWindow();

/** 搜索词：后端显示窗口时从剪贴板刷新 */
const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);

/** 用户已保存的文本处理管线（无则整行不显示，最多取 4 个） */
const savedPipelines = ref<SavedPipeline[]>([]);

/** 推荐工具：与首页同口径（score>=30 强命中），最多 4 个 */
const recommended = computed(() =>
  store
    .recommendTools(query.value)
    .filter((m) => m.score >= 30)
    .slice(0, 4)
    .map((m) => ({ toolId: m.toolId, tool: getToolById(m.toolId) }))
    .filter((r): r is { toolId: string; tool: NonNullable<ReturnType<typeof getToolById>> } => Boolean(r.tool))
);

/** 读取剪贴板内容填充搜索词并聚焦；同时刷新用户管线 */
const loadClipboard = async () => {
  try {
    const text = await readText();
    if (text) query.value = text;
  } catch {
    // 剪贴板不可读时保持空输入，仍可手动输入
  }
  savedPipelines.value = loadPipelines();
  selectedIndex.value = 0;
  inputRef.value?.focus();
};

/** 打开工具：通知主窗口跳转并携带当前输入作为 initial-data，随后隐藏小窗 */
const openTool = (toolId: string) => {
  void logInfo(
    `quicklaunch openTool -> emitTo main quicklaunch_open_tool { toolId: ${toolId}, inputLen: ${query.value.length} }`,
  );
  void emitTo('main', 'quicklaunch_open_tool', { toolId, input: query.value })
    .then(() => logInfo(`quicklaunch openTool emitTo succeeded: ${toolId}`))
    .catch((e) => logError(`quicklaunch openTool emitTo FAILED: ${toolId}`, e));
  void currentWindow.hide();
};

/** 打开文本处理管线：通知主窗口后台执行该管线并回写剪贴板（不进入工具页），随后隐藏小窗 */
const openPipeline = (name: string) => {
  void logInfo(`quicklaunch openPipeline -> emitTo main quicklaunch_run_pipeline { target: ${name} }`);
  void emitTo('main', 'quicklaunch_run_pipeline', { target: name, input: query.value })
    .catch((e) => logError(`quicklaunch openPipeline emitTo FAILED: ${name}`, e));
  void currentWindow.hide();
};

/** 打开完整首页 */
const openHome = () => {
  void logInfo('quicklaunch openHome -> emitTo main quicklaunch_open_home');
  void emitTo('main', 'quicklaunch_open_home').catch((e) => logError('quicklaunch openHome emitTo FAILED', e));
  void currentWindow.hide();
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    void currentWindow.hide();
    return;
  }
  const count = recommended.value.length;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (count) openTool(recommended.value[selectedIndex.value % count].toolId);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % Math.max(count, 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + Math.max(count, 1)) % Math.max(count, 1);
  }
};

/** 根容器 ref：用于量取内容高度，让窗口随内容包裹 */
const rootRef = ref<HTMLElement | null>(null);
const MIN_WINDOW_H = 160;
const MAX_WINDOW_H = 520;
let lastWindowHeight = 0;
let resizeObserver: ResizeObserver | null = null;
let unlistenQuickLaunch: (() => void) | null = null;
let cancelled = false;

/**
 * 根据内容高度动态调整窗口尺寸：内容少则小框、推荐变多则随之长高。
 * 高度上限内优先让推荐列表自然展开；超过上限时由列表内部滚动兜底。
 */
const resizeToContent = () => {
  const el = rootRef.value;
  if (!el) return;
  const height = Math.min(Math.max(el.offsetHeight, MIN_WINDOW_H), MAX_WINDOW_H);
  if (height !== lastWindowHeight) {
    lastWindowHeight = height;
    void currentWindow.setSize(new LogicalSize(600, height));
    void currentWindow.center();
  }
};

onMounted(async () => {
  // 跟随用户主题（独立 WebView，需自行应用）
  applyThemeMode(store.themeMode, store.themeSkinId);
  // 内容变化（输入/推荐增减）→ 窗口高度自适应
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeToContent());
    if (rootRef.value) resizeObserver.observe(rootRef.value);
  }
  // 后端每次显示窗口都会 emit quick_launch_requested → 刷新剪贴板并聚焦
  const unlistenFn = await listen('quick_launch_requested', () => {
    if (cancelled) return;
    void loadClipboard();
  });
  // 监听注册期间组件已卸载：立即释放刚注册的监听，避免泄漏。
  if (cancelled) {
    unlistenFn();
    return;
  }
  unlistenQuickLaunch = unlistenFn;
  await loadClipboard();
});

onUnmounted(() => {
  cancelled = true;
  resizeObserver?.disconnect();
  unlistenQuickLaunch?.();
});
</script>

<template>
  <div ref="rootRef" class="ql-root">
    <div class="ql-panel">
      <div class="ql-input-row">
        <Search class="ql-search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          class="ql-input"
          :placeholder="t('common.quick_launch_placeholder')"
          @keydown="handleKeydown"
        />
      </div>

      <ul v-if="recommended.length" class="ql-list">
        <li v-for="(item, index) in recommended" :key="item.toolId">
          <button
            type="button"
            class="ql-item ql-tool-item"
            :class="{ 'is-selected': selectedIndex % recommended.length === index }"
            @mouseenter="selectedIndex = index"
            @click="openTool(item.toolId)"
          >
            <span class="ql-icon">
              <component :is="item.tool.metadata.icon" class="h-5 w-5" />
            </span>
            <span class="ql-name">{{ t(item.tool.metadata.name) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="ql-empty">{{ t('common.quick_launch_no_match') }}</p>

      <div v-if="savedPipelines.length" class="ql-pipelines">
        <div class="ql-pipelines-title">{{ t('common.quick_launch_pipelines_title') }}</div>
        <ul class="ql-list">
          <li v-for="p in savedPipelines.slice(0, 4)" :key="p.name">
            <button
              type="button"
              class="ql-item ql-tool-item"
              :title="p.name"
              @click="openPipeline(p.name)"
            >
              <span class="ql-icon">
                <FileText class="h-5 w-5" />
              </span>
              <span class="ql-name">{{ p.name }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div class="ql-home">
        <button type="button" class="ql-item ql-home-item" @click="openHome">
          <span class="ql-icon">
            <Home class="h-5 w-5" />
          </span>
          <span class="ql-name">{{ t('common.quick_launch_open_home') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 不透明窗口：html/body 与卡片同色，去掉外层不同色的方框；四角同色直角 */
:global(html),
:global(body) {
  background: var(--skin-panel-bg);
}

.ql-root {
  display: flex;
  flex-direction: column;
  padding: 0;
  box-sizing: border-box;
  background: var(--skin-panel-bg);
}

.ql-panel {
  width: 100%;
  border-radius: 14px;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  overflow: hidden;
}

.ql-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid var(--skin-border);
}

.ql-search-icon {
  width: 18px;
  height: 18px;
  color: var(--skin-text-muted);
  flex-shrink: 0;
}

.ql-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--skin-text-strong);
  font-size: 15px;
  font-weight: 600;
}

.ql-input::placeholder {
  color: var(--skin-text-muted);
  font-weight: 500;
}

.ql-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

/* 推荐工具格：图标上、名称下，一行 4 个 */
.ql-tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 4px;
  font-size: 13px;
  text-align: center;
}

.ql-tool-item .ql-name {
  width: 100%;
  text-align: center;
}

.ql-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--skin-text-main);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.ql-item:hover,
.ql-item.is-selected {
  background: rgba(var(--skin-accent-rgb) / 0.12);
  color: var(--skin-text-strong);
}

.ql-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.1);
  flex-shrink: 0;
}

.ql-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ql-empty {
  margin: 0;
  padding: 20px 16px;
  color: var(--skin-text-muted);
  font-size: 13px;
  text-align: center;
}

.ql-pipelines {
  border-top: 1px solid var(--skin-border);
}

.ql-pipelines-title {
  padding: 8px 12px 2px;
  color: var(--skin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.ql-home {
  padding: 8px;
  border-top: 1px solid var(--skin-border);
}

.ql-home-item .ql-icon {
  color: var(--skin-text-muted);
  background: rgba(var(--skin-accent-rgb) / 0.06);
}
</style>
