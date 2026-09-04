/**
 * 首页键盘导航状态机（拆分自 HomeView.vue）。
 * 依赖的状态/computed/功能函数通过 deps 注入；store/router/t 内部获取。
 */
import { computed, watch } from 'vue';
import { useAppStore } from '@/store/app';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Ref, ComputedRef, Component } from 'vue';
import type { NavigationSection, SidebarMode } from '@/views/home-types';

export interface HomeKeyboardNavDeps {
  currentSection: Ref<NavigationSection>;
  quickActionIndex: Ref<number>;
  recommendedIndex: Ref<number>;
  strongToolsIndex: Ref<number>;
  allToolsIndex: Ref<number>;
  timestampResultIndex: Ref<number>;
  currentSidebarMode: Ref<SidebarMode>;
  selectedCategoryKey: Ref<string | null>;
  searchQuery: Ref<string>;
  inputContent: Ref<string>;
  quickResult: Ref<string>;
  activeQuickActionKey: Ref<string | null>;
  hasActivatedQuickWorkbench: Ref<boolean>;
  favoriteToolIds: Ref<string[]>;
  recentToolIds: Ref<string[]>;
  quickActions: ComputedRef<{ key: string; execute: () => Promise<void>; icon: Component }[]>;
  recommendedCards: ComputedRef<{ id: string; title: string; description: string; icon: Component }[]>;
  strongTools: ComputedRef<{ metadata: { id: string } }[]>;
  commandFilteredTools: ComputedRef<{ metadata: { id: string } }[]>;
  hasKeyboardRecommended: ComputedRef<boolean>;
  showRecommendedPanel: ComputedRef<boolean>;
  hasTimestampResults: ComputedRef<boolean>;
  strongMatchedTools: ComputedRef<{ toolId: string; score: number }[]>;
  filteredTools: ComputedRef<{ metadata: { id: string } }[]>;
  isAllToolsExpanded: ComputedRef<boolean>;
  clampIndex: (index: number, length: number) => number;
  copySelectedTimestampResult: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  moveTimestampSelection: (direction: 1 | -1) => void;
  openTool: (id: string) => void;
}

const sectionOrder: NavigationSection[] = [
  'search',
  'input',
  'timestampResults',
  'quickActions',
  'recommended',
  'strongTools',
  'allTools',
];

export function useHomeKeyboardNav(deps: HomeKeyboardNavDeps) {
  const store = useAppStore();
  const router = useRouter();
  const { t } = useI18n();
  const {
    currentSection,
    quickActionIndex,
    recommendedIndex,
    strongToolsIndex,
    allToolsIndex,
    timestampResultIndex,
    currentSidebarMode,
    selectedCategoryKey,
    searchQuery,
    quickResult,
    activeQuickActionKey,
    hasActivatedQuickWorkbench,
    favoriteToolIds,
    recentToolIds,
    quickActions,
    recommendedCards,
    strongTools,
    commandFilteredTools,
    hasKeyboardRecommended,
    showRecommendedPanel,
    hasTimestampResults,
    strongMatchedTools,
    filteredTools,
    isAllToolsExpanded,
    clampIndex,
    copySelectedTimestampResult,
    copyToClipboard,
    moveTimestampSelection,
    openTool,
  } = deps;

const syncNavigationState = () => {
  quickActionIndex.value = clampIndex(quickActionIndex.value, quickActions.value.length);
  recommendedIndex.value = clampIndex(recommendedIndex.value, recommendedCards.value.length);
  strongToolsIndex.value = clampIndex(strongToolsIndex.value, strongTools.value.length);
  allToolsIndex.value = clampIndex(allToolsIndex.value, commandFilteredTools.value.length);

  if (currentSection.value === 'recommended' && !hasKeyboardRecommended.value && strongTools.value.length > 0) {
    currentSection.value = 'strongTools';
  }

  if (currentSection.value === 'allTools' && !isAllToolsExpanded.value && strongTools.value.length > 0) {
    currentSection.value = 'strongTools';
  }

  if (currentSection.value === 'allTools' && commandFilteredTools.value.length === 0 && hasKeyboardRecommended.value) {
    currentSection.value = 'recommended';
  }
};

watch(() => recommendedCards.value.length, syncNavigationState, { immediate: true });
watch(() => strongMatchedTools.value.length, syncNavigationState, { immediate: true });
watch(() => filteredTools.value.length, syncNavigationState, { immediate: true });
watch(() => commandFilteredTools.value.length, syncNavigationState, { immediate: true });
watch(() => favoriteToolIds.value.length, syncNavigationState, { immediate: true });
watch(() => recentToolIds.value.length, syncNavigationState, { immediate: true });

/**
 * 判断分区是否存在可交互项
 * @param section 分区名称
 */
const isSectionInteractive = (section: NavigationSection) => {
  if (section === 'recommended') {
    return showRecommendedPanel.value && hasKeyboardRecommended.value;
  }

  if (section === 'strongTools') {
    return strongTools.value.length > 0;
  }

  if (section === 'allTools') {
    return isAllToolsExpanded.value && commandFilteredTools.value.length > 0;
  }

  if (section === 'timestampResults') {
    return hasTimestampResults.value;
  }

  if (section === 'quickActions') {
    return quickActions.value.length > 0;
  }

  return true;
};

const availableSections = computed<NavigationSection[]>(() => {
  return sectionOrder.filter((section) => isSectionInteractive(section));
});

/**
 * 输入区域聚焦时同步导航分区
 * @param section 目标分区
 */
const handleSectionFocus = (section: NavigationSection) => {
  currentSection.value = section;
};

/**
 * 输入行为发生时回收导航分区，避免工具区高亮残留
 * @param section 当前输入所在分区
 */
const handleSectionInput = (section: 'search' | 'input') => {
  currentSection.value = section;
};

/**
 * 主输入框输入（快速处理）：不参与工具推荐，清空搜索框，避免残留推荐。
 * 工具推荐只由搜索框驱动（matchedTools 基于 searchQuery）。
 */
const handleCommandInput = () => {
  searchQuery.value = '';
  handleSectionInput('input');
};

/**
 * 搜索框输入：驱动工具推荐；不写回主输入框，两框彻底解耦。
 */
const handleSearchInput = () => {
  handleSectionInput('search');
};

const handleSidebarModeClick = (mode: Exclude<SidebarMode, 'category'>) => {
  currentSidebarMode.value = mode;
  selectedCategoryKey.value = null;
  allToolsIndex.value = 0;
  currentSection.value = 'allTools';
};

const handleCategoryClick = (categoryKey: string) => {
  currentSidebarMode.value = 'category';
  selectedCategoryKey.value = categoryKey;
  allToolsIndex.value = 0;
  currentSection.value = 'allTools';
};

const handleSettingsClick = () => {
  router.push('/settings');
};

const isFavoriteTool = (toolId: string) => favoriteToolIds.value.includes(toolId);

const handleFavoriteToggle = (toolId: string) => {
  const willFavorite = !isFavoriteTool(toolId);
  store.toggleFavoriteTool(toolId);
  store.showToast(willFavorite ? t('home.favorited') : t('home.unfavorited'), { type: 'success' });
};

const copyQuickPanelResult = async () => {
  if (hasTimestampResults.value) {
    await copySelectedTimestampResult();
    return;
  }

  if (!quickResult.value) {
    return;
  }

  await copyToClipboard(quickResult.value);
  store.showToast(t('home.result_copied'), { type: 'success' });
};

/**
 * 判断当前键盘事件是否来自可编辑输入控件
 * @param event 键盘事件
 */
const isEditingTarget = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName === 'input') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
};

/**
 * 按当前快捷动作重新执行一次处理
 */
const rerunQuickAction = async () => {
  if (hasTimestampResults.value) {
    await copySelectedTimestampResult();
    return;
  }

  if (!activeQuickActionKey.value) {
    return;
  }

  const action = quickActions.value.find((item) => item.key === activeQuickActionKey.value);
  if (!action) {
    return;
  }

  await action.execute();
};

/**
 * 点击快捷操作时同步分区与索引，再执行业务逻辑
 * @param index 按钮索引
 * @param execute 业务函数
 */
const handleQuickActionClick = async (index: number, execute: () => Promise<void>) => {
  if (hasActivatedQuickWorkbench.value && currentSection.value === 'quickActions' && quickActionIndex.value === index) {
    hasActivatedQuickWorkbench.value = false;
    currentSection.value = 'input';
    return;
  }

  currentSection.value = 'quickActions';
  quickActionIndex.value = index;
  hasActivatedQuickWorkbench.value = true;
  await execute();
};

/**
 * 使用 Tab/Shift+Tab 在可见分区间循环切换
 * @param forward true 表示前进，false 表示后退
 */
const cycleSection = (forward: boolean) => {
  const sections = availableSections.value;
  if (sections.length === 0) {
    return;
  }
  const currentIndex = sections.indexOf(currentSection.value);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const delta = forward ? 1 : -1;
  const nextIndex = (normalizedIndex + delta + sections.length) % sections.length;
  currentSection.value = sections[nextIndex];
};

/**
 * 使用上下方向键按固定区域顺序跨区域跳转
 * @param direction 1 表示向下，-1 表示向上
 */
const moveBetweenSections = (direction: 1 | -1) => {
  const sections = availableSections.value;
  if (sections.length === 0) {
    return;
  }

  const currentIndex = sections.indexOf(currentSection.value);
  if (currentIndex === -1) {
    currentSection.value = sections[direction > 0 ? 0 : sections.length - 1];
    return;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= sections.length) {
    return;
  }

  currentSection.value = sections[nextIndex];
};

/**
 * 获取当前分区的已选工具 ID（若该分区是工具区）
 * @param section 导航分区
 */
const getSelectedToolId = (section: NavigationSection) => {
  if (section === 'recommended') {
    if (!hasKeyboardRecommended.value) {
      return null;
    }
    return recommendedCards.value[recommendedIndex.value]?.id ?? null;
  }

  if (section === 'strongTools') {
    return strongTools.value[strongToolsIndex.value]?.metadata.id ?? null;
  }

  if (section === 'allTools') {
    return commandFilteredTools.value[allToolsIndex.value]?.metadata.id ?? null;
  }

  return null;
};

/**
 * 执行当前快捷按钮
 */
const executeQuickAction = async () => {
  const action = quickActions.value[quickActionIndex.value];
  if (!action) {
    return;
  }
  await action.execute();
};

/**
 * 仅在可执行区域处理 Enter：快捷操作执行当前按钮，工具区打开当前选中工具
 */
const handleEnter = async () => {
  if (currentSection.value === 'timestampResults') {
    await copySelectedTimestampResult();
    return;
  }

  if (currentSection.value === 'quickActions') {
    await executeQuickAction();
    return;
  }

  const selectedToolId = getSelectedToolId(currentSection.value);
  if (selectedToolId) {
    openTool(selectedToolId);
    return;
  }
};

/**
 * 获取工具分区当前选中索引
 * @param section 工具分区
 */
const getToolIndex = (section: 'recommended' | 'strongTools' | 'allTools') => {
  if (section === 'recommended') return recommendedIndex.value;
  if (section === 'strongTools') return strongToolsIndex.value;
  return allToolsIndex.value;
};

/**
 * 设置工具分区当前选中索引
 * @param section 工具分区
 * @param nextIndex 目标索引
 */
const setToolIndex = (section: 'recommended' | 'strongTools' | 'allTools', nextIndex: number) => {
  if (section === 'recommended') {
    recommendedIndex.value = clampIndex(nextIndex, recommendedCards.value.length);
    return;
  }
  if (section === 'strongTools') {
    strongToolsIndex.value = clampIndex(nextIndex, strongTools.value.length);
    return;
  }
  allToolsIndex.value = clampIndex(nextIndex, commandFilteredTools.value.length);
};

/**
 * 处理左右方向键在快捷区/工具区的区域内移动
 * @param key 键值
 */
const handleHorizontalArrowKey = (key: 'ArrowLeft' | 'ArrowRight') => {
  if (currentSection.value === 'quickActions') {
    const step = key === 'ArrowLeft' ? -1 : 1;
    quickActionIndex.value = clampIndex(quickActionIndex.value + step, quickActions.value.length);
    return;
  }

  if (currentSection.value === 'recommended' || currentSection.value === 'strongTools' || currentSection.value === 'allTools') {
    const section = currentSection.value;
    if (key === 'ArrowLeft') {
      setToolIndex(section, getToolIndex(section) - 1);
      return;
    }
    setToolIndex(section, getToolIndex(section) + 1);
  }
};

/**
 * 首页根容器键盘状态机
 * @param event 键盘事件
 */
const handleHomeKeydown = async (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    if (isEditingTarget(event)) {
      // 焦点在输入框内：
      // - 尚未提交（section 仍是 search）→ 首次回车仅提交到工具区并高亮，不打开
      // - 已提交（section 已是工具区）→ 再次回车打开当前高亮工具
      // - 文本区（section 为 input）→ 吞掉，避免打字时误导航
      if (currentSection.value === 'search') {
        event.preventDefault();
        currentSection.value = 'allTools';
        // 对齐推荐区：allTools 高亮定位到内容识别排名第一的工具（md5 → hash-tool），实现统一口径。
        const topMatch = strongMatchedTools.value[0];
        if (topMatch) {
          const idx = commandFilteredTools.value.findIndex((tool) => tool.metadata.id === topMatch.toolId);
          if (idx !== -1) {
            allToolsIndex.value = idx;
          }
        }
        return;
      }
      if (
        (currentSection.value === 'recommended' || currentSection.value === 'strongTools' || currentSection.value === 'allTools') &&
        getSelectedToolId(currentSection.value)
      ) {
        event.preventDefault();
        await handleEnter();
      }
      return;
    }

    // 焦点不在输入框内，走常规导航回车
    if (currentSection.value === 'search' || currentSection.value === 'input') {
      return;
    }
    event.preventDefault();
    await handleEnter();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    cycleSection(!event.shiftKey);
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    // 主输入框是多行 textarea，↑/↓ 是移光标核心操作，不被跨区导航劫持。
    if (isEditingTarget(event) && currentSection.value === 'input') {
      return;
    }
    if (currentSection.value === 'timestampResults' && hasTimestampResults.value) {
      event.preventDefault();
      moveTimestampSelection(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    event.preventDefault();
    moveBetweenSections(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (currentSection.value !== 'quickActions' && currentSection.value !== 'recommended' && currentSection.value !== 'strongTools' && currentSection.value !== 'allTools') {
      return;
    }
    event.preventDefault();
    handleHorizontalArrowKey(event.key);
  }
};

  return {
    currentSection,
    quickActionIndex,
    recommendedIndex,
    allToolsIndex,
    timestampResultIndex,
    cycleSection,
    moveBetweenSections,
    handleHomeKeydown,
    handleSectionFocus,
    handleSectionInput,
    handleCommandInput,
    handleSearchInput,
    handleSidebarModeClick,
    handleCategoryClick,
    handleSettingsClick,
    handleFavoriteToggle,
    copyQuickPanelResult,
    isEditingTarget,
    rerunQuickAction,
    handleQuickActionClick,
    isFavoriteTool,
    availableSections,
  };
}
