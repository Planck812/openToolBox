import { computed, ref, type Ref } from 'vue';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { tools } from '@/tools/registry';
import type { NavigationSection, SidebarMode } from '@/views/home-types';

/**
 * 收藏置顶 + 稳定排序：收藏项优先，其余保持原始相对顺序。
 * HomeView 的 `commandFilteredTools` 与本模块的 `getStableToolOrderIds` 共用同一规则。
 */
export function sortToolsByFavorite<T extends { metadata: { id: string } }>(
  items: T[],
  favoriteIds: string[],
): T[] {
  const favoriteSet = new Set(favoriteIds);
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftFavorite = favoriteSet.has(left.item.metadata.id);
      const rightFavorite = favoriteSet.has(right.item.metadata.id);
      if (leftFavorite !== rightFavorite) {
        return leftFavorite ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * 首页工具卡片「指针拖拽排序」子系统（拆分自 HomeView.vue）。
 *
 * 使用 PointerEvent 实现拖拽排序（规避 Tauri WebView 原生 drag 兼容问题）。
 * 为避免与 HomeView 的 `commandFilteredTools`（依赖本 composable 的 previewToolOrderIds）
 * 形成循环依赖，基础顺序通过 `getBaseToolOrderIds` 函数注入。
 */
export function useToolDragSort(deps: {
  currentSidebarMode: Ref<SidebarMode>;
  currentSection: Ref<NavigationSection>;
  recommendedIndex: Ref<number>;
  allToolsIndex: Ref<number>;
  openTool: (id: string) => void;
  /** 返回当前展示顺序的工具 id（通常为 commandFilteredTools 的 id 序列）。 */
  getBaseToolOrderIds: () => string[];
}) {
  const store = useAppStore();
  const { t } = useI18n();

  const draggedToolId = ref<string | null>(null);
  const dragOverToolId = ref<string | null>(null);
  const suppressNextToolClick = ref(false);
  const pointerDragStart = ref<{ toolId: string; index: number; x: number; y: number } | null>(null);
  const isPointerDragging = ref(false);
  const dragGhostPosition = ref({ x: 0, y: 0 });
  const previewToolOrderIds = ref<string[] | null>(null);
  const dragBaseOrderIds = ref<string[] | null>(null);
  const activeDragPointerId = ref<number | null>(null);
  const dragPointerElement = ref<HTMLElement | null>(null);

  const isAllToolsDragEnabled = computed(() => deps.currentSidebarMode.value === 'all');

  const getStableToolOrderIds = () => {
    if (store.homeToolOrderIds.length > 0) {
      const toolIds = tools.map((tool) => tool.metadata.id);
      return [
        ...store.homeToolOrderIds.filter((id) => toolIds.includes(id)),
        ...toolIds.filter((id) => !store.homeToolOrderIds.includes(id)),
      ];
    }

    return sortToolsByFavorite(tools, store.favoriteToolIds).map((tool) => tool.metadata.id);
  };

  const buildPreviewToolOrder = (sourceToolId: string | null, targetToolId: string | null) => {
    const baseOrder = dragBaseOrderIds.value ?? getStableToolOrderIds();
    if (!sourceToolId || !targetToolId || sourceToolId === targetToolId) {
      return baseOrder;
    }

    const nextOrder = baseOrder.filter((id) => id !== sourceToolId);
    const targetIndex = nextOrder.indexOf(targetToolId);
    if (targetIndex === -1) {
      return baseOrder;
    }

    nextOrder.splice(targetIndex, 0, sourceToolId);
    return nextOrder;
  };

  const setPreviewToolOrder = (nextOrder: string[]) => {
    const currentOrder = previewToolOrderIds.value?.join('|') ?? '';
    const incomingOrder = nextOrder.join('|');
    if (currentOrder === incomingOrder) {
      return;
    }

    const startViewTransition = document.startViewTransition;
    if (typeof startViewTransition === 'function') {
      startViewTransition(() => {
        previewToolOrderIds.value = nextOrder;
      });
      return;
    }

    previewToolOrderIds.value = nextOrder;
  };

  const saveHomeToolOrder = (nextOrder: string[], movedToolId: string) => {
    store.setHomeToolOrder(nextOrder);
    deps.allToolsIndex.value = nextOrder.indexOf(movedToolId);
    suppressNextToolClick.value = true;
    window.setTimeout(() => {
      suppressNextToolClick.value = false;
    }, 0);
    store.showToast(t('home.order_saved'), { type: 'success' });
  };

  const removeToolPointerListeners = () => {
    const element = dragPointerElement.value;
    if (!element) {
      return;
    }

    element.removeEventListener('pointermove', handleToolPointerMove);
    element.removeEventListener('pointerup', handleToolPointerUp);
    element.removeEventListener('pointercancel', handleToolPointerCancel);
  };

  const releaseToolPointerCapture = () => {
    const element = dragPointerElement.value;
    const pointerId = activeDragPointerId.value;
    if (!element || pointerId === null) {
      return;
    }

    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {}
  };

  const moveToolBeforeTarget = (sourceToolId: string | null, targetToolId: string | null) => {
    if (!sourceToolId || !targetToolId || sourceToolId === targetToolId) {
      return false;
    }

    const nextOrder = previewToolOrderIds.value ?? deps.getBaseToolOrderIds();
    const sourceIndex = nextOrder.indexOf(sourceToolId);
    const targetIndex = nextOrder.indexOf(targetToolId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return false;
    }

    const [movedToolId] = nextOrder.splice(sourceIndex, 1);
    const adjustedTargetIndex = nextOrder.indexOf(targetToolId);
    nextOrder.splice(adjustedTargetIndex, 0, movedToolId);
    saveHomeToolOrder(nextOrder, movedToolId);
    return true;
  };

  const resetToolDragState = () => {
    releaseToolPointerCapture();
    removeToolPointerListeners();
    draggedToolId.value = null;
    dragOverToolId.value = null;
    pointerDragStart.value = null;
    isPointerDragging.value = false;
    previewToolOrderIds.value = null;
    dragBaseOrderIds.value = null;
    activeDragPointerId.value = null;
    dragPointerElement.value = null;
  };

  const getToolIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest<HTMLElement>('[data-nav-section="allTools"]')?.dataset.navItem ?? null;
  };

  const handleToolPointerMove = (event: PointerEvent) => {
    const dragStart = pointerDragStart.value;
    if (!dragStart) return;

    const moveDistance = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
    if (!isPointerDragging.value && moveDistance < 8) {
      return;
    }

    event.preventDefault();
    isPointerDragging.value = true;
    draggedToolId.value = dragStart.toolId;
    dragGhostPosition.value = { x: event.clientX, y: event.clientY };
    const hoveredToolId = getToolIdFromPoint(event.clientX, event.clientY);
    const nextTargetToolId = hoveredToolId && hoveredToolId !== dragStart.toolId
      ? hoveredToolId
      : dragOverToolId.value;

    if (!nextTargetToolId) {
      return;
    }

    dragOverToolId.value = nextTargetToolId;
    setPreviewToolOrder(buildPreviewToolOrder(dragStart.toolId, nextTargetToolId));
  };

  const handleToolPointerUp = (event: PointerEvent) => {
    const sourceToolId = pointerDragStart.value?.toolId ?? null;
    const targetToolId = getToolIdFromPoint(event.clientX, event.clientY);
    const previewOrder = previewToolOrderIds.value;
    const shouldSavePreview = Boolean(isPointerDragging.value && sourceToolId && previewOrder?.includes(sourceToolId));
    const shouldReorder = isPointerDragging.value && sourceToolId && targetToolId && sourceToolId !== targetToolId;
    if (shouldSavePreview && sourceToolId && previewOrder) {
      saveHomeToolOrder(previewOrder, sourceToolId);
    } else if (shouldReorder) {
      moveToolBeforeTarget(sourceToolId, targetToolId);
    }
    resetToolDragState();
  };

  const handleToolPointerCancel = () => {
    resetToolDragState();
  };

  const handleToolPointerDown = (toolId: string, index: number, event: PointerEvent) => {
    if (!isAllToolsDragEnabled.value || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) return;
    const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!currentTarget) return;

    pointerDragStart.value = { toolId, index, x: event.clientX, y: event.clientY };
    dragGhostPosition.value = { x: event.clientX, y: event.clientY };
    dragBaseOrderIds.value = deps.getBaseToolOrderIds();
    activeDragPointerId.value = event.pointerId;
    dragPointerElement.value = currentTarget;
    deps.allToolsIndex.value = index;
    deps.currentSection.value = 'allTools';

    try {
      currentTarget.setPointerCapture(event.pointerId);
    } catch {}

    currentTarget.addEventListener('pointermove', handleToolPointerMove, { passive: false });
    currentTarget.addEventListener('pointerup', handleToolPointerUp);
    currentTarget.addEventListener('pointercancel', handleToolPointerCancel);
  };

  const handleToolCardClick = (section: 'recommended' | 'allTools', index: number, toolId: string) => {
    if (suppressNextToolClick.value) {
      suppressNextToolClick.value = false;
      return;
    }

    deps.currentSection.value = section;
    if (section === 'recommended') {
      deps.recommendedIndex.value = index;
    } else {
      deps.allToolsIndex.value = index;
    }
    deps.openTool(toolId);
  };

  return {
    draggedToolId,
    dragOverToolId,
    suppressNextToolClick,
    isPointerDragging,
    dragGhostPosition,
    previewToolOrderIds,
    dragBaseOrderIds,
    activeDragPointerId,
    dragPointerElement,
    isAllToolsDragEnabled,
    handleToolPointerDown,
    handleToolPointerUp,
    handleToolPointerCancel,
    handleToolCardClick,
  };
}
