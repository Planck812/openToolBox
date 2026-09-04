<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { Camera, Image as ImageIcon, Pin, RefreshCw, Save, Trash2 } from 'lucide-vue-next';
import { logContext } from '@/lib/logger';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'radix-vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { formatCreatedAt } from '@/tools/screenshot-universal/shared';
import {
  filterHistoryRecords,
  groupHistoryRecords,
  type HistoryRecordSummary,
} from '@/tools/screenshot-universal/shared/history-model';
import {
  historyClearAll,
  historyDeleteRecord,
  historyGetQuotaSettings,
  historyGetRecord,
  historyListRecords,
  historyReadImageToken,
  historyReadThumbnail,
  historySaveAs,
  historySetQuotaSettings,
  pinCreateFromHistory,
  screenshotUniversalStart,
  scrollCaptureCancel,
  scrollCaptureFinish,
  scrollCaptureHasResult,
  scrollCapturePublish,
  type HistoryRecordDetail,
  type HistoryQuotaSettings,
} from '@/lib/ipc/screenshot';

type ImageVariant = 'original' | 'final';

const { t } = useI18n();
const store = useAppStore();
const items = ref<HistoryRecordSummary[]>([]);
const starting = ref(false);
const selectedRecordId = ref<string | null>(null);
const detail = ref<HistoryRecordDetail | null>(null);
const imageUrl = ref('');
const activeVariant = ref<ImageVariant>('final');
const loading = ref(false);
const busyRecordId = ref<string | null>(null);
const thumbnailUrls = ref<Record<string, string>>({});
const unlistenHistory = ref<(() => void) | null>(null);
const unlistenScrollResult = ref<(() => void) | null>(null);
let isMounted = false;
let imageRequestVersion = 0;
let listRequestVersion = 0;
let thumbnailRequestVersion = 0;

const errorMessage = (error: unknown) =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error ?? t('tools.screenshot.unknown_error'));

// ---- 预览区缩放 / 拖拽 ----
const previewZoom = ref(100);
const previewPan = ref({ x: 0, y: 0 });
const previewPanning = ref(false);
const previewPanStart = ref({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
const previewViewportRef = ref<HTMLDivElement | null>(null);

const previewZoomStyle = computed(() => ({
  transform: `translate(${previewPan.value.x}px, ${previewPan.value.y}px) scale(${previewZoom.value / 100})`,
}));

const clampPreviewZoom = (value: number) => Math.min(400, Math.max(25, value));

const resetPreview = () => {
  previewZoom.value = 100;
  previewPan.value = { x: 0, y: 0 };
  previewPanning.value = false;
};

/** 切换图片时重置缩放与平移。 */
const resetPreviewForNewImage = () => resetPreview();

const handlePreviewWheel = (event: WheelEvent) => {
  if (!imageUrl.value) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 10 : -10;
  previewZoom.value = clampPreviewZoom(previewZoom.value + delta);
  if (previewZoom.value <= 100) previewPan.value = { x: 0, y: 0 };
};

const handlePreviewPointerDown = (event: PointerEvent) => {
  if (!imageUrl.value || event.button !== 0 || previewZoom.value <= 100) return;
  previewPanning.value = true;
  previewPanStart.value = {
    x: event.clientX,
    y: event.clientY,
    offsetX: previewPan.value.x,
    offsetY: previewPan.value.y,
  };
  try {
    previewViewportRef.value?.setPointerCapture(event.pointerId);
  } catch {}
};

const handlePreviewPointerMove = (event: PointerEvent) => {
  if (!previewPanning.value) return;
  previewPan.value = {
    x: previewPanStart.value.offsetX + event.clientX - previewPanStart.value.x,
    y: previewPanStart.value.offsetY + event.clientY - previewPanStart.value.y,
  };
};

const stopPreviewPanning = () => {
  previewPanning.value = false;
};

const handlePreviewDoubleClick = () => {
  if (!imageUrl.value) return;
  if (previewZoom.value > 100) resetPreview();
  else previewZoom.value = 200;
};

const revokeImageUrl = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = '';
};
const revokeThumbnail = (recordId: string) => {
  const url = thumbnailUrls.value[recordId];
  if (!url) return;
  URL.revokeObjectURL(url);
  const next = { ...thumbnailUrls.value };
  delete next[recordId];
  thumbnailUrls.value = next;
};
const revokeAllThumbnails = () => {
  Object.values(thumbnailUrls.value).forEach((url) => URL.revokeObjectURL(url));
  thumbnailUrls.value = {};
};

const loadThumbnails = async (records: HistoryRecordSummary[], version: number) => {
  const startTime = performance.now();
  const pending = records.filter((record) => !thumbnailUrls.value[record.recordId]);
  logContext('debug', 'Screenshot', 'loadThumbnails', `Loading ${pending.length} thumbnails`);

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      try {
        const itemStart = performance.now();
        const bytes = await historyReadThumbnail({ recordId: item.recordId });
        const itemDuration = performance.now() - itemStart;
        if (!isMounted || version !== thumbnailRequestVersion) return;
        if (!items.value.some((record) => record.recordId === item.recordId)) continue;
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        thumbnailUrls.value = { ...thumbnailUrls.value, [item.recordId]: url };
        if (itemDuration > 500) {
          logContext('warn', 'Screenshot', 'loadThumbnails', `Slow thumbnail load: ${item.recordId} duration=${itemDuration.toFixed(0)}ms`);
        }
      } catch {
        // 单条缩略图失败不阻塞列表。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  const totalDuration = performance.now() - startTime;
  logContext('debug', 'Screenshot', 'loadThumbnails', `Thumbnails loaded: ${pending.length} items duration=${totalDuration.toFixed(0)}ms`);
};

const readImage = async (token: string, variant: ImageVariant, version: number) => {
  const bytes = await historyReadImageToken({ token });
  if (!isMounted || version !== imageRequestVersion) return;
  revokeImageUrl();
  imageUrl.value = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  activeVariant.value = variant;
  resetPreviewForNewImage();
};

const loadSelectedRecord = async (recordId: string, variant: ImageVariant = 'final') => {
  if (!isMounted) return;
  const startTime = performance.now();
  const version = ++imageRequestVersion;
  selectedRecordId.value = recordId;
  detail.value = null;
  revokeImageUrl();
  logContext('debug', 'Screenshot', 'loadSelectedRecord', `Loading record: ${recordId}`);
  try {
    const next = await historyGetRecord({ recordId });
    if (!isMounted || version !== imageRequestVersion) return;
    detail.value = next;
    const duration = performance.now() - startTime;
    logContext('debug', 'Screenshot', 'loadSelectedRecord', `Record loaded: ${recordId} duration=${duration.toFixed(2)}ms`);
    await readImage(variant === 'original' ? next.originalToken : next.finalToken, variant, version);
  } catch (error) {
    const duration = performance.now() - startTime;
    logContext('error', 'Screenshot', 'loadSelectedRecord', `Record load failed: ${recordId} after ${duration.toFixed(0)}ms`, { error: String(error) });
    if (isMounted && version === imageRequestVersion) store.showToast(t('tools.screenshot.detail_failed', { error: errorMessage(error) }), { type: 'error' });
  }
};

const loadList = async (options?: { silent?: boolean; selectLatest?: boolean }) => {
  const startTime = performance.now();
  const version = ++listRequestVersion;
  loading.value = true;
  try {
    logContext('debug', 'Screenshot', 'loadList', 'Loading history records');
    const records = await historyListRecords();
    if (!isMounted || version !== listRequestVersion) return;
    const duration = performance.now() - startTime;
    logContext('info', 'Screenshot', 'loadList', `History loaded: ${records.length} records duration=${duration.toFixed(2)}ms`);

    items.value = records;
    const liveIds = new Set(records.map((record) => record.recordId));
    Object.keys(thumbnailUrls.value).forEach((recordId) => {
      if (!liveIds.has(recordId)) revokeThumbnail(recordId);
    });
    const thumbnailVersion = ++thumbnailRequestVersion;
    void loadThumbnails(records, thumbnailVersion);
    const exists = selectedRecordId.value && records.some((record) => record.recordId === selectedRecordId.value);
    if (!exists) {
      detail.value = null;
      revokeImageUrl();
      selectedRecordId.value = null;
    }
    if ((options?.selectLatest || !selectedRecordId.value) && records[0]) {
      await loadSelectedRecord(records[0].recordId);
    }
  } catch (error) {
    const duration = performance.now() - startTime;
    logContext('error', 'Screenshot', 'loadList', `History load failed after ${duration.toFixed(0)}ms`, { error: String(error) });
    if (!options?.silent && isMounted && version === listRequestVersion) {
      store.showToast(t('tools.screenshot.list_failed', { error: errorMessage(error) }), { type: 'error' });
    }
  } finally {
    if (isMounted && version === listRequestVersion) loading.value = false;
  }
};

const startCapture = async () => {
  if (starting.value) {
    logContext('warn', 'Screenshot', 'startCapture', 'Capture already in progress, skipping');
    return;
  }
  starting.value = true;
  const startTime = performance.now();
  try {
    logContext('info', 'Screenshot', 'startCapture', 'Starting universal screenshot capture');
    await screenshotUniversalStart();
    logContext('info', 'Screenshot', 'startCapture', `Capture initiated successfully duration=${(performance.now() - startTime).toFixed(0)}ms`);
  } catch (error) {
    const duration = performance.now() - startTime;
    logContext('error', 'Screenshot', 'startCapture', `Capture start failed after ${duration.toFixed(0)}ms`, { error: String(error) });
    store.showToast(t('tools.screenshot.screenshot_universal.start_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    starting.value = false;
  }
};

const switchVariant = async (variant: ImageVariant) => {
  if (!detail.value || activeVariant.value === variant) return;
  const version = ++imageRequestVersion;
  try {
    await readImage(variant === 'original' ? detail.value.originalToken : detail.value.finalToken, variant, version);
  } catch (error) {
    store.showToast(t('tools.screenshot.image_failed', { error: errorMessage(error) }), { type: 'error' });
  }
};

const pinImage = async (item: HistoryRecordSummary) => {
  if (!detail.value || item.recordId !== selectedRecordId.value || busyRecordId.value) return;
  busyRecordId.value = item.recordId;
  try {
    await pinCreateFromHistory({ recordId: item.recordId, variant: activeVariant.value });
    store.showToast(t('tools.screenshot.pin_success'), { type: 'success' });
  } catch (error) {
    store.showToast(t('tools.screenshot.pin_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    busyRecordId.value = null;
  }
};

const saveAsSelected = async () => {
  const recordId = selectedRecordId.value;
  if (!recordId || busyRecordId.value) return;
  busyRecordId.value = recordId;
  try {
    const result = await historySaveAs({ recordId, variant: activeVariant.value });
    if (result.saved) store.showToast(t('tools.screenshot.save_as_success'), { type: 'success' });
    else if (result.cancelled) store.showToast(t('tools.screenshot.save_as_cancelled'));
  } catch (error) {
    store.showToast(t('tools.screenshot.save_as_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    busyRecordId.value = null;
  }
};

/** 待确认操作：null 表示无对话框，'delete' 删除单条，'clear' 清空全部。 */
const pendingAction = ref<'delete' | 'clear' | null>(null);
const confirmDialogOpen = ref(false);

const requestConfirm = (action: 'delete' | 'clear') => {
  pendingAction.value = action;
  confirmDialogOpen.value = true;
};

const confirmPendingAction = async () => {
  const action = pendingAction.value;
  pendingAction.value = null;
  confirmDialogOpen.value = false;
  if (action === 'delete' && selectedItem.value) await deleteItem(selectedItem.value);
  else if (action === 'clear') await clearAll();
};

const deleteItem = async (item: HistoryRecordSummary) => {
  busyRecordId.value = item.recordId;
  try {
    const receipt = await historyDeleteRecord({ recordId: item.recordId });
    items.value = items.value.filter((entry) => entry.recordId !== receipt.recordId);
    revokeThumbnail(receipt.recordId);
    if (selectedRecordId.value === receipt.recordId) {
      selectedRecordId.value = null;
      detail.value = null;
      ++imageRequestVersion;
      revokeImageUrl();
      if (items.value[0]) void loadSelectedRecord(items.value[0].recordId);
    }
    store.showToast(t('tools.screenshot.delete_done'), { type: 'success' });
  } catch (error) {
    store.showToast(t('tools.screenshot.delete_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    busyRecordId.value = null;
  }
};

const selectedItem = computed(() => items.value.find((item) => item.recordId === selectedRecordId.value) ?? null);

// ---- 历史 UI 增强：搜索 / 来源过滤 / 配额 / 清空 ----
const searchQuery = ref('');
const sourceKindFilter = ref<string | null>(null);
const clearing = ref(false);
const quotaSettings = ref<HistoryQuotaSettings | null>(null);
const quotaLoading = ref(false);
const quotaSaving = ref(false);

const historySourceKinds = computed(() => {
  const kinds = new Set(items.value.map((r) => r.source.kind).filter(Boolean));
  return Array.from(kinds).sort();
});

/** 把来源枚举值翻译成用户可读的中文标签。 */
const sourceKindLabel = (kind: string) => {
  const key = `tools.screenshot.source_${kind}`;
  const label = t(key);
  return label === key ? kind : label;
};

const groupedItems = computed(() =>
  groupHistoryRecords(
    filterHistoryRecords(items.value, { sourceKind: sourceKindFilter.value, search: searchQuery.value }),
    'zh-CN',
    t('tools.screenshot.unknown_date'),
  ),
);

const resetHistoryFilters = () => {
  sourceKindFilter.value = null;
  searchQuery.value = '';
};

const clearAll = async () => {
  if (clearing.value) return;
  clearing.value = true;
  try {
    await historyClearAll();
    ++imageRequestVersion;
    items.value = [];
    selectedRecordId.value = null;
    detail.value = null;
    revokeImageUrl();
    store.showToast(t('tools.screenshot.clear_success', { count: 0 }), { type: 'success' });
  } catch (error) {
    store.showToast(t('tools.screenshot.clear_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    clearing.value = false;
  }
};

// ---- 滚动截图结果视图 ----
const scrollResult = ref<{ previewToken: string; url: string } | null>(null);
const scrollActionBusy = ref(false);

const showScrollResult = (previewToken: string) => {
  scrollResult.value = {
    previewToken,
    url: `http://scroll-image.localhost/${previewToken}`,
  };
};

const dismissScrollResult = () => {
  scrollResult.value = null;
  void scrollCaptureCancel().catch(() => {});
};

const scrollResultSave = async () => {
  if (scrollActionBusy.value || !scrollResult.value) return;
  scrollActionBusy.value = true;
  try {
    const published = await scrollCapturePublish();
    const result = await historySaveAs({
      recordId: published.recordId,
      variant: 'final',
    });
    if (result.saved) store.showToast(t('tools.screenshot.save_as_success'), { type: 'success' });
    else if (result.cancelled) store.showToast(t('tools.screenshot.save_as_cancelled'));
    scrollResult.value = null;
  } catch (error) {
    store.showToast(t('tools.screenshot.save_as_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    scrollActionBusy.value = false;
  }
};

const scrollResultCopy = async () => {
  if (scrollActionBusy.value || !scrollResult.value) return;
  scrollActionBusy.value = true;
  try {
    await scrollCaptureFinish({ action: 'copy' });
    store.showToast(t('tools.screenshot.copy_success'), { type: 'success' });
    scrollResult.value = null;
    void loadList({ silent: true, selectLatest: true });
  } catch (error) {
    store.showToast(t('tools.screenshot.pin_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    scrollActionBusy.value = false;
  }
};

const scrollResultPin = async () => {
  if (scrollActionBusy.value || !scrollResult.value) return;
  scrollActionBusy.value = true;
  try {
    await scrollCaptureFinish({ action: 'pin' });
    store.showToast(t('tools.screenshot.pin_success'), { type: 'success' });
    scrollResult.value = null;
    void loadList({ silent: true, selectLatest: true });
  } catch (error) {
    store.showToast(t('tools.screenshot.pin_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    scrollActionBusy.value = false;
  }
};

const loadQuotaSettings = async (options?: { silent?: boolean }) => {
  quotaLoading.value = true;
  try {
    quotaSettings.value = await historyGetQuotaSettings();
  } catch (error) {
    if (!options?.silent) store.showToast(t('tools.screenshot.quota_load_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    quotaLoading.value = false;
  }
};

const setQuota = async (quotaBytes: number) => {
  if (quotaSaving.value || quotaSettings.value?.quotaBytes === quotaBytes) return;
  quotaSaving.value = true;
  try {
    quotaSettings.value = await historySetQuotaSettings({ quotaBytes });
    store.showToast(t('tools.screenshot.quota_saved'), { type: 'success' });
  } catch (error) {
    store.showToast(t('tools.screenshot.quota_save_failed', { error: errorMessage(error) }), { type: 'error' });
  } finally {
    quotaSaving.value = false;
  }
};
// ---- 历史 UI 增强结束 ----

onMounted(() => {
  isMounted = true;
  void loadList({ silent: true });
  void loadQuotaSettings({ silent: true });
  window.addEventListener('pointermove', handlePreviewPointerMove);
  window.addEventListener('pointerup', stopPreviewPanning);
  window.addEventListener('pointercancel', stopPreviewPanning);
  listen<unknown>('screenshot_history_changed', () => {
    void loadList({ silent: true, selectLatest: true });
  }).then((unlisten) => {
    if (isMounted) unlistenHistory.value = unlisten;
    else unlisten();
  }).catch(() => {});
  listen<{ previewToken: string }>('scroll_capture_finished', (event) => {
    showScrollResult(event.payload.previewToken);
  }).then((unlisten) => {
    if (isMounted) unlistenScrollResult.value = unlisten;
    else unlisten();
  }).catch(() => {});
  // 主窗口恢复显示时，主动查询是否有待展示的滚动结果（兜底事件丢失）。
  void checkScrollResult();
});

/** 主动查询滚动截图结果（兜底事件丢失，确保预览出现）。 */
const checkScrollResult = async () => {
  // 1) 优先取 store 里 App.vue 全局监听写入的 token。
  const pendingToken = store.pendingScrollPreviewToken;
  if (pendingToken && !scrollResult.value) {
    store.pendingScrollPreviewToken = null;
    showScrollResult(pendingToken);
    return;
  }
  // 2) 兜底：后端主动查询。
  try {
    const token = await scrollCaptureHasResult();
    if (token && !scrollResult.value) showScrollResult(token);
  } catch {
    // 忽略查询失败。
  }
};

onUnmounted(() => {
  isMounted = false;
  window.removeEventListener('pointermove', handlePreviewPointerMove);
  window.removeEventListener('pointerup', stopPreviewPanning);
  window.removeEventListener('pointercancel', stopPreviewPanning);
  ++listRequestVersion;
  ++thumbnailRequestVersion;
  ++imageRequestVersion;
  revokeImageUrl();
  revokeAllThumbnails();
  unlistenHistory.value?.();
  unlistenScrollResult.value?.();
});
</script>

<template>
  <div class="h-full flex flex-col gap-4 p-4 bg-background text-foreground min-h-0 overflow-auto">
    <!-- 滚动截图结果视图 -->
    <div v-if="scrollResult" class="fixed inset-0 z-50 flex flex-col bg-background">
      <div class="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div class="flex items-center gap-3">
          <Camera class="h-5 w-5 text-primary" />
          <div>
            <h2 class="text-base font-semibold leading-tight">{{ t('tools.screenshot.scroll_result_title') }}</h2>
            <p class="text-xs text-muted-foreground">{{ t('tools.screenshot.scroll_result_desc', { type: scrollResult.url ? t('tools.screenshot.scroll_result_type') : '' }) }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-60"
            :disabled="scrollActionBusy"
            @click="scrollResultCopy"
          >
            {{ t('tools.screenshot.screenshot_universal.copy') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-60"
            :disabled="scrollActionBusy"
            @click="scrollResultPin"
          >
            {{ t('tools.screenshot.pin') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-60"
            :disabled="scrollActionBusy"
            @click="scrollResultSave"
          >
            {{ t('tools.screenshot.save_as') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
            :disabled="scrollActionBusy"
            @click="dismissScrollResult"
          >
            {{ t('tools.screenshot.cancel') }}
          </button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        <img
          v-if="scrollResult"
          :src="scrollResult.url"
          :alt="t('tools.screenshot.scroll_result_image_alt')"
          class="max-w-full shadow-lg"
        />
      </div>
    </div>

    <section class="border border-border rounded-md bg-card p-4 flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="text-lg font-semibold flex items-center gap-2">
            <Camera class="h-5 w-5 text-primary" />
            {{ t('tools.screenshot.screenshot_universal.title') }}
          </div>
          <div class="text-sm text-muted-foreground mt-1">
            {{ t('tools.screenshot.screenshot_universal.subtitle') }}
          </div>
          <div class="text-xs text-muted-foreground mt-2">
            {{ t('tools.screenshot.screenshot_universal.history_hint') }}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="screenshot-universal-start"
            class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
            :disabled="starting"
            @click="startCapture"
          >
            {{ starting ? t('tools.screenshot.screenshot_universal.starting') : t('tools.screenshot.screenshot_universal.start') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-60 inline-flex items-center gap-1"
            :disabled="loading"
            @click="loadList()"
          >
            <RefreshCw class="h-4 w-4" />
            {{ t('tools.screenshot.refresh') }}
          </button>
        </div>
      </div>
    </section>

    <section class="border border-border rounded-md bg-card p-4 flex flex-col gap-3 min-h-0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-md font-semibold">{{ t('tools.screenshot.list_title') }}</div>
        <div class="flex items-center gap-2 flex-wrap">
          <!-- 清空 -->
          <button
            type="button"
            class="px-2 py-1 text-xs rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
            :disabled="clearing || !items.length"
            @click="requestConfirm('clear')"
          >
            {{ t('tools.screenshot.clear_all') }}
          </button>
        </div>
      </div>

      <!-- 搜索 / 来源过滤 / 配额 -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="searchQuery"
          type="text"
          class="h-8 flex-1 min-w-40 rounded-md border border-border bg-background px-2 text-sm"
          :placeholder="t('tools.screenshot.search_placeholder')"
        />
        <select
          v-model="sourceKindFilter"
          class="h-8 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option :value="null">{{ t('tools.screenshot.source_all') }}</option>
          <option v-for="kind in historySourceKinds" :key="kind" :value="kind">{{ sourceKindLabel(kind) }}</option>
        </select>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors"
          @click="resetHistoryFilters"
        >
          {{ t('tools.screenshot.reset_filters') }}
        </button>
        <div v-if="quotaSettings" class="flex items-center gap-1">
          <span class="text-xs text-muted-foreground">{{ t('tools.screenshot.quota_title') }}</span>
          <select
            :value="quotaSettings.quotaBytes"
            class="h-8 rounded-md border border-border bg-background px-2 text-sm"
            :disabled="quotaSaving"
            @change="setQuota(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="qb in quotaSettings.permittedQuotaBytes" :key="qb" :value="qb">
              {{ qb >= 1024 * 1024 * 1024 ? `${qb / (1024 * 1024 * 1024)} GB` : `${qb / (1024 * 1024)} MB` }}
            </option>
          </select>
        </div>
      </div>

      <div v-if="loading && !items.length" class="text-sm text-muted-foreground py-8 text-center">
        {{ t('tools.screenshot.loading') }}
      </div>
      <div v-else-if="!items.length" class="text-sm text-muted-foreground py-8 text-center">
        {{ t('tools.screenshot.empty') }}
      </div>

      <div v-else class="flex flex-col md:flex-row gap-4 min-h-0 flex-1">
        <div class="flex flex-col gap-2 overflow-auto md:w-72 shrink-0">
          <div
            v-for="(group, gi) in groupedItems"
            :key="gi"
            class="flex flex-col gap-1"
          >
            <div class="text-xs text-muted-foreground mt-2">{{ group.label }}</div>
            <button
              v-for="record in group.records"
              :key="record.recordId"
              type="button"
              class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted transition-colors"
              :class="selectedRecordId === record.recordId ? 'border-primary bg-primary/10' : 'border-border'"
              @click="loadSelectedRecord(record.recordId)"
            >
              <img
                :src="thumbnailUrls[record.recordId]"
                alt=""
                class="h-10 w-14 object-cover rounded"
              />
              <div class="flex flex-col min-w-0">
                <span class="text-xs truncate">{{ formatCreatedAt(record.createdAt) }}</span>
                <span class="text-xs text-muted-foreground">{{ record.width }}×{{ record.height }}</span>
              </div>
            </button>
          </div>
        </div>

        <div class="flex-1 min-w-0 flex flex-col gap-3">
          <div v-if="!selectedItem" class="text-sm text-muted-foreground py-16 text-center">
            {{ t('tools.screenshot.select_hint') }}
          </div>
          <template v-else>
            <div class="flex items-center justify-between">
              <div class="flex gap-2">
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded-md border"
                  :class="activeVariant === 'original' ? 'border-primary bg-primary/10' : 'border-border'"
                  @click="switchVariant('original')"
                >
                  {{ t('tools.screenshot.original') }}
                </button>
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded-md border"
                  :class="activeVariant === 'final' ? 'border-primary bg-primary/10' : 'border-border'"
                  @click="switchVariant('final')"
                >
                  {{ t('tools.screenshot.final') }}
                </button>
              </div>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded-md border inline-flex items-center gap-1"
                  :disabled="!detail || busyRecordId !== null"
                  @click="pinImage(selectedItem)"
                >
                  <Pin class="h-3 w-3" />
                  {{ t('tools.screenshot.pin') }}
                </button>
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded-md border inline-flex items-center gap-1"
                  :disabled="!detail || busyRecordId !== null"
                  @click="saveAsSelected"
                >
                  <Save class="h-3 w-3" />
                  {{ t('tools.screenshot.save_as') }}
                </button>
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded-md border border-destructive/40 text-destructive inline-flex items-center gap-1"
                  :disabled="busyRecordId !== null"
                  @click="requestConfirm('delete')"
                >
                  <Trash2 class="h-3 w-3" />
                  {{ t('tools.screenshot.delete') }}
                </button>
              </div>
            </div>
            <div
              ref="previewViewportRef"
              class="flex-1 min-h-0 overflow-hidden border border-border rounded-md relative flex items-center justify-center bg-muted/40 p-2 select-none"
              :class="imageUrl && previewZoom > 100 ? (previewPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'"
              @wheel="handlePreviewWheel"
              @pointerdown="handlePreviewPointerDown"
              @dblclick="handlePreviewDoubleClick"
            >
              <img
                v-if="imageUrl"
                :src="imageUrl"
                :alt="t('tools.screenshot.image_alt')"
                class="max-w-full max-h-full object-contain pointer-events-none"
                :style="previewZoomStyle"
                draggable="false"
              />
              <ImageIcon v-else class="h-10 w-10 text-muted-foreground/40" />
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- 删除/清空二次确认对话框 -->
    <DialogRoot v-model:open="confirmDialogOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 bg-black/50 z-50" />
        <DialogContent class="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-background p-6 shadow-xl">
          <DialogTitle class="text-base font-semibold leading-tight">
            {{ pendingAction === 'clear' ? t('tools.screenshot.clear_title') : t('tools.screenshot.delete_title') }}
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            {{ pendingAction === 'clear' ? t('tools.screenshot.clear_confirm') : t('tools.screenshot.delete_confirm') }}
          </DialogDescription>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
              @click="confirmDialogOpen = false"
            >
              {{ t('tools.screenshot.cancel') }}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              @click="confirmPendingAction"
            >
              {{ pendingAction === 'clear' ? t('tools.screenshot.clear_btn') : t('tools.screenshot.delete_btn') }}
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
