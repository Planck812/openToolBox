<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Command } from '@tauri-apps/plugin-shell';
import { copyText as libCopyText } from '@/lib/clipboard';
import {
  ChevronDown,
  Copy,
  Import,
  Loader2,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-vue-next';
import {
  buildCurlArgs,
  buildCurlCommand,
  createHeader,
  createRequest,
  formatBytes,
  getRequestDisplayName,
  HTTP_METHODS,
  isJsonResponse,
  parseRequestCommand,
  parseCurlOutput,
  touchRequest,
  tryFormatJson,
  type CurlHeader,
  type CurlRequest,
  type CurlResponse,
  type CurlSavedItem,
} from './curl-model';
import { loadCurlItems, saveCurlItems } from './curl-storage';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const appStore = useAppStore();

const items = ref<CurlSavedItem[]>([]);
const loaded = ref(false);
const searchKeyword = ref('');
const selectedRequestId = ref<string | null>(null);
const currentRequest = ref<CurlRequest>(createRequest());
const currentResponse = ref<CurlResponse | null>(null);
const loading = ref(false);
const importing = ref(false);
const dirty = ref(false);
const activeRequestTab = ref<'headers' | 'body' | 'curl'>('headers');
const activeResponseTab = ref<'body' | 'headers'>('body');
const importCurlText = ref('');
const showImportModal = ref(false);
const methodMenuOpen = ref(false);
const layoutRef = ref<HTMLElement | null>(null);
const requestPanelRef = ref<HTMLElement | null>(null);
const sidebarWidth = ref(280);
const requestPanelWidth = ref<number | null>(null);
const activeResize = ref<'sidebar' | 'request' | null>(null);
let requestStateVersion = 0;
let cancelResize: (() => void) | null = null;

const getDesktopBreakpoint = () => window.matchMedia('(min-width: 1024px)').matches;

const updatePanelWidth = (target: 'sidebar' | 'request', width: number) => {
  if (!layoutRef.value) return;

  const minWidth = target === 'sidebar' ? 220 : 320;
  const requestWidth = requestPanelRef.value?.clientWidth ?? 320;
  const remainingWidth = target === 'sidebar'
    ? requestWidth + 280
    : sidebarWidth.value + 280;
  const maxWidth = Math.max(minWidth, layoutRef.value.clientWidth - remainingWidth);
  const nextWidth = Math.min(Math.max(width, minWidth), maxWidth);

  if (target === 'sidebar') {
    sidebarWidth.value = nextWidth;
  } else {
    requestPanelWidth.value = nextWidth;
  }
};

const startResize = (target: 'sidebar' | 'request', event: PointerEvent) => {
  if (!getDesktopBreakpoint()) return;

  if (!layoutRef.value) return;

  cancelResize?.();
  const startX = event.clientX;
  const startWidth = target === 'sidebar'
    ? sidebarWidth.value
    : requestPanelWidth.value ?? requestPanelRef.value?.clientWidth ?? 320;

  activeResize.value = target;
  document.body.classList.add('cursor-col-resize', 'select-none');

  const handlePointerMove = (moveEvent: PointerEvent) => {
    updatePanelWidth(target, startWidth + moveEvent.clientX - startX);
  };

  const stopResize = () => {
    activeResize.value = null;
    document.body.classList.remove('cursor-col-resize', 'select-none');
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopResize);
    cancelResize = null;
  };

  cancelResize = stopResize;
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopResize, { once: true });
};

const handleResizeKeydown = (target: 'sidebar' | 'request', event: KeyboardEvent) => {
  if (!getDesktopBreakpoint() || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;

  if (!layoutRef.value) return;

  const currentWidth = target === 'sidebar'
    ? sidebarWidth.value
    : requestPanelWidth.value ?? requestPanelRef.value?.clientWidth ?? 320;
  event.preventDefault();
  updatePanelWidth(target, currentWidth + (event.key === 'ArrowLeft' ? -20 : 20));
};

const filteredItems = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  if (!keyword) return items.value;
  return items.value.filter(
    (item) =>
      item.request.name.toLowerCase().includes(keyword) ||
      item.request.url.toLowerCase().includes(keyword) ||
      item.request.method.toLowerCase().includes(keyword),
  );
});

const curlCommand = computed(() => buildCurlCommand(currentRequest.value));

const formattedResponseBody = computed(() => {
  if (!currentResponse.value) return '';
  if (currentResponse.value.error) return currentResponse.value.error;
  if (isJsonResponse(currentResponse.value.headers)) {
    return tryFormatJson(currentResponse.value.body);
  }
  return currentResponse.value.body;
});

const responseStatusClass = computed(() => {
  const status = currentResponse.value?.status;
  if (!status) return 'text-muted-foreground';
  if (status >= 200 && status < 300) return 'text-emerald-600 dark:text-emerald-400';
  if (status >= 300 && status < 400) return 'text-blue-600 dark:text-blue-400';
  if (status >= 400 && status < 500) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
});

const cloneRequest = (request: CurlRequest): CurlRequest => ({
  ...request,
  headers: request.headers.map((header) => ({ ...header })),
});

const cloneResponse = (response: CurlResponse | null): CurlResponse | null => response ? { ...response } : null;

const cloneItems = (source: CurlSavedItem[]): CurlSavedItem[] => source.map((item) => ({
  request: cloneRequest(item.request),
  lastResponse: cloneResponse(item.lastResponse),
}));

let persistQueue: Promise<void> = Promise.resolve();

const persistItems = async (notifyOnFailure = true): Promise<boolean> => {
  const snapshot = cloneItems(items.value);
  const write = persistQueue.then(async () => {
    try {
      await saveCurlItems(snapshot);
      return true;
    } catch {
      return false;
    }
  });
  persistQueue = write.then(() => undefined);

  const saved = await write;
  if (!saved && notifyOnFailure) {
    appStore.showToast(t('tools.curl_runner.save_failed'), { type: 'error' });
  }
  return saved;
};

const replaceCurrentRequest = (request: CurlRequest) => {
  currentRequest.value = cloneRequest(request);
  requestStateVersion++;
};

const markDirty = () => {
  dirty.value = true;
};

const selectRequest = (id: string) => {
  const item = items.value.find((it) => it.request.id === id);
  if (!item) return;
  selectedRequestId.value = id;
  replaceCurrentRequest(item.request);
  currentResponse.value = cloneResponse(item.lastResponse);
  dirty.value = false;
  activeRequestTab.value = 'headers';
  activeResponseTab.value = 'body';
};

const createNewRequest = () => {
  selectedRequestId.value = null;
  replaceCurrentRequest(createRequest());
  currentResponse.value = null;
  dirty.value = false;
  importCurlText.value = '';
};

const patchRequest = (patch: Partial<CurlRequest>) => {
  currentRequest.value = touchRequest({ ...currentRequest.value, ...patch });
  requestStateVersion++;
  markDirty();
};

const setMethod = (method: string) => {
  patchRequest({ method });
  methodMenuOpen.value = false;
};

const addHeader = () => {
  const headers = [...currentRequest.value.headers, createHeader()];
  patchRequest({ headers });
};

const updateHeader = (id: string, patch: Partial<CurlHeader>) => {
  const headers = currentRequest.value.headers.map((h) => (h.id === id ? { ...h, ...patch } : h));
  patchRequest({ headers });
};

const removeHeader = (id: string) => {
  const headers = currentRequest.value.headers.filter((h) => h.id !== id);
  patchRequest({ headers });
};

const saveRequest = async () => {
  const req = currentRequest.value;
  if (!req.url.trim()) {
    appStore.showToast(t('tools.curl_runner.url_required'), { type: 'warning' });
    return;
  }

  const now = new Date().toISOString();
  const updated = touchRequest(req, now);

  const existingIdx = items.value.findIndex((it) => it.request.id === req.id);
  if (existingIdx >= 0) {
    const existing = items.value[existingIdx];
    items.value = items.value.map((it, idx) =>
      idx === existingIdx ? { request: updated, lastResponse: existing.lastResponse } : it,
    );
  } else {
    items.value = [{ request: updated, lastResponse: currentResponse.value }, ...items.value];
    selectedRequestId.value = updated.id;
  }

  replaceCurrentRequest(updated);
  dirty.value = false;
  if (await persistItems()) {
    appStore.showToast(t('tools.curl_runner.saved'), { type: 'success' });
  }
};

const deleteRequest = async (id: string) => {
  items.value = items.value.filter((it) => it.request.id !== id);
  if (selectedRequestId.value === id) {
    createNewRequest();
  }
  await persistItems();
  appStore.showToast(t('tools.curl_runner.deleted'), { type: 'success' });
};

const persistResponseForRequest = async (requestId: string, response: CurlResponse) => {
  if (!items.value.some((item) => item.request.id === requestId)) return;

  items.value = items.value.map((item) =>
    item.request.id === requestId ? { ...item, lastResponse: response } : item,
  );
  await persistItems();
};

const sendRequest = async () => {
  const req = currentRequest.value;
  const requestId = req.id;
  if (!req.url.trim()) {
    appStore.showToast(t('tools.curl_runner.url_required'), { type: 'warning' });
    return;
  }
  if (loading.value) return;

  loading.value = true;
  const startedAt = performance.now();
  try {
    const args = buildCurlArgs(req);
    const cmd = Command.create('curl', args);
    const result = await cmd.execute();
    const elapsed = Math.round(performance.now() - startedAt);
    const response = parseCurlOutput(result.stdout || '', result.stderr || '', elapsed);
    if (currentRequest.value.id === requestId) currentResponse.value = response;
    await persistResponseForRequest(requestId, response);

    if (response.error) {
      appStore.showToast(t('tools.curl_runner.request_failed', { reason: response.error }), { type: 'error' });
    } else {
      appStore.showToast(
        t('tools.curl_runner.request_done', { status: response.status }),
        { type: response.status >= 200 && response.status < 400 ? 'success' : 'warning' },
      );
    }
  } catch (e) {
    const elapsed = Math.round(performance.now() - startedAt);
    const response: CurlResponse = {
      status: 0,
      statusText: '',
      headers: '',
      body: '',
      timeMs: elapsed,
      size: 0,
      timestamp: new Date().toISOString(),
      error: String((e as { message?: unknown } | null)?.message ?? e),
    };
    if (currentRequest.value.id === requestId) currentResponse.value = response;
    await persistResponseForRequest(requestId, response);
    appStore.showToast(t('tools.curl_runner.request_failed', { reason: response.error }), { type: 'error' });
  } finally {
    loading.value = false;
  }
};

const parseRequestPatch = (text: string): Partial<CurlRequest> | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const parsed = parseRequestCommand(trimmed);
  if (!parsed.url && !parsed.method && !parsed.body && (!parsed.headers || parsed.headers.length === 0)) {
    return undefined;
  }

  return {
    ...(parsed.method ? { method: parsed.method } : {}),
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(parsed.body !== undefined ? { body: parsed.body } : {}),
    ...(parsed.headers ? { headers: parsed.headers.map((header) => ({ ...header })) } : {}),
    ...(parsed.followRedirects !== undefined ? { followRedirects: parsed.followRedirects } : {}),
    ...(parsed.verifySsl !== undefined ? { verifySsl: parsed.verifySsl } : {}),
  };
};

const applyRequestCommand = (text: string): boolean => {
  const patch = parseRequestPatch(text);
  if (!patch) return false;
  patchRequest(patch);
  return true;
};

const createImportedRequest = (patch: Partial<CurlRequest>): CurlRequest => {
  const timestamp = new Date().toISOString();
  const request = createRequest(timestamp);
  return {
    ...request,
    name: '',
    ...(patch.method ? { method: patch.method } : {}),
    ...(patch.url ? { url: patch.url } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.headers ? { headers: patch.headers.map((header) => ({ ...header })) } : {}),
    ...(patch.followRedirects !== undefined ? { followRedirects: patch.followRedirects } : {}),
    ...(patch.verifySsl !== undefined ? { verifySsl: patch.verifySsl } : {}),
  };
};

const importAsNewSavedRequest = async (patch: Partial<CurlRequest>): Promise<boolean> => {
  const previousSelectedRequestId = selectedRequestId.value;
  const previousRequest = cloneRequest(currentRequest.value);
  const previousResponse = cloneResponse(currentResponse.value);
  const previousDirty = dirty.value;
  const request = createImportedRequest(patch);

  items.value = [{ request, lastResponse: null }, ...items.value];
  selectedRequestId.value = request.id;
  replaceCurrentRequest(request);
  currentResponse.value = null;
  dirty.value = false;
  const importedRequestVersion = requestStateVersion;

  if (await persistItems()) return true;

  items.value = items.value.filter((item) => item.request.id !== request.id);
  if (
    selectedRequestId.value === request.id
    && currentRequest.value.id === request.id
    && requestStateVersion === importedRequestVersion
  ) {
    selectedRequestId.value = previousSelectedRequestId;
    replaceCurrentRequest(previousRequest);
    currentResponse.value = previousResponse;
    dirty.value = previousDirty;
  }
  await persistItems(false);
  return false;
};

const openImportModal = () => {
  showImportModal.value = true;
};

const closeImportModal = () => {
  if (importing.value) return;
  showImportModal.value = false;
};

const confirmImport = async () => {
  if (importing.value) return;

  const text = importCurlText.value.trim();
  if (!text) {
    appStore.showToast(t('tools.curl_runner.import_empty'), { type: 'warning' });
    return;
  }

  const patch = parseRequestPatch(text);
  if (!patch) {
    appStore.showToast(t('tools.curl_runner.import_failed'), { type: 'warning' });
    return;
  }

  const currentRequestIsSaved = items.value.some((item) => item.request.id === currentRequest.value.id);
  if (currentRequestIsSaved) {
    importing.value = true;
    try {
      if (!await importAsNewSavedRequest(patch)) return;
      showImportModal.value = false;
      appStore.showToast(t('tools.curl_runner.imported_as_new'), { type: 'success' });
    } finally {
      importing.value = false;
    }
    return;
  }

  patchRequest(patch);
  showImportModal.value = false;
  appStore.showToast(t('tools.curl_runner.imported'), { type: 'success' });
};

const copyText = async (text: string, successKey: string, failKey: string) => {
  if (!text) {
    appStore.showToast(t(failKey), { type: 'warning' });
    return;
  }
  const ok = await libCopyText(text);
  appStore.showToast(t(ok ? successKey : failKey), { type: ok ? 'success' : 'error' });
};

watch(methodMenuOpen, (open) => {
  if (!open) return;
  const close = (e: MouseEvent) => {
    if (!(e.target as HTMLElement)?.closest?.('[data-method-menu]')) {
      methodMenuOpen.value = false;
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
});

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && showImportModal.value) {
    closeImportModal();
  }
};

watch(showImportModal, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('keydown', onKeydown);
  }
});

watch(
  () => props.initialData,
  (value) => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) return;
    const ok = applyRequestCommand(trimmed);
    if (ok) {
      appStore.showToast(t('tools.curl_runner.imported'), { type: 'success' });
    }
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    const loadedItems = await loadCurlItems();
    items.value = loadedItems;
    if (loadedItems.length > 0) {
      selectRequest(loadedItems[0].request.id);
    } else {
      createNewRequest();
    }
  } catch {
    createNewRequest();
    appStore.showToast(t('tools.curl_runner.load_failed'), { type: 'error' });
  } finally {
    loaded.value = true;
  }
});

onUnmounted(() => {
  cancelResize?.();
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
    <div
      ref="layoutRef"
      class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(220px,var(--curl-sidebar-width))_minmax(320px,var(--curl-request-width,1fr))_minmax(280px,1fr)]"
      :style="{
        '--curl-sidebar-width': `${sidebarWidth}px`,
        '--curl-request-width': requestPanelWidth === null ? undefined : `${requestPanelWidth}px`,
      }"
    >
      <aside class="relative flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div class="flex flex-col gap-2 border-b border-border p-3">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="searchKeyword"
              type="text"
              class="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
              :placeholder="t('tools.curl_runner.search_placeholder')"
            />
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="createNewRequest"
          >
            <Plus class="h-4 w-4" />
            {{ t('tools.curl_runner.new_request') }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-2">
          <div
            v-if="loaded && items.length === 0"
            class="m-2 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
          >
            {{ t('tools.curl_runner.empty_list') }}
          </div>
          <div v-else class="flex flex-col gap-1">
            <button
              v-for="item in filteredItems"
              :key="item.request.id"
              :data-testid="`curl-saved-request-${item.request.id}`"
              type="button"
              class="group rounded-lg border p-2 text-left transition-colors"
              :class="selectedRequestId === item.request.id
                ? 'border-primary bg-primary/5'
                : 'border-transparent hover:bg-muted/40'"
              @click="selectRequest(item.request.id)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  :class="{
                    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400': item.request.method === 'GET',
                    'bg-blue-500/15 text-blue-600 dark:text-blue-400': item.request.method === 'POST',
                    'bg-amber-500/15 text-amber-600 dark:text-amber-400': item.request.method === 'PUT' || item.request.method === 'PATCH',
                    'bg-red-500/15 text-red-600 dark:text-red-400': item.request.method === 'DELETE',
                    'bg-muted text-muted-foreground': !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(item.request.method),
                  }"
                >
                  {{ item.request.method }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium">
                  {{ getRequestDisplayName(item.request, t('tools.curl_runner.untitled')) }}
                </span>
                <button
                  type="button"
                  class="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  :title="t('tools.curl_runner.delete')"
                  @click.stop="deleteRequest(item.request.id)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
              <p class="mt-1 truncate text-xs text-muted-foreground">{{ item.request.url || '--' }}</p>
            </button>
          </div>
        </div>
        <div
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.curl_runner.resize_aria_list')"
          aria-orientation="vertical"
          aria-valuemin="220"
          :aria-valuenow="sidebarWidth"
          tabindex="0"
          @pointerdown.prevent="startResize('sidebar', $event)"
          @keydown="handleResizeKeydown('sidebar', $event)"
        ></div>
      </aside>

      <section ref="requestPanelRef" class="relative flex min-h-0 min-w-0 flex-col border-r border-border">
          <div class="flex flex-col gap-2 border-b border-border p-3">
            <div class="flex items-center gap-2">
              <input
                v-model="currentRequest.name"
                data-testid="curl-request-name"
                type="text"
                class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                :placeholder="t('tools.curl_runner.name_placeholder')"
                @input="patchRequest({ name: ($event.target as HTMLInputElement).value })"
              />
              <span
                v-if="dirty"
                class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400"
              >
                {{ t('tools.curl_runner.unsaved') }}
              </span>
              <button
                type="button"
                data-testid="curl-import-button"
                class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                @click="openImportModal"
              >
                <Import class="h-4 w-4" />
                {{ t('tools.curl_runner.import_curl') }}
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                @click="saveRequest"
              >
                <Save class="h-4 w-4" />
                {{ t('tools.curl_runner.save') }}
              </button>
            </div>

            <div class="flex items-center gap-2">
              <div class="relative shrink-0" data-method-menu>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                  @click="methodMenuOpen = !methodMenuOpen"
                >
                  {{ currentRequest.method }}
                  <ChevronDown class="h-3.5 w-3.5" />
                </button>
                <div
                  v-if="methodMenuOpen"
                  class="absolute left-0 top-full z-10 mt-1 w-28 rounded-md border border-border bg-popover py-1 shadow-lg"
                >
                  <button
                    v-for="method in HTTP_METHODS"
                    :key="method"
                    type="button"
                    class="block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    @click="setMethod(method)"
                  >
                    {{ method }}
                  </button>
                </div>
              </div>
              <input
                v-model="currentRequest.url"
                data-testid="curl-request-url"
                type="text"
                class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                :placeholder="t('tools.curl_runner.url_placeholder')"
                @input="patchRequest({ url: ($event.target as HTMLInputElement).value })"
              />
              <button
                type="button"
                data-testid="curl-send-button"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="loading"
                @click="sendRequest"
              >
                <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
                <Send v-else class="h-4 w-4" />
                {{ loading ? t('tools.curl_runner.sending') : t('tools.curl_runner.send') }}
              </button>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-1 border-b border-border px-3 pt-2">
            <button
              v-for="tab in (['headers', 'body', 'curl'] as const)"
              :key="tab"
              type="button"
              class="border-b-2 px-3 py-2 text-sm font-medium transition-colors"
              :class="activeRequestTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'"
              @click="activeRequestTab = tab"
            >
              {{ t(`tools.curl_runner.tab_${tab}`) }}
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-3">
            <div v-if="activeRequestTab === 'headers'" class="flex flex-col gap-2">
              <div
                v-for="header in currentRequest.headers"
                :key="header.id"
                class="flex items-center gap-2"
              >
                <input
                  :checked="header.enabled"
                  type="checkbox"
                  class="h-4 w-4 rounded border-border"
                  @change="updateHeader(header.id, { enabled: ($event.target as HTMLInputElement).checked })"
                />
                <input
                  :value="header.key"
                  type="text"
                  class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                  :placeholder="t('tools.curl_runner.header_key_placeholder')"
                  @input="updateHeader(header.id, { key: ($event.target as HTMLInputElement).value })"
                />
                <input
                  :value="header.value"
                  type="text"
                  class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                  :placeholder="t('tools.curl_runner.header_value_placeholder')"
                  @input="updateHeader(header.id, { value: ($event.target as HTMLInputElement).value })"
                />
                <button
                  type="button"
                  class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  @click="removeHeader(header.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                class="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                @click="addHeader"
              >
                <Plus class="h-3.5 w-3.5" />
                {{ t('tools.curl_runner.add_header') }}
              </button>
            </div>

            <div v-else-if="activeRequestTab === 'body'" class="flex h-full flex-col gap-2">
              <textarea
                v-model="currentRequest.body"
                class="min-h-0 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none transition-colors focus:border-primary"
                :placeholder="t('tools.curl_runner.body_placeholder')"
                @input="patchRequest({ body: ($event.target as HTMLTextAreaElement).value })"
              ></textarea>
            </div>

            <div v-else class="flex h-full flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-muted-foreground">{{ t('tools.curl_runner.curl_preview_hint') }}</span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted"
                  @click="copyText(curlCommand, 'tools.curl_runner.copy_success', 'tools.curl_runner.copy_failed')"
                >
                  <Copy class="h-3.5 w-3.5" />
                  {{ t('tools.curl_runner.copy_curl') }}
                </button>
              </div>
              <textarea
                :value="curlCommand"
                class="min-h-0 flex-1 resize-none rounded-md border border-border bg-muted/20 p-3 font-mono text-xs outline-none"
                readonly
              ></textarea>
            </div>
          </div>
          </div>
        <div
          data-testid="curl-request-response-resizer"
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.curl_runner.resize_aria_editor')"
          aria-orientation="vertical"
          aria-valuemin="320"
          :aria-valuenow="requestPanelWidth ?? requestPanelRef?.clientWidth ?? 320"
          tabindex="0"
          @pointerdown.prevent="startResize('request', $event)"
          @keydown="handleResizeKeydown('request', $event)"
        ></div>
      </section>

      <section class="flex min-h-0 min-w-0 flex-col border-t border-border lg:border-t-0">
          <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div class="flex items-center gap-3 text-sm">
              <span v-if="currentResponse" :class="responseStatusClass" class="font-semibold">
                {{ currentResponse.status || '--' }}
                {{ currentResponse.statusText }}
              </span>
              <span v-else class="text-muted-foreground">{{ t('tools.curl_runner.no_response') }}</span>
              <span v-if="currentResponse" class="text-xs text-muted-foreground">
                {{ currentResponse.timeMs }}ms · {{ formatBytes(currentResponse.size) }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="currentResponse"
                type="button"
                class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted"
                @click="copyText(currentResponse.body, 'tools.curl_runner.copy_success', 'tools.curl_runner.copy_failed')"
              >
                <Copy class="h-3.5 w-3.5" />
                {{ t('tools.curl_runner.copy_response') }}
              </button>
            </div>
          </div>

          <div v-if="currentResponse" class="flex items-center gap-1 border-b border-border px-3">
            <button
              v-for="tab in (['body', 'headers'] as const)"
              :key="tab"
              type="button"
              class="border-b-2 px-3 py-2 text-sm font-medium transition-colors"
              :class="activeResponseTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'"
              @click="activeResponseTab = tab"
            >
              {{ t(`tools.curl_runner.response_tab_${tab}`) }}
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-3">
            <div v-if="!currentResponse" class="flex h-full items-center justify-center text-sm text-muted-foreground">
              {{ t('tools.curl_runner.no_response_hint') }}
            </div>
            <template v-else>
              <pre
                v-if="activeResponseTab === 'body'"
                class="h-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/20 p-3 font-mono text-xs"
                >{{ currentResponse.error || formattedResponseBody }}</pre>
              <pre
                v-else
                class="h-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/20 p-3 font-mono text-xs"
                >{{ currentResponse.headers || '--' }}</pre>
            </template>
          </div>
      </section>
    </div>

    <div
      v-if="showImportModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeImportModal"
    >
      <div class="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <div class="flex items-center gap-2">
            <Import class="h-4 w-4 text-primary" />
            <h3 class="text-sm font-semibold">{{ t('tools.curl_runner.import_modal_title') }}</h3>
          </div>
          <button
            type="button"
            :disabled="importing"
            class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            @click="closeImportModal"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <p class="text-xs text-muted-foreground">{{ t('tools.curl_runner.import_modal_hint') }}</p>
          <textarea
            v-model="importCurlText"
            data-testid="curl-import-input"
            :disabled="importing"
            autofocus
            class="min-h-[200px] flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs outline-none transition-colors focus:border-primary"
            :placeholder="t('tools.curl_runner.import_placeholder')"
          ></textarea>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            :disabled="importing"
            class="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            @click="closeImportModal"
          >
            {{ t('tools.curl_runner.cancel') }}
          </button>
          <button
            type="button"
            data-testid="curl-import-confirm"
            :disabled="importing"
            class="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            @click="confirmImport"
          >
            <Loader2 v-if="importing" class="h-4 w-4 animate-spin" />
            <Import v-else class="h-4 w-4" />
            {{ importing ? t('tools.curl_runner.importing') : t('tools.curl_runner.parse_curl') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
