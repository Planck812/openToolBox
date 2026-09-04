<script setup lang="ts">
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Copy, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-vue-next';
import { copyText } from '@/lib/clipboard';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { DEFAULT_MERMAID_SOURCE, stripMermaidFence } from './index';

interface Props {
  initialData?: string;
}

type PanZoomInstance = {
  fit: () => void;
  center: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  resize: () => void;
  destroy: () => void;
};

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

// initialData 可能来自 md 复制（带 ```mermaid 围栏），进入即剥离，textarea 显示干净源码。
const source = ref(props.initialData?.trim() ? stripMermaidFence(props.initialData) : DEFAULT_MERMAID_SOURCE);
const previewSvg = ref('');
const errorMessage = ref('');
const isRendering = ref(false);
const previewFrameRef = ref<HTMLElement | null>(null);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 320, minSecondWidth: 420 });

let renderToken = 0;
let renderTimer: number | null = null;
let mermaidReady = false;
let panZoom: PanZoomInstance | null = null;
let resizeObserver: ResizeObserver | null = null;

const hasPreview = computed(() => Boolean(previewSvg.value));

/**
 * 初始化 Mermaid 运行时，避免重复覆盖全局配置
 */
const ensureMermaidReady = () => {
  if (mermaidReady) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    suppressErrorRendering: true,
  });
  mermaidReady = true;
};

/**
 * 销毁旧的缩放实例，避免重复绑定拖拽与滚轮事件
 */
const destroyPanZoom = () => {
  if (!panZoom) {
    return;
  }

  panZoom.destroy();
  panZoom = null;
};

const removeTransientRenderNodes = (renderId?: string) => {
  const selectors = renderId
    ? [`#d${renderId}`, `#i${renderId}`]
    : ['[id^="dmermaid-preview-"]', '[id^="imermaid-preview-"]'];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  }
};

const syncSvgViewportSize = (svg: SVGSVGElement, container: HTMLElement) => {
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = `${containerWidth}px`;
  svg.style.height = `${containerHeight}px`;
  svg.style.maxWidth = 'none';
  svg.style.maxHeight = 'none';
};

const bindResizeObserver = (svg: SVGSVGElement, container: HTMLElement) => {
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (!panZoom) {
      return;
    }

    syncSvgViewportSize(svg, container);
    panZoom.resize();
    panZoom.fit();
    panZoom.center();
  });
  resizeObserver.observe(container);
};

/**
 * Mermaid SVG 注入完成后，为预览区挂载平移缩放能力
 */
const initPanZoom = async () => {
  await nextTick();

  const container = previewFrameRef.value;
  const svg = container?.querySelector('svg');
  if (!container || !svg) {
    return;
  }

  syncSvgViewportSize(svg, container);

  destroyPanZoom();
  panZoom = svgPanZoom(svg, {
    zoomEnabled: true,
    controlIconsEnabled: false,
    fit: true,
    center: true,
    minZoom: 0.4,
    maxZoom: 8,
    mouseWheelZoomEnabled: true,
    dblClickZoomEnabled: false,
    preventMouseEventsDefault: true,
    contain: false,
    panEnabled: true,
  }) as PanZoomInstance;

  panZoom.resize();
  panZoom.fit();
  panZoom.center();
  bindResizeObserver(svg, container);
};

/**
 * 复制源码到剪贴板，方便用户带走 Mermaid 文本
 */
const copySource = async () => {
  const ok = await copyText(source.value);
  const key = ok ? 'tools.mermaid_preview.copy_success' : 'tools.mermaid_preview.copy_failed';
  store.showToast(t(key), { type: ok ? 'success' : 'error' });
};

const zoomInView = () => {
  panZoom?.zoomIn();
};

const zoomOutView = () => {
  panZoom?.zoomOut();
};

const resetView = () => {
  if (!panZoom) {
    return;
  }

  panZoom.resetZoom();
  panZoom.fit();
  panZoom.center();
};

/**
 * 将当前源码重新渲染为 SVG，失败时保留中文错误提示
 */
const renderDiagram = async () => {
  const currentToken = ++renderToken;
  // 兜底：手动往编辑器粘贴围栏内容时也剥掉，保证预览始终可渲染
  const currentSource = stripMermaidFence(source.value).trim();

  if (!currentSource) {
    destroyPanZoom();
    previewSvg.value = '';
    errorMessage.value = t('tools.mermaid_preview.empty_state');
    return;
  }

  isRendering.value = true;
  errorMessage.value = '';

  try {
    ensureMermaidReady();
    await nextTick();
    const renderId = `mermaid-preview-${currentToken}`;
    // Mermaid 会在传入容器内插入临时节点，直接复用 Vue 管理的根节点会打乱补丁流程。
    const { svg } = await mermaid.render(renderId, currentSource);

    if (currentToken !== renderToken) {
      return;
    }

    // mermaid 输出的 SVG 直接 v-html 会引入 script/foreignObject 等 XSS 风险，
    // 这里限制为 SVG + style + foreignObject，由 DOMPurify 默认规则剥离 script 与 on* 事件。
    previewSvg.value = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['style', 'foreignObject'],
    });
    await initPanZoom();
  } catch (error) {
    if (currentToken !== renderToken) {
      return;
    }

    destroyPanZoom();
    removeTransientRenderNodes(`mermaid-preview-${currentToken}`);
    previewSvg.value = '';
    const reason = error instanceof Error ? error.message : String(error);
    errorMessage.value = t('tools.mermaid_preview.render_failed', { reason });
  } finally {
    if (currentToken === renderToken) {
      isRendering.value = false;
    }
  }
};

/**
 * 输入变更后短暂防抖，减少连续敲字时的重复渲染
 */
const scheduleRender = () => {
  if (renderTimer) {
    clearTimeout(renderTimer);
  }

  renderTimer = window.setTimeout(() => {
    void renderDiagram();
  }, 180);
};

const cleanupPreviewRuntime = () => {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }

  resizeObserver?.disconnect();
  resizeObserver = null;
  destroyPanZoom();
  removeTransientRenderNodes();
};

watch(
  () => props.initialData,
  (value) => {
    if (!value?.trim()) {
      return;
    }

    source.value = stripMermaidFence(value);
  }
);

watch(source, () => {
  scheduleRender();
}, { immediate: true });

onBeforeUnmount(() => {
  cleanupPreviewRuntime();
});

onDeactivated(() => {
  cleanupPreviewRuntime();
});

onActivated(() => {
  if (source.value.trim()) {
    scheduleRender();
  }
});
</script>

<template>
  <div ref="containerRef" class="grid h-full min-h-0 grid-cols-1 gap-4 overflow-auto bg-background p-4 text-foreground lg:grid-cols-[minmax(320px,var(--panel-first-width,30%))_minmax(420px,1fr)]" :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }">
    <section ref="firstPanelRef" class="relative flex min-h-0 flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">{{ t('tools.mermaid_preview.editor_title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('tools.mermaid_preview.editor_hint') }}</p>
        </div>
        <button
          class="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
          @click="copySource"
        >
          <Copy class="h-4 w-4" />
          {{ t('tools.mermaid_preview.copy_source') }}
        </button>
      </div>

      <textarea
        v-model="source"
        data-testid="mermaid-source-input"
        class="min-h-[280px] flex-1 resize-none rounded-xl border border-border bg-card p-4 font-mono text-sm leading-6 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        :placeholder="t('tools.mermaid_preview.input_placeholder')"
        spellcheck="false"
      ></textarea>
      <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.mermaid_preview.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
    </section>

    <section class="flex min-h-0 flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">{{ t('tools.mermaid_preview.preview_title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('tools.mermaid_preview.preview_hint') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw v-if="isRendering" class="h-4 w-4 animate-spin" />
            <span>{{ isRendering ? t('tools.mermaid_preview.rendering') : t('tools.mermaid_preview.render_ready') }}</span>
          </div>
          <button data-testid="mermaid-zoom-out-button" class="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted" @click="zoomOutView">
            <ZoomOut class="h-4 w-4" />
            {{ t('tools.mermaid_preview.zoom_out') }}
          </button>
          <button data-testid="mermaid-zoom-in-button" class="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted" @click="zoomInView">
            <ZoomIn class="h-4 w-4" />
            {{ t('tools.mermaid_preview.zoom_in') }}
          </button>
          <button data-testid="mermaid-reset-button" class="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted" @click="resetView">
            <Search class="h-4 w-4" />
            {{ t('tools.mermaid_preview.reset_view') }}
          </button>
        </div>
      </div>

      <div
        ref="previewFrameRef"
        data-testid="mermaid-preview-frame"
        class="relative flex min-h-[360px] min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-border bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.95))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.06)]"
      >
        <div v-if="errorMessage" class="max-w-xl rounded-2xl border border-destructive/25 bg-background/95 px-4 py-3 text-sm leading-6 text-destructive shadow-sm">
          {{ errorMessage }}
        </div>
        <div
          v-else-if="hasPreview"
          data-testid="mermaid-preview-svg-shell"
          class="mermaid-diagram absolute inset-0 flex min-w-0 items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
          v-html="previewSvg"
        ></div>
        <div v-else class="text-sm text-muted-foreground">
          {{ t('tools.mermaid_preview.empty_state') }}
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mermaid-diagram :deep(svg) {
  width: auto;
  height: auto;
  display: block;
  max-width: none;
  max-height: none;
}
</style>
