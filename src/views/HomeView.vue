<script setup lang="ts">
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Check,
  CheckSquare,
  ChevronDown,
  Clock3,
  Code2,
  FileText,
  Grid3X3,
  Home,
  QrCode,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useQuickActions } from '@/composables/useQuickActions';
import { useToolDragSort, sortToolsByFavorite } from '@/composables/useToolDragSort';
import { useHomeKeyboardNav } from '@/composables/useHomeKeyboardNav';
import { getToolById, tools } from '@/tools/registry';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { copyText } from '@/lib/clipboard';
import { getTimestampQuickResults, getDefaultTimestampQuickResultIndex } from '@/tools/timestamp/quick-results';

import type { NavigationSection, SidebarMode } from './home-types';
type RegisteredTool = (typeof tools)[number];

const store = useAppStore();
const { searchQuery, inputContent, matchedTools, filteredTools, favoriteToolIds, recentToolIds, homeToolOrderIds, strongToolIds, homeMotionEnabled } = storeToRefs(store);
/** 收藏工具 ID 集合：供工具卡列表内多次判收藏使用，避免 v-for 内反复线性查找。 */
const favoriteToolIdSet = computed(() => new Set(favoriteToolIds.value));
const router = useRouter();
const { t } = useI18n();
const { quickResult, quickJoinPrefix, activeQuickActionKey, hasActivatedQuickWorkbench, quickActions } = useQuickActions({
  getInputContent: () => inputContent.value,
});
const openTool = (id: string) => {
  store.addRecentTool(id);
  router.push(`/tool/${id}`);
};
const currentSidebarMode = ref<SidebarMode>('all');
const selectedCategoryKey = ref<string | null>(null);
const currentSection = ref<NavigationSection>('input');
const quickActionIndex = ref(0);
const recommendedIndex = ref(0);
const strongToolsIndex = ref(0);
const allToolsIndex = ref(0);
const timestampResultIndex = ref(0);
const { draggedToolId, dragOverToolId, isPointerDragging, dragGhostPosition, previewToolOrderIds, handleToolPointerDown, handleToolCardClick } = useToolDragSort({
  currentSidebarMode,
  currentSection,
  recommendedIndex,
  allToolsIndex,
  openTool,
  getBaseToolOrderIds: () => commandFilteredTools.value.map((tool) => tool.metadata.id),
});
const timestampResults = computed(() => getTimestampQuickResults(inputContent.value));
const hasTimestampResults = computed(() => timestampResults.value.length > 0);

const showQuickResultPane = computed(() =>
  Boolean(activeQuickActionKey.value || quickResult.value || hasTimestampResults.value)
);

type NavItem = {
  key: Exclude<SidebarMode, 'category'>;
  label: string;
  icon: Component;
};

type CategoryNavItem = {
  key: string;
  label: string;
  icon: Component;
  toolIds: string[];
};

type RecommendedCard = {
  id: string;
  title: string;
  description: string;
  icon: Component;
};

const primaryNavItems: NavItem[] = [
  { key: 'all', label: t('home.sidebar.home'), icon: Home },
  { key: 'favorites', label: t('home.sidebar.favorites'), icon: Star },
  { key: 'recent', label: t('home.sidebar.recent'), icon: Clock3 },
];

// 分类工具 ID 为手工维护的单一事实来源。ToolMetadata 目前只有 keywords、没有 tag/分类字段，
// 无法从 registry 派生；同一工具（如 qrcode-gen、image-base64）出现在多个分类是刻意设计的
// 多分类归属，不是复制粘贴重复，请勿当成冗余误删。
const categoryNavItems: CategoryNavItem[] = [
  { key: 'text', label: t('home.category.text'), icon: FileText, toolIds: ['text-split', 'text-join', 'text-dedup', 'text-processor', 'text-diff', 'regex-lab', 'memo'] },
  { key: 'data', label: t('home.category.data'), icon: Grid3X3, toolIds: ['json-viewer', 'json-diff', 'format-convert', 'timestamp', 'image-base64', 'qrcode-gen', 'uuid-generator', 'hash-tool', 'image-viewer'] },
  { key: 'encoding', label: t('home.category.encoding'), icon: Code2, toolIds: ['text-processor', 'qrcode-gen', 'image-base64', 'jwt-tool', 'json-viewer', 'hash-tool', 'format-convert'] },
  { key: 'format', label: t('home.category.format'), icon: CheckSquare, toolIds: ['json-viewer', 'json-diff', 'format-convert', 'text-split', 'text-join', 'text-processor', 'mermaid-preview'] },
  { key: 'utility', label: t('home.category.utility'), icon: Briefcase, toolIds: ['port-killer', 'calculator', 'memo', 'uuid-generator', 'qrcode-gen', 'env-setter', 'screenshot-universal', 'curl-runner', 'ocr-tool', 'sticky-manager', 'sedentary-reminder', 'timer-center'] },
  { key: 'security', label: t('home.category.security'), icon: Shield, toolIds: ['jwt-tool', 'pwd-box', 'totp-2fa', 'uuid-generator', 'hash-tool', 'aes-tool'] },
  { key: 'stats', label: t('home.category.stats'), icon: BarChart3, toolIds: ['calculator', 'text-diff'] },
];

const toolToneClasses = [
  'tone-blue',
  'tone-sky',
  'tone-violet',
  'tone-mint',
  'tone-indigo',
  'tone-purple',
  'tone-blue',
  'tone-mint',
  'tone-orange',
  'tone-teal',
  'tone-rose',
  'tone-amber',
  'tone-violet',
  'tone-indigo',
  'tone-orange',
  'tone-rose',
  'tone-pink',
  'tone-blue',
];

const featuredCards = computed<RecommendedCard[]>(() => [
  {
    id: 'text-processor',
    title: t('home.featured.text_processor_title'),
    description: t('home.featured.text_processor_description'),
    icon: getToolById('text-processor')?.metadata.icon ?? FileText,
  },
  {
    id: 'qrcode-gen',
    title: t('home.featured.qrcode_title'),
    description: t('home.featured.qrcode_description'),
    icon: getToolById('qrcode-gen')?.metadata.icon ?? QrCode,
  },
]);

const strongMatchedTools = computed(() => matchedTools.value.filter((match) => match.score >= 30));
const recommendedCards = computed<RecommendedCard[]>(() => {
  if (strongMatchedTools.value.length === 0) {
    return featuredCards.value.slice(0, 6);
  }

  return strongMatchedTools.value.slice(0, 6).map((match) => {
    const tool = getToolById(match.toolId);
    return {
      id: match.toolId,
      title: t(tool?.metadata.name || ''),
      description: t(tool?.metadata.description || ''),
      icon: tool?.metadata.icon ?? FileText,
    };
  });
});
const hasKeyboardRecommended = computed(() => strongMatchedTools.value.length > 0);
const showRecommendedPanel = computed(() => currentSidebarMode.value === 'all');

const getToolsByIds = (ids: string[]) =>
  ids
    .map((id) => getToolById(id))
    .filter((tool): tool is RegisteredTool => Boolean(tool));

// 强力工具：用户自定义入口（默认 文本处理/备忘录/密码夹/提示词库），不参与搜索过滤与拖拽排序。
const strongTools = computed(() => getToolsByIds(strongToolIds.value));
const strongToolIdSet = computed(() => new Set(strongToolIds.value));
const strongToolsEditorOpen = ref(false);

const closeStrongToolsEditor = () => {
  strongToolsEditorOpen.value = false;
};

/** 面板打开期间拦截按键冒泡，避免方向键继续驱动首页卡片导航；Esc 关闭面板。 */
const handleStrongToolsEditorKeydown = (event: KeyboardEvent) => {
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeStrongToolsEditor();
  }
};

// 「所有工具」区块默认展开；支持点击标题折叠或展开。
const allToolsCollapsed = ref(false);
const isAllToolsExpanded = computed(() => !allToolsCollapsed.value || searchQuery.value.trim().length > 0);
const toggleAllTools = () => {
  allToolsCollapsed.value = !allToolsCollapsed.value;
};

/** 侧边栏切换后目标列表就在「所有工具」区块，先展开再走原导航逻辑。 */
const expandAndHandleSidebarMode = (mode: Exclude<SidebarMode, 'category'>) => {
  allToolsCollapsed.value = false;
  handleSidebarModeClick(mode);
};
const expandAndHandleCategoryClick = (categoryKey: string) => {
  allToolsCollapsed.value = false;
  handleCategoryClick(categoryKey);
};

const selectedCategory = computed(() =>
  categoryNavItems.find((item) => item.key === selectedCategoryKey.value) ?? null
);

const sidebarBaseTools = computed<RegisteredTool[]>(() => {
  if (currentSidebarMode.value === 'favorites') {
    return getToolsByIds(favoriteToolIds.value);
  }

  if (currentSidebarMode.value === 'recent') {
    return getToolsByIds(recentToolIds.value);
  }

  if (currentSidebarMode.value === 'category' && selectedCategory.value) {
    return getToolsByIds(selectedCategory.value.toolIds);
  }

  return tools;
});

const activeSidebarTitle = computed(() => {
  if (currentSidebarMode.value === 'favorites') return t('home.sidebar.favorites');
  if (currentSidebarMode.value === 'recent') return t('home.sidebar.recent');
  if (currentSidebarMode.value === 'category') return selectedCategory.value?.label ?? t('home.category_title');
  return t('home.all_tools');
});

const toolGridEmptyMessage = computed(() => {
  if (currentSidebarMode.value === 'favorites') return t('home.empty.favorites');
  if (currentSidebarMode.value === 'recent') return t('home.empty.recent');
  if (currentSidebarMode.value === 'category') return t('home.empty.category');
  return t('home.empty.all');
});

const commandFilteredTools = computed(() => {
  if (currentSidebarMode.value !== 'all') {
    return sidebarBaseTools.value;
  }

  if (previewToolOrderIds.value) {
    const toolMap = new Map(sidebarBaseTools.value.map((tool) => [tool.metadata.id, tool]));
    return [
      ...previewToolOrderIds.value.map((id) => toolMap.get(id)).filter((tool): tool is RegisteredTool => Boolean(tool)),
      ...sidebarBaseTools.value.filter((tool) => !previewToolOrderIds.value?.includes(tool.metadata.id)),
    ];
  }

  if (homeToolOrderIds.value.length > 0) {
    const toolMap = new Map(sidebarBaseTools.value.map((tool) => [tool.metadata.id, tool]));
    return [
      ...homeToolOrderIds.value.map((id) => toolMap.get(id)).filter((tool): tool is RegisteredTool => Boolean(tool)),
      ...sidebarBaseTools.value.filter((tool) => !homeToolOrderIds.value.includes(tool.metadata.id)),
    ];
  }

  return sortToolsByFavorite(sidebarBaseTools.value, favoriteToolIds.value);
});

const draggedTool = computed(() =>
  draggedToolId.value ? commandFilteredTools.value.find((tool) => tool.metadata.id === draggedToolId.value) ?? null : null
);

watch(
  timestampResults,
  (results) => {
    timestampResultIndex.value = getDefaultTimestampQuickResultIndex(inputContent.value, results);
    if (results.length === 0 && currentSection.value === 'timestampResults') {
      currentSection.value = 'input';
    }
  },
  { immediate: true }
);

/**
 * 将文本写入剪贴板（统一走 lib/clipboard 的多级兜底：Tauri → Web Clipboard → execCommand）
 * @param text 待复制文本
 */
const copyToClipboard = async (text: string) => {
  await copyText(text);
};

const copySelectedTimestampResult = async () => {
  const result = timestampResults.value[timestampResultIndex.value];
  if (!result) {
    return;
  }

  await copyToClipboard(result);
};

const moveTimestampSelection = (direction: 1 | -1) => {
  timestampResultIndex.value = clampIndex(timestampResultIndex.value + direction, timestampResults.value.length);
};

const handleTimestampResultClick = async (index: number) => {
  timestampResultIndex.value = index;
  currentSection.value = 'timestampResults';
  await copySelectedTimestampResult();
};

/**
 * 收起快速处理工作区，回到首页初始展开状态
 */
const collapseQuickWorkbench = () => {
  hasActivatedQuickWorkbench.value = false;
  activeQuickActionKey.value = null;
  quickResult.value = '';
  if (currentSection.value === 'input' || currentSection.value === 'timestampResults') {
    currentSection.value = 'quickActions';
  }
};

/**
 * 将索引收敛到合法范围，避免筛选变化后出现越界
 * @param index 当前索引
 * @param length 当前列表长度
 */
const clampIndex = (index: number, length: number) => {
  if (length <= 0) {
    return 0;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= length) {
    return length - 1;
  }

  return index;
};
const { handleHomeKeydown, handleSectionFocus, handleCommandInput, handleSearchInput, handleSidebarModeClick, handleCategoryClick, handleSettingsClick, handleFavoriteToggle, copyQuickPanelResult, rerunQuickAction, handleQuickActionClick } = useHomeKeyboardNav({
  currentSection, quickActionIndex, recommendedIndex, strongToolsIndex, allToolsIndex, timestampResultIndex,
  currentSidebarMode, selectedCategoryKey, searchQuery, inputContent,
  quickResult, activeQuickActionKey, hasActivatedQuickWorkbench,
  favoriteToolIds, recentToolIds,
  quickActions, recommendedCards, strongTools, commandFilteredTools, hasKeyboardRecommended, showRecommendedPanel, hasTimestampResults, strongMatchedTools, filteredTools,
  isAllToolsExpanded,
  clampIndex,
  copySelectedTimestampResult, copyToClipboard, moveTimestampSelection, openTool,
});

onMounted(async () => {
  try {
    const text = await readText();
    if (text) {
      inputContent.value = text;
    }
  } catch (e) {
    console.error('Failed to read clipboard', e);
  }
});

</script>

<template>
  <div
    data-testid="home-view"
    class="home-page flex h-full overflow-hidden"
    :class="{ 'home-page--motion-disabled': !homeMotionEnabled }"
    @keydown="handleHomeKeydown"
  >
    <aside class="home-sidebar hidden w-[210px] shrink-0 flex-col overflow-hidden px-3 py-4 md:flex">
      <div class="mb-8 flex shrink-0 items-center gap-3 px-2">
        <div class="brand-orbit">
          <span></span>
        </div>
        <div class="brand-name">Open-Toolbox</div>
      </div>

      <div class="sidebar-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        <nav class="space-y-1">
          <button
            v-for="item in primaryNavItems"
            :key="item.label"
            type="button"
            class="side-nav-item"
            :class="currentSidebarMode === item.key ? 'is-active' : ''"
            :aria-pressed="currentSidebarMode === item.key"
            @click="expandAndHandleSidebarMode(item.key)"
          >
            <component :is="item.icon" class="h-[18px] w-[18px]" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <div class="sidebar-divider my-5"></div>

        <div class="mb-3 px-4 text-[11px] font-bold uppercase tracking-[2px] sidebar-label">{{ t('home.sidebar.categories') }}</div>
        <nav class="space-y-1">
          <button
            v-for="item in categoryNavItems"
            :key="item.label"
            type="button"
            class="side-nav-item"
            :class="currentSidebarMode === 'category' && selectedCategoryKey === item.key ? 'is-active' : ''"
            :aria-pressed="currentSidebarMode === 'category' && selectedCategoryKey === item.key"
            @click="expandAndHandleCategoryClick(item.key)"
          >
            <component :is="item.icon" class="h-[18px] w-[18px]" />
            <span>{{ item.label }}</span>
          </button>
        </nav>
      </div>

      <div class="sidebar-footer mt-4 shrink-0 space-y-2 pt-4">
        <button type="button" class="side-nav-item" @click="handleSettingsClick">
          <Settings class="h-[18px] w-[18px]" />
          <span>{{ t('common.settings_title') }}</span>
        </button>
      </div>
    </aside>

    <main data-testid="home-shell" class="home-main min-w-0 flex-1 overflow-y-auto px-5 pb-7 pt-6 md:px-7 lg:px-[30px]">
      <section
        data-testid="home-search-panel"
        class="hero-panel overflow-hidden rounded-[10px] tech-hud-corners"
      >
        <div data-testid="home-workbench" class="sr-only">{{ t('home.workbench.sr_only') }}</div>

        <div class="workbench-header grid min-h-[82px] items-center gap-5 border-b px-6 py-4 lg:grid-cols-[190px_minmax(320px,520px)_1fr_auto]">
          <div class="flex items-center gap-3">
            <span class="toolbox-logo-tile grid h-11 w-11 shrink-0 place-items-center rounded-[14px]">
              <Code2 class="h-6 w-6" />
            </span>
            <span>
              <span class="block text-[22px] font-black tracking-[-0.04em] hero-title">{{ t('home.hero.title') }}</span>
              <span class="mt-1 block text-[12px] font-bold hero-subtitle">{{ t('home.hero.subtitle') }}</span>
            </span>
          </div>

          <label class="hero-search flex h-[46px] items-center gap-3 rounded-full px-4">
            <Search class="h-5 w-5 shrink-0 search-icon" />
            <input
              v-model="searchQuery"
              data-nav-section="search"
              data-nav-item="search-main"
              :data-nav-selected="currentSection === 'search' ? 'true' : 'false'"
              class="min-w-0 flex-1 border-none bg-transparent text-[14px] font-semibold outline-none search-input"
              :placeholder="t('common.search_placeholder')"
              @focus="handleSectionFocus('search')"
              @input="handleSearchInput"
            />
            <button
              type="button"
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full search-submit"
              @click="currentSection = 'allTools'"
            >
              <ArrowRight class="h-5 w-5" />
            </button>
          </label>

          <div></div>
        </div>

        <section class="quick-row flex h-[56px] items-center gap-6 border-b px-7">
          <button
            v-for="(action, index) in quickActions"
            :key="action.key"
            type="button"
            data-nav-section="quickActions"
            :data-nav-item="index"
            :data-nav-selected="currentSection === 'quickActions' && quickActionIndex === index ? 'true' : 'false'"
            class="quick-action-tab relative inline-flex h-full items-center gap-2 text-[13px] font-black transition"
            :class="currentSection === 'quickActions' && quickActionIndex === index ? 'is-active' : index === 0 && currentSection !== 'quickActions' ? 'is-default' : ''"
            @click="handleQuickActionClick(index, action.execute)"
          >
            <component :is="action.icon" class="h-5 w-5" />
            <span>{{ t(action.key) }}</span>
          </button>
          <button
            v-if="hasActivatedQuickWorkbench"
            type="button"
            class="ml-auto inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold collapse-btn"
            @click="collapseQuickWorkbench"
          >
            {{ t('home.workbench.collapse') }}
          </button>
        </section>

        <section v-show="hasActivatedQuickWorkbench" class="quick-workbench quick-workbench-fixed grid gap-4 px-6 py-4 lg:grid-cols-2">
          <div class="workbench-panel workbench-panel-fixed flex h-[180px] min-h-0 flex-col rounded-[10px] p-4">
            <div class="mb-3 flex items-center gap-3 text-sm">
              <span class="font-black panel-label">{{ t('home.workbench.input_label') }}</span>
              <span class="text-xs font-bold panel-hint">{{ t('home.workbench.input_hint') }}</span>
              <label class="ml-auto inline-flex items-center gap-2">
                <span class="text-xs font-bold panel-hint">{{ t('home.workbench.prefix') }}</span>
                <input
                  v-model="quickJoinPrefix"
                  class="h-7 w-[140px] rounded-md border px-2 font-mono text-xs font-semibold outline-none prefix-input"
                  :placeholder="t('home.workbench.prefix_placeholder')"
                />
              </label>
            </div>
            <label class="code-editor-shell grid min-h-0 flex-1 grid-cols-[38px_1fr] overflow-hidden rounded-[9px] border">
              <span class="border-r px-3 py-3 text-center font-mono text-sm font-bold leading-6 line-number">1</span>
              <textarea
                v-model="inputContent"
                data-nav-section="input"
                data-nav-item="input-main"
                :data-nav-selected="currentSection === 'input' ? 'true' : 'false'"
                class="h-full resize-none overflow-y-auto border-none bg-transparent px-4 py-3 font-mono text-sm font-semibold leading-6 outline-none input-area"
                :placeholder="t('home.workbench.input_placeholder')"
                @focus="handleSectionFocus('input')"
                @input="handleCommandInput"
              ></textarea>
            </label>
          </div>

          <div class="result-panel workbench-panel workbench-panel-fixed flex h-[180px] min-h-0 flex-col rounded-[10px] p-4">
            <div class="mb-3 flex items-center justify-between gap-3 text-sm">
              <span class="font-black panel-label">
                {{ t('home.workbench.result_label') }}
                <span class="sr-only">{{ hasTimestampResults ? t('home.workbench.timestamp_quick') : t('tools.text_processor.output_title') }}</span>
              </span>
              <div class="inline-flex items-center gap-3">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-xs font-bold action-btn"
                  :disabled="!showQuickResultPane"
                  @click="rerunQuickAction"
                >
                  <Sparkles class="h-4 w-4" />
                  <span>{{ t('home.workbench.rerun') }}</span>
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-xs font-bold action-btn"
                  :disabled="!showQuickResultPane"
                  @click="copyQuickPanelResult"
                >
                  <FileText class="h-4 w-4" />
                  <span>{{ t('home.workbench.copy_result') }}</span>
                </button>
              </div>
            </div>
            <div v-if="hasTimestampResults" class="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto rounded-[9px] border p-3 timestamp-grid sm:grid-cols-2">
              <button
                v-for="(result, index) in timestampResults"
                :key="`timestamp-result-${index}`"
                type="button"
                class="timestamp-row rounded-[8px] border px-3 py-2 text-left font-mono text-sm font-bold transition"
                :class="timestampResultIndex === index ? 'is-selected' : ''"
                data-nav-section="timestampResults"
                :data-nav-item="index"
                :data-nav-selected="timestampResultIndex === index ? 'true' : 'false'"
                @click="handleTimestampResultClick(index)"
                @focus="handleSectionFocus('timestampResults')"
              >
                {{ result }}
              </button>
            </div>
            <pre v-else class="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border p-3 font-mono text-sm leading-6 result-pre">{{ quickResult || t('home.workbench.waiting_result') }}</pre>
            <textarea v-if="!hasTimestampResults && quickResult" v-model="quickResult" readonly class="sr-only" aria-hidden="true"></textarea>
          </div>
        </section>
      </section>

      <section v-if="showRecommendedPanel" class="mt-6">
        <h3 class="section-title">{{ t('common.recommended') }}</h3>
        <div data-testid="tool-grid-recommended" class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1440px]:grid-cols-5 2xl:grid-cols-6">
          <button
            v-for="(card, index) in recommendedCards"
            :key="card.id"
            type="button"
            :data-testid="`tool-card-${card.id}`"
            data-nav-section="recommended"
            :data-nav-item="card.id"
            :data-nav-selected="hasKeyboardRecommended && currentSection === 'recommended' && recommendedIndex === index ? 'true' : 'false'"
            class="tool-card recommended-tool-card flex h-[86px] items-center gap-4 rounded-[14px] px-4 text-left"
            :class="[toolToneClasses[index % toolToneClasses.length], currentSection === 'recommended' && recommendedIndex === index ? 'is-selected' : '']"
            :title="card.description"
            @click="handleToolCardClick('recommended', index, card.id)"
          >
            <span class="tool-icon grid h-[44px] w-[44px] shrink-0 place-items-center rounded-[15px]">
              <component :is="card.icon" class="h-6 w-6" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] font-black tool-name">{{ card.title }}</span>
            </span>
          </button>
        </div>
      </section>

      <section class="mt-6">
        <div class="flex items-center justify-between gap-3">
          <h3 class="section-title">{{ t('home.strong_tools') }}</h3>
          <button
            type="button"
            data-testid="strong-tools-customize-button"
            class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold strong-customize-btn"
            :aria-expanded="strongToolsEditorOpen"
            @click="strongToolsEditorOpen = true"
          >
            <SlidersHorizontal class="h-3.5 w-3.5" />
            {{ t('home.strong_tools_customize') }}
          </button>
        </div>
        <div v-if="strongTools.length > 0" data-testid="tool-grid-strong" class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1440px]:grid-cols-5 2xl:grid-cols-6">
          <div
            v-for="(tool, index) in strongTools"
            :key="tool.metadata.id"
            role="button"
            tabindex="0"
            :data-testid="`tool-card-${tool.metadata.id}`"
            data-nav-section="strongTools"
            :data-nav-item="tool.metadata.id"
            :data-nav-selected="currentSection === 'strongTools' && strongToolsIndex === index ? 'true' : 'false'"
            class="tool-card group relative flex h-[86px] cursor-pointer items-center gap-4 rounded-[14px] px-4 pr-10 text-left"
            :class="[
              toolToneClasses[index % toolToneClasses.length],
              currentSection === 'strongTools' && strongToolsIndex === index ? 'is-selected' : '',
            ]"
            :title="t(tool.metadata.description)"
            @click="openTool(tool.metadata.id)"
            @keydown.enter.prevent="openTool(tool.metadata.id)"
          >
            <span class="tool-icon grid h-[44px] w-[44px] shrink-0 place-items-center rounded-[15px]">
              <component :is="tool.metadata.icon" class="h-6 w-6" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[14px] font-black tool-name">{{ t(tool.metadata.name) }}</span>
            </span>
            <button
              type="button"
              class="favorite-pin absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full transition hover:scale-110"
              :class="favoriteToolIdSet.has(tool.metadata.id) ? 'is-favorite' : ''"
              :aria-label="favoriteToolIdSet.has(tool.metadata.id) ? t('home.unfavorite_aria', { name: t(tool.metadata.name) }) : t('home.favorite_aria', { name: t(tool.metadata.name) })"
              :data-testid="`favorite-tool-${tool.metadata.id}`"
              @click.stop="handleFavoriteToggle(tool.metadata.id)"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <Star class="h-4 w-4" :fill="favoriteToolIdSet.has(tool.metadata.id) ? 'currentColor' : 'none'" />
            </button>
          </div>
        </div>
        <div
          v-else
          data-testid="strong-tools-empty"
          class="mt-3 rounded-[18px] border border-dashed px-5 py-8 text-center text-sm font-bold empty-grid"
        >
          {{ t('home.strong_tools_empty') }}
        </div>
      </section>

      <section class="mt-6">
        <button
          type="button"
          data-testid="all-tools-toggle"
          class="section-title section-toggle"
          :aria-expanded="isAllToolsExpanded"
          @click="toggleAllTools"
        >
          <ChevronDown class="section-chevron" :class="{ 'is-collapsed': !isAllToolsExpanded }" />
          <span>{{ activeSidebarTitle }}</span>
          <span class="section-count">{{ commandFilteredTools.length }}</span>
        </button>
        <div v-if="isAllToolsExpanded" data-testid="tool-grid" class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1440px]:grid-cols-5 2xl:grid-cols-6">
          <div
            v-for="(tool, index) in commandFilteredTools"
            :key="tool.metadata.id"
            role="button"
            tabindex="0"
            :data-testid="`tool-card-${tool.metadata.id}`"
            data-nav-section="allTools"
            :data-nav-item="tool.metadata.id"
            :data-nav-selected="currentSection === 'allTools' && allToolsIndex === index ? 'true' : 'false'"
            class="tool-card group relative flex h-[86px] cursor-pointer items-center gap-4 rounded-[14px] px-4 pr-10 text-left"
            :class="[
              toolToneClasses[index % toolToneClasses.length],
              currentSection === 'allTools' && allToolsIndex === index ? 'is-selected' : '',
              draggedToolId === tool.metadata.id ? 'is-dragging' : '',
              dragOverToolId === tool.metadata.id ? 'is-drag-over' : '',
            ]"
            :title="t(tool.metadata.description)"
            @click="handleToolCardClick('allTools', index, tool.metadata.id)"
            @keydown.enter.prevent="handleToolCardClick('allTools', index, tool.metadata.id)"
            @pointerdown="handleToolPointerDown(tool.metadata.id, index, $event)"
          >
            <span class="tool-icon grid h-[44px] w-[44px] shrink-0 place-items-center rounded-[15px]">
              <component :is="tool.metadata.icon" class="h-6 w-6" />
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[14px] font-black tool-name">{{ t(tool.metadata.name) }}</span>
            </span>
            <button
              type="button"
              class="favorite-pin absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full transition hover:scale-110"
              :class="favoriteToolIdSet.has(tool.metadata.id) ? 'is-favorite' : ''"
              :aria-label="favoriteToolIdSet.has(tool.metadata.id) ? t('home.unfavorite_aria', { name: t(tool.metadata.name) }) : t('home.favorite_aria', { name: t(tool.metadata.name) })"
              :data-testid="`favorite-tool-${tool.metadata.id}`"
              @pointerdown.stop
              @click.stop="handleFavoriteToggle(tool.metadata.id)"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <Star class="h-4 w-4" :fill="favoriteToolIdSet.has(tool.metadata.id) ? 'currentColor' : 'none'" />
            </button>
          </div>
        </div>
        <div
          v-if="isAllToolsExpanded && commandFilteredTools.length === 0"
          data-testid="tool-grid-empty"
          class="mt-3 rounded-[18px] border border-dashed px-5 py-8 text-center text-sm font-bold empty-grid"
        >
          {{ toolGridEmptyMessage }}
        </div>
      </section>
    </main>

    <div
      v-if="draggedTool && isPointerDragging"
      class="tool-drag-ghost pointer-events-none fixed z-[9999] flex h-[86px] w-[230px] items-center gap-4 rounded-[14px] px-4 pr-10 text-left"
      :style="{ left: `${dragGhostPosition.x}px`, top: `${dragGhostPosition.y}px` }"
    >
      <span class="tool-icon grid h-[44px] w-[44px] shrink-0 place-items-center rounded-[15px]">
        <component :is="draggedTool.metadata.icon" class="h-6 w-6" />
      </span>
      <span class="min-w-0">
        <span class="block truncate text-[14px] font-black tool-name">{{ t(draggedTool.metadata.name) }}</span>
        <span class="mt-1 block truncate text-[12px] font-semibold tool-desc">{{ t(draggedTool.metadata.description) }}</span>
      </span>
    </div>

    <div
      v-if="strongToolsEditorOpen"
      data-testid="strong-tools-editor"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeStrongToolsEditor"
      @keydown="handleStrongToolsEditorKeydown"
    >
      <div class="strong-editor-panel flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] border">
        <div class="flex items-start justify-between gap-3 border-b px-5 py-4 strong-editor-border">
          <div>
            <h4 class="text-base font-black strong-editor-title">{{ t('home.strong_tools_customize_title') }}</h4>
            <p class="mt-1 text-xs font-semibold strong-editor-hint">{{ t('home.strong_tools_customize_hint') }}</p>
          </div>
          <button
            type="button"
            data-testid="strong-tools-editor-close"
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full transition strong-editor-close"
            :aria-label="t('home.strong_tools_close_aria')"
            @click="closeStrongToolsEditor"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="tool in tools"
              :key="tool.metadata.id"
              type="button"
              :data-testid="`strong-tool-option-${tool.metadata.id}`"
              class="flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition strong-editor-option"
              :class="strongToolIdSet.has(tool.metadata.id) ? 'is-picked' : ''"
              :aria-pressed="strongToolIdSet.has(tool.metadata.id)"
              @click="store.toggleStrongTool(tool.metadata.id)"
            >
              <span class="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border strong-editor-checkbox" :class="strongToolIdSet.has(tool.metadata.id) ? 'is-checked' : ''">
                <Check v-if="strongToolIdSet.has(tool.metadata.id)" class="h-3.5 w-3.5" />
              </span>
              <component :is="tool.metadata.icon" class="h-4 w-4 shrink-0 strong-editor-tool-icon" />
              <span class="min-w-0 flex-1 truncate text-sm font-bold strong-editor-title">{{ t(tool.metadata.name) }}</span>
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between gap-3 border-t px-5 py-4 strong-editor-border">
          <button
            type="button"
            data-testid="strong-tools-editor-reset"
            class="text-xs font-bold strong-editor-hint transition hover:underline"
            @click="store.resetStrongToolIds"
          >
            {{ t('home.strong_tools_reset') }}
          </button>
          <button
            type="button"
            data-testid="strong-tools-editor-done"
            class="rounded-full strong-editor-done px-5 py-2 text-sm font-bold"
            @click="closeStrongToolsEditor"
          >
            {{ t('home.strong_tools_done') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.home-page {
  font-family: "Microsoft YaHei UI", "HarmonyOS Sans SC", "Segoe UI", sans-serif;
  color: var(--skin-text-main);
  background: transparent;
  position: relative;
}

/* ============ Sidebar ============ */
.home-sidebar {
  border-right: 1px solid var(--skin-border);
  background: var(--skin-sidebar-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: inset -1px 0 0 rgba(var(--skin-accent-rgb) / 0.05), 18px 0 48px rgba(0, 0, 0, 0.08);
  position: relative;
}

.home-sidebar::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--skin-grid-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--skin-grid-color) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.5;
  mask-image: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.4) 20%, rgba(0, 0, 0, 0.4) 80%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.4) 20%, rgba(0, 0, 0, 0.4) 80%, transparent);
}

.brand-orbit {
  position: relative;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
}

.brand-orbit::before,
.brand-orbit::after {
  position: absolute;
  content: "";
  inset: 3px;
  border: 2px solid transparent;
  border-top-color: var(--skin-accent);
  border-left-color: var(--skin-accent-2);
  border-radius: 999px;
  transform: rotate(-35deg);
  animation: brand-rotate 6s linear infinite;
}

.brand-orbit::after {
  inset: 8px;
  border-top-color: var(--skin-accent-2);
  border-left-color: transparent;
  transform: rotate(36deg);
  animation: brand-rotate 4s linear infinite reverse;
}

@keyframes brand-rotate {
  to { transform: rotate(325deg); }
}

.brand-orbit span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--skin-accent);
  box-shadow: 0 0 0 4px rgba(var(--skin-accent-rgb) / 0.15), 0 0 12px rgba(var(--skin-accent-rgb) / 0.5);
}

.home-page--motion-disabled .brand-orbit::before,
.home-page--motion-disabled .brand-orbit::after {
  animation: none;
}

.home-page--motion-disabled .tool-card {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.brand-name {
  font-size: 17px;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--skin-text-strong), var(--skin-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.sidebar-label {
  color: var(--skin-text-muted);
  font-family: "Consolas", "SF Mono", monospace;
}

.sidebar-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--skin-border), transparent);
}

.sidebar-footer {
  border-top: 1px solid var(--skin-border);
}

.side-nav-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 13px;
  border-radius: 8px;
  padding: 13px 20px;
  color: var(--skin-text-main);
  font-size: 14px;
  font-weight: 700;
  transition: all 0.2s ease;
  position: relative;
}

.side-nav-item svg {
  color: var(--skin-text-muted);
  transition: all 0.2s ease;
}

.side-nav-item:hover {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.08);
  transform: translateX(2px);
}

.side-nav-item:hover svg {
  color: var(--skin-accent);
}

.side-nav-item.is-active {
  color: var(--skin-sidebar-active-text);
  background: var(--skin-sidebar-active-bg);
  box-shadow: inset 2px 0 0 var(--skin-accent), 0 0 16px rgba(var(--skin-accent-rgb) / 0.12);
}

.side-nav-item.is-active svg {
  color: var(--skin-accent);
  filter: drop-shadow(0 0 6px rgba(var(--skin-accent-rgb) / 0.4));
}

.sidebar-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--skin-accent-rgb) / 0.3) transparent;
}

.sidebar-scroll::-webkit-scrollbar {
  width: 6px;
}

.sidebar-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(var(--skin-accent-rgb) / 0.3);
}

/* ============ Main Area ============ */
.home-main {
  background: transparent;
  position: relative;
}

.home-main::-webkit-scrollbar {
  width: 8px;
}

.home-main::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(var(--skin-accent-rgb) / 0.3);
}

/* ============ Hero Panel ============ */
.hero-panel {
  position: relative;
  background: var(--skin-panel-bg);
  border: 1px solid var(--skin-border);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: var(--skin-glow);
}

.hero-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 84% 22%, rgba(var(--skin-accent-rgb) / 0.08), transparent 28%),
    radial-gradient(circle at 18% 20%, rgba(var(--skin-accent-rgb) / 0.06), transparent 37%);
  opacity: 0.8;
}

.workbench-header {
  border-bottom: 1px solid var(--skin-border);
  background: linear-gradient(90deg, rgba(var(--skin-accent-rgb) / 0.03), transparent 50%);
  position: relative;
}

.quick-row {
  border-bottom: 1px solid var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.02);
}

.toolbox-logo-tile {
  background: linear-gradient(135deg, rgba(var(--skin-accent-rgb) / 0.2), rgba(var(--skin-accent-rgb) / 0.08));
  color: var(--skin-accent);
  border: 1px solid rgba(var(--skin-accent-rgb) / 0.25);
  box-shadow: 0 0 16px rgba(var(--skin-accent-rgb) / 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.hero-title {
  color: var(--skin-text-strong);
  text-shadow: 0 0 1px rgba(var(--skin-accent-rgb) / 0.1);
}

.hero-subtitle {
  color: var(--skin-text-muted);
  font-family: "Consolas", "SF Mono", monospace;
  letter-spacing: 0.5px;
}

/* ============ Search ============ */
.hero-search {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 4px 14px rgba(0, 0, 0, 0.06);
  transition: all 0.2s ease;
  position: relative;
  z-index: 3;
}

.hero-search:focus-within {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  box-shadow: 0 0 0 3px rgba(var(--skin-accent-rgb) / 0.12), 0 0 20px rgba(var(--skin-accent-rgb) / 0.15);
}

.search-icon {
  color: var(--skin-text-muted);
}

.search-input {
  color: var(--skin-text-strong);
}

.search-input::placeholder {
  color: var(--skin-text-subtle);
}

.search-submit {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2));
  color: white;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
}

.search-submit:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(var(--skin-accent-rgb) / 0.5), 0 0 16px rgba(var(--skin-accent-rgb) / 0.3);
}

/* ============ Quick Actions ============ */
.quick-action-tab {
  color: var(--skin-text-main);
  position: relative;
}

.quick-action-tab svg {
  color: var(--skin-accent);
  filter: drop-shadow(0 0 4px rgba(var(--skin-accent-rgb) / 0.3));
}

.quick-action-tab:hover {
  color: var(--skin-accent);
}

.quick-action-tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: transparent;
  content: "";
  transition: all 0.2s ease;
}

.quick-action-tab.is-active::after,
.quick-action-tab.is-default::after {
  background: linear-gradient(90deg, var(--skin-accent), var(--skin-accent-2));
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.6), 0 0 4px rgba(var(--skin-accent-rgb) / 0.4);
}

.collapse-btn {
  border-color: var(--skin-border);
  color: var(--skin-text-muted);
  background: var(--skin-panel-bg);
  transition: all 0.2s ease;
}

.collapse-btn:hover {
  border-color: var(--skin-accent);
  color: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.15);
}

/* ============ Workbench ============ */
.quick-workbench {
  background:
    radial-gradient(circle at 12% 0%, rgba(var(--skin-accent-rgb) / 0.06), transparent 30%),
    rgba(var(--skin-accent-rgb) / 0.02);
  border-top: 1px solid var(--skin-border);
}

.quick-workbench-fixed {
  overflow: hidden;
}

.workbench-panel {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft);
  position: relative;
}

.workbench-panel-fixed {
  min-height: 0;
  overflow: hidden;
}

.workbench-panel-fixed .code-editor-shell,
.workbench-panel-fixed .result-panel pre,
.workbench-panel-fixed .timestamp-row {
  min-height: 100px;
}

.panel-label {
  color: var(--skin-text-strong);
}

.panel-hint {
  color: var(--skin-text-muted);
}

.prefix-input {
  border-color: var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-strong);
  transition: all 0.2s ease;
}

.prefix-input:focus {
  border-color: var(--skin-accent);
  box-shadow: 0 0 0 2px rgba(var(--skin-accent-rgb) / 0.15);
}

.code-editor-shell {
  border-color: var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.02);
}

.line-number {
  border-right-color: var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.04);
  color: var(--skin-text-muted);
  font-family: "Consolas", "SF Mono", monospace;
}

.input-area {
  color: var(--skin-text-strong);
}

.input-area::placeholder {
  color: var(--skin-text-subtle);
}

.action-btn {
  color: var(--skin-text-muted);
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  color: var(--skin-accent);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.timestamp-grid {
  border-color: var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.02);
}

.timestamp-row {
  border-color: var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-strong);
  transition: all 0.2s ease;
}

.timestamp-row:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  background: rgba(var(--skin-accent-rgb) / 0.06);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.timestamp-row.is-selected {
  border-color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.12);
  box-shadow: 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.3), 0 0 16px rgba(var(--skin-accent-rgb) / 0.2);
}

.result-pre {
  border-color: var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.02);
  color: var(--skin-text-main);
}

/* ============ Section Title ============ */
.section-title {
  color: var(--skin-text-strong);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.01em;
  position: relative;
  padding-left: 14px;
}

.section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--skin-accent), var(--skin-accent-2));
  box-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.5);
}

/* 可折叠分区标题（「所有工具」）：button 重置 + 展开态指示 */
.section-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  transition: color 0.2s ease;
}

.section-toggle:hover {
  color: var(--skin-accent);
}

.section-chevron {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--skin-text-muted);
  transition: transform 0.2s ease;
}

.section-chevron.is-collapsed {
  transform: rotate(-90deg);
}

.section-count {
  margin-left: auto;
  min-width: 22px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.06);
  color: var(--skin-text-muted);
  font-size: 12px;
  font-weight: 800;
  font-family: "Consolas", "SF Mono", monospace;
  text-align: center;
}

/* ============ Tool Cards ============ */
.tool-card {
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: var(--skin-glow-soft);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: grab;
  position: relative;
  overflow: hidden;
}

.tool-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 12% 12%, rgba(var(--skin-accent-rgb) / 0.06), transparent 32%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.tool-card:hover {
  transform: translateY(-2px);
  border-color: rgba(var(--skin-accent-rgb) / 0.4);
  box-shadow: var(--skin-glow), 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.1);
}

.tool-card:hover::before {
  opacity: 1;
}

.tool-card:active {
  cursor: grabbing;
}

.recommended-tool-card,
.recommended-tool-card:active {
  cursor: pointer;
}

.tool-card.is-selected {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  box-shadow: var(--skin-glow), 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.2);
}

.tool-card.is-dragging {
  opacity: 0.52;
  transform: scale(0.98);
  filter: saturate(0.78);
}

.tool-card.is-drag-over {
  border-color: rgba(var(--skin-accent-rgb) / 0.6);
  box-shadow: 0 0 0 2px rgba(var(--skin-accent-rgb) / 0.2), var(--skin-glow);
}

.tool-name {
  color: var(--skin-text-strong);
}

.tool-desc {
  color: var(--skin-text-muted);
}

/* ============ Tool Icons (tone variants) ============ */
.toolbox-logo-tile,
.tool-icon,
.quick-icon {
  position: relative;
}

.tone-blue .tool-icon {
  color: #4a8cff;
  background: linear-gradient(135deg, rgba(74, 140, 255, 0.18), rgba(74, 140, 255, 0.06));
  border: 1px solid rgba(74, 140, 255, 0.2);
  box-shadow: 0 0 12px rgba(74, 140, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-sky .tool-icon {
  color: #38bdf8;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.06));
  border: 1px solid rgba(56, 189, 248, 0.2);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-mint .tool-icon {
  color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(16, 185, 129, 0.06));
  border: 1px solid rgba(16, 185, 129, 0.2);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-violet .tool-icon {
  color: #8b5cf6;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(139, 92, 246, 0.06));
  border: 1px solid rgba(139, 92, 246, 0.2);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-indigo .tool-icon {
  color: #6366f1;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(99, 102, 241, 0.06));
  border: 1px solid rgba(99, 102, 241, 0.2);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-purple .tool-icon {
  color: #a855f7;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.18), rgba(168, 85, 247, 0.06));
  border: 1px solid rgba(168, 85, 247, 0.2);
  box-shadow: 0 0 12px rgba(168, 85, 247, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-orange .tool-icon,
.tone-amber .tool-icon {
  color: #f59e0b;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.06));
  border: 1px solid rgba(245, 158, 11, 0.2);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-teal .tool-icon {
  color: #14b8a6;
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.18), rgba(20, 184, 166, 0.06));
  border: 1px solid rgba(20, 184, 166, 0.2);
  box-shadow: 0 0 12px rgba(20, 184, 166, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.tone-rose .tool-icon,
.tone-pink .tool-icon {
  color: #ec4899;
  background: linear-gradient(135deg, rgba(236, 72, 153, 0.18), rgba(236, 72, 153, 0.06));
  border: 1px solid rgba(236, 72, 153, 0.2);
  box-shadow: 0 0 12px rgba(236, 72, 153, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

/* ============ Favorite Pin ============ */
.favorite-pin {
  color: var(--skin-text-muted);
  background: rgba(var(--skin-accent-rgb) / 0.04);
  border: 1px solid var(--skin-border);
  transition: all 0.2s ease;
}

.favorite-pin:hover {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.12);
  border-color: rgba(var(--skin-accent-rgb) / 0.3);
}

.favorite-pin.is-favorite {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.15);
  border-color: rgba(251, 191, 36, 0.3);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.2);
}

/* ============ Empty Grid ============ */
.empty-grid {
  border-color: var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-muted);
}

/* ============ Drag Ghost ============ */
.tool-drag-ghost {
  border: 1px solid rgba(var(--skin-accent-rgb) / 0.5);
  background: var(--skin-panel-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: 0 24px 50px rgba(0, 0, 0, 0.2), 0 0 28px rgba(var(--skin-accent-rgb) / 0.25);
  transform: translate(-50%, -50%) rotate(-2deg) scale(1.04);
  animation: drag-ghost-in 0.12s ease both;
}

@keyframes drag-ghost-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(-2deg) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(-2deg) scale(1.04);
  }
}

/* ============ Animations ============ */
.result-panel {
  animation: panel-in 0.22s ease both;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ============ Strong Tools Customize ============ */
.strong-customize-btn {
  border-color: var(--skin-border);
  color: var(--skin-text-muted);
  background: var(--skin-panel-bg);
  transition: all 0.2s ease;
}

.strong-customize-btn:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  color: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.15);
}

.strong-editor-panel {
  background: var(--skin-panel-bg);
  border-color: var(--skin-border);
  box-shadow: 0 24px 50px rgba(0, 0, 0, 0.2), var(--skin-glow-soft);
}

.strong-editor-border {
  border-color: var(--skin-border);
}

.strong-editor-title {
  color: var(--skin-text-strong);
}

.strong-editor-hint {
  color: var(--skin-text-muted);
}

.strong-editor-close {
  border: 1px solid var(--skin-border);
  color: var(--skin-text-muted);
  background: transparent;
}

.strong-editor-close:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  color: var(--skin-accent);
}

.strong-editor-option {
  border-color: var(--skin-border);
  background: rgba(var(--skin-accent-rgb) / 0.02);
  color: var(--skin-text-main);
}

.strong-editor-option:hover {
  border-color: rgba(var(--skin-accent-rgb) / 0.4);
  background: rgba(var(--skin-accent-rgb) / 0.06);
}

.strong-editor-option.is-picked {
  border-color: rgba(var(--skin-accent-rgb) / 0.5);
  background: rgba(var(--skin-accent-rgb) / 0.1);
  box-shadow: 0 0 0 1px rgba(var(--skin-accent-rgb) / 0.15), 0 0 12px rgba(var(--skin-accent-rgb) / 0.1);
}

.strong-editor-checkbox {
  border-color: var(--skin-border);
  background: var(--skin-panel-bg);
  color: transparent;
  transition: all 0.15s ease;
}

.strong-editor-checkbox.is-checked {
  border-color: var(--skin-accent);
  background: var(--skin-accent);
  color: #ffffff;
}

.strong-editor-tool-icon {
  color: var(--skin-accent);
}

.strong-editor-done {
  background: linear-gradient(135deg, var(--skin-accent), var(--skin-accent-2));
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(var(--skin-accent-rgb) / 0.4);
  transition: all 0.2s ease;
}

.strong-editor-done:hover {
  transform: scale(1.03);
  box-shadow: 0 6px 20px rgba(var(--skin-accent-rgb) / 0.5);
}

/* ============ Responsive ============ */
@media (max-width: 767px) {
  .home-main {
    padding-top: 20px;
  }

  .hero-panel {
    border-radius: 8px;
  }
}
</style>