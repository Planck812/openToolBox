<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Image as ImageIcon,
  Upload,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  X,
} from 'lucide-vue-next';
import {
  DEFAULT_IMAGE_MIME,
  normalizeBase64Input,
  parseImageBase64,
} from '../image-base64';

interface Props {
  initialData?: string;
}

interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile?: () => File | null;
}

type ImageMeta = {
  name: string;
  type: string;
  sizeText: string;
  width: number;
  height: number;
};

const props = defineProps<Props>();
const { t } = useI18n();

const imageUrl = ref('');
const imageMeta = ref<ImageMeta | null>(null);
const errorMessage = ref('');
const zoomPercent = ref(100);
const panOffset = ref({ x: 0, y: 0 });
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragActive = ref(false);
const previewViewportRef = ref<HTMLDivElement | null>(null);
const isFullscreen = ref(false);
const showMetaPanel = ref(false);

const zoomStyle = computed(() => ({
  transform: `translate(${panOffset.value.x}px, ${panOffset.value.y}px) scale(${zoomPercent.value / 100})`,
}));

const zoomLabel = computed(() => `${Math.round(zoomPercent.value)}%`);

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

const loadImageSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('image_load_failed'));
    image.src = src;
  });

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });

const extractImageFileFromClipboardItems = (
  items: ArrayLike<ClipboardImageItem> | null | undefined,
): File | null => {
  if (!items) return null;

  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (!file) return null;
    return file.name
      ? file
      : new File([file], 'clipboard-image.png', { type: file.type || 'image/png' });
  }

  return null;
};

const clearImage = () => {
  imageUrl.value = '';
  imageMeta.value = null;
  errorMessage.value = '';
  zoomPercent.value = 100;
  panOffset.value = { x: 0, y: 0 };
  isPanning.value = false;
};

const applyImageSource = async (src: string, meta: { name: string; type: string; sizeText: string }) => {
  try {
    const size = await loadImageSize(src);
    imageUrl.value = src;
    imageMeta.value = {
      ...meta,
      width: size.width,
      height: size.height,
    };
    errorMessage.value = '';
  } catch {
    clearImage();
    errorMessage.value = t('tools.image_viewer.load_failed');
  }
};

const applyImageFile = async (file: File) => {
  if (!file.type.startsWith('image/')) {
    clearImage();
    errorMessage.value = t('tools.image_viewer.invalid_image');
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    await applyImageSource(dataUrl, {
      name: file.name || t('tools.image_viewer.default_image_name'),
      type: file.type || DEFAULT_IMAGE_MIME,
      sizeText: formatBytes(file.size),
    });
  } catch {
    clearImage();
    errorMessage.value = t('tools.image_viewer.read_failed');
  }
};

const applyInitialText = async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return;

  const parsed = parseImageBase64(trimmed);
  if (parsed) {
    await applyImageSource(parsed.dataUrl, {
      name: t('tools.image_viewer.base64_image_name'),
      type: parsed.mime,
      sizeText: formatBytes(Math.ceil(normalizeBase64Input(trimmed).length * 0.75)),
    });
    return;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    await applyImageSource(trimmed, {
      name: t('tools.image_viewer.remote_image_name'),
      type: t('tools.image_viewer.remote_image_type'),
      sizeText: t('tools.image_viewer.remote_image_size'),
    });
  }
};

const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await applyImageFile(file);
};

const handlePaste = (event: ClipboardEvent) => {
  const file = extractImageFileFromClipboardItems(event.clipboardData?.items);
  if (!file) return;
  event.preventDefault();
  void applyImageFile(file);
};

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  isDragActive.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await applyImageFile(file);
};

const clampZoom = (value: number) => Math.min(400, Math.max(10, value));

const resetPanIfNeeded = () => {
  if (zoomPercent.value <= 100) {
    panOffset.value = { x: 0, y: 0 };
  }
};

const handleWheelZoom = (event: WheelEvent) => {
  if (!imageUrl.value) return;

  event.preventDefault();
  const delta = event.deltaY < 0 ? 10 : -10;
  zoomPercent.value = clampZoom(zoomPercent.value + delta);
  resetPanIfNeeded();
};

const zoomIn = () => { zoomPercent.value = clampZoom(zoomPercent.value + 25); };
const zoomOut = () => { zoomPercent.value = clampZoom(zoomPercent.value - 25); };
const resetZoom = () => { zoomPercent.value = 100; panOffset.value = { x: 0, y: 0 }; };

/** 双击图片：放大到 200%；再次双击回到 100%。 */
const handleDoubleClick = () => {
  if (!imageUrl.value) return;
  if (zoomPercent.value > 100) {
    resetZoom();
  } else {
    zoomPercent.value = 200;
  }
};

const stopPanning = () => {
  isPanning.value = false;
};

const handlePointerMove = (event: PointerEvent) => {
  if (!isPanning.value) return;

  panOffset.value = {
    x: panStart.value.offsetX + event.clientX - panStart.value.x,
    y: panStart.value.offsetY + event.clientY - panStart.value.y,
  };
};

const handlePointerDown = (event: PointerEvent) => {
  if (!imageUrl.value || event.button !== 0 || zoomPercent.value <= 100) return;

  isPanning.value = true;
  panStart.value = {
    x: event.clientX,
    y: event.clientY,
    offsetX: panOffset.value.x,
    offsetY: panOffset.value.y,
  };

  try {
    previewViewportRef.value?.setPointerCapture(event.pointerId);
  } catch {}
};

/** 全屏切换：用浏览器 Fullscreen API 沉浸展示图片。 */
const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      isFullscreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullscreen.value = false;
    }
  } catch {
    // 全屏被拒绝时静默失败。
  }
};

const handleFullscreenChange = () => {
  isFullscreen.value = Boolean(document.fullscreenElement);
};

/** 键盘快捷键：+/=/-/0 缩放，F 切换全屏。输入框内不拦截。 */
const handleKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  switch (event.key) {
    case '+':
    case '=':
      if (!imageUrl.value) return;
      zoomIn();
      break;
    case '-':
      if (!imageUrl.value) return;
      zoomOut();
      break;
    case '0':
      if (!imageUrl.value) return;
      resetZoom();
      break;
    case 'f':
    case 'F':
      if (imageUrl.value) void toggleFullscreen();
      break;
    default:
      return;
  }
  event.preventDefault();
};

watch(
  () => props.initialData,
  (value) => {
    if (imageUrl.value || !value?.trim()) return;
    void applyInitialText(value);
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('paste', handlePaste);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopPanning);
  window.addEventListener('keydown', handleKeydown);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste);
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopPanning);
  window.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  if (document.fullscreenElement) void document.exitFullscreen();
});
</script>

<template>
  <div
    class="image-viewer-root h-full flex flex-col bg-background text-foreground"
    :class="isFullscreen ? 'fixed inset-0 z-50' : ''"
  >
    <!-- 顶部轻量栏：全屏时隐藏，图片占满整个屏幕 -->
    <header v-if="!isFullscreen" class="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
      <div class="flex items-center gap-3">
        <span class="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <ImageIcon class="h-5 w-5" />
        </span>
        <div>
          <h2 class="text-base font-semibold leading-tight">{{ t('tools.image_viewer.title') }}</h2>
          <p class="text-xs text-muted-foreground">{{ t('tools.image_viewer.subtitle') }}</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
          @click="fileInputRef?.click()"
        >
          <Upload class="h-4 w-4" />
          {{ t('tools.image_viewer.upload_btn') }}
        </button>
        <button
          v-if="imageUrl"
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
          @click="clearImage"
        >
          <X class="h-4 w-4" />
          {{ t('tools.image_viewer.clear_btn') }}
        </button>
        <button
          v-if="imageUrl"
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          :title="isFullscreen ? t('tools.image_viewer.fullscreen_exit') : t('tools.image_viewer.fullscreen_enter')"
          @click="toggleFullscreen"
        >
          <Minimize2 v-if="isFullscreen" class="h-4 w-4" />
          <Maximize2 v-else class="h-4 w-4" />
          <span class="hidden sm:inline">{{ isFullscreen ? t('tools.image_viewer.fullscreen_exit') : t('tools.image_viewer.fullscreen_enter') }}</span>
        </button>
      </div>
    </header>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      class="hidden"
      @change="handleFileChange"
    >

    <!-- 画布区：占满剩余空间 -->
    <main class="relative min-h-0 flex-1">
      <!-- 空状态 -->
      <div
        v-if="!imageUrl"
        class="absolute inset-0 flex items-center justify-center p-8"
        @dragenter.prevent="isDragActive = true"
        @dragover.prevent="isDragActive = true"
        @dragleave.prevent="isDragActive = false"
        @drop="handleDrop"
      >
        <div
          class="flex w-full max-w-md flex-col items-center text-center rounded-2xl border border-dashed p-10 transition-colors"
          :class="isDragActive ? 'border-primary bg-primary/5' : 'border-border'"
        >
          <span class="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ImageIcon class="h-8 w-8" />
          </span>
          <div class="mt-5 text-base font-semibold">{{ t('tools.image_viewer.empty_title') }}</div>
          <div class="mt-2 text-sm leading-6 text-muted-foreground">{{ t('tools.image_viewer.empty_hint') }}</div>
          <button
            type="button"
            class="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            @click="fileInputRef?.click()"
          >
            <Upload class="h-4 w-4" />
            {{ t('tools.image_viewer.upload_btn') }}
          </button>
        </div>
      </div>

      <!-- 图片画布 -->
      <div
        v-else
        ref="previewViewportRef"
        class="absolute inset-0 flex items-center justify-center overflow-hidden"
        :class="[
          isFullscreen ? 'bg-neutral-950' : 'bg-muted/15',
          zoomPercent > 100 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
        ]"
        @wheel="handleWheelZoom"
        @pointerdown="handlePointerDown"
        @pointerup="stopPanning"
        @pointercancel="stopPanning"
        @dblclick="handleDoubleClick"
        @dragenter.prevent="isDragActive = true"
        @dragover.prevent="isDragActive = true"
        @dragleave.prevent="isDragActive = false"
        @drop="handleDrop"
      >
        <img
          :src="imageUrl"
          :alt="imageMeta?.name ?? t('tools.image_viewer.title')"
          data-testid="image-viewer-preview"
          class="max-h-full max-w-full select-none object-contain"
          :style="zoomStyle"
          draggable="false"
        >

        <!-- 全屏时右上角浮动退出按钮 -->
        <button
          v-if="isFullscreen"
          type="button"
          class="absolute right-5 top-5 inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background/85 px-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-muted"
          :title="t('tools.image_viewer.fullscreen_exit')"
          @click="toggleFullscreen"
        >
          <Minimize2 class="h-4 w-4" />
          <span class="hidden sm:inline">{{ t('tools.image_viewer.fullscreen_exit') }}</span>
        </button>

        <!-- 右下浮动缩放控制 -->
        <div class="absolute bottom-5 right-5 flex items-center gap-1 rounded-xl border border-border/60 bg-background/85 px-2 py-1.5 shadow-lg backdrop-blur-sm">
          <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" :title="t('tools.image_viewer.zoom_out')" @click="zoomOut">
            <Minus class="h-4 w-4" />
          </button>
          <button type="button" class="grid h-8 min-w-14 place-items-center rounded-lg px-1 text-sm font-mono text-foreground transition-colors hover:bg-muted" :title="t('tools.image_viewer.zoom_reset')" @click="resetZoom">
            {{ zoomLabel }}
          </button>
          <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" :title="t('tools.image_viewer.zoom_in')" @click="zoomIn">
            <Plus class="h-4 w-4" />
          </button>
        </div>

        <!-- 右下信息徽标 -->
        <div v-if="imageMeta" class="absolute bottom-5 left-5 flex items-center gap-2 rounded-lg border border-border/60 bg-background/85 px-3 py-1.5 text-xs text-muted-foreground shadow backdrop-blur-sm">
          <button type="button" class="flex items-center gap-1.5 transition-colors hover:text-foreground" :title="t('tools.image_viewer.meta_title')" @click="showMetaPanel = !showMetaPanel">
            <Info class="h-3.5 w-3.5" />
            {{ imageMeta.width }} × {{ imageMeta.height }}
          </button>
        </div>

        <!-- 底部信息条（可折叠） -->
        <div v-if="showMetaPanel && imageMeta" class="absolute bottom-5 left-5 right-5 z-10">
          <div class="mx-auto flex max-w-lg flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/60 bg-background/95 px-5 py-3 text-sm shadow-xl backdrop-blur-md">
            <div class="min-w-0 flex-1">
              <div class="text-xs text-muted-foreground">{{ t('tools.image_viewer.file_name') }}</div>
              <div class="mt-0.5 truncate font-medium">{{ imageMeta.name }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">{{ t('tools.image_viewer.file_type') }}</div>
              <div class="mt-0.5 font-medium">{{ imageMeta.type }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">{{ t('tools.image_viewer.file_size') }}</div>
              <div class="mt-0.5 font-medium">{{ imageMeta.sizeText }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">{{ t('tools.image_viewer.dimensions') }}</div>
              <div class="mt-0.5 font-medium">{{ imageMeta.width }} × {{ imageMeta.height }}</div>
            </div>
            <button type="button" class="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" @click="showMetaPanel = false">
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- 底部提示条：全屏时隐藏 -->
    <footer v-if="!isFullscreen" class="border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
      {{ t('tools.image_viewer.paste_hint') }} {{ t('tools.image_viewer.pan_hint') }}
    </footer>

    <div v-if="errorMessage" class="border-t border-destructive/20 bg-destructive/10 px-5 py-2 text-sm text-destructive">
      {{ errorMessage }}
    </div>
  </div>
</template>
