<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { copyText } from '@/lib/clipboard';
import { useQrRecognizer } from '@/composables/useQrRecognizer';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next';
import GenerateOptions from './GenerateOptions.vue';
import RecognitionWorkbench from './RecognitionWorkbench.vue';
import {
  extractImageFileFromClipboardItems,
  generateBarcode,
  generateQRCode,
  isImageFile,
  isRecognitionNotFoundError,
  type BarcodeOptions,
  type GenType,
  type QRCodeOptions,
  type RecognitionResult,
  type ToolMode,
} from './runtime';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const activeMode = ref<ToolMode>('generate');
const activeTab = ref<GenType>('qrcode');

const inputText = ref('');
const resultImage = ref('');
const generatePanels = useResizablePanel({ minFirstWidth: 320, minSecondWidth: 320 });
const resultImages = ref<string[]>([]);
const resultTexts = ref<string[]>([]);
const currentResultIndex = ref(0);
const isGenerating = ref(false);
const errorMsg = ref('');

const isRecognizing = ref(false);
const recognitionWorkbenchRef = ref<{ clearInput: () => void } | null>(null);

const qrOptions = ref<QRCodeOptions>({
  errorCorrectionLevel: 'M',
  margin: 4,
  width: 300,
  color: {
    dark: '#000000',
    light: '#ffffff',
  },
});

const barcodeOptions = ref<BarcodeOptions>({
  format: 'CODE128',
  width: 2,
  height: 100,
  displayValue: true,
  background: '#ffffff',
  lineColor: '#000000',
  margin: 10,
});

let debounceTimer: number | null = null;
const pasteListenerCapture = true;
// 参照 text-processor 的 pendingLaunchTarget 守卫：initialData 已直接生成时，跳过紧随其后的防抖二次生成。
const suppressNextGenerate = ref(false);

const currentResultImage = computed(() => resultImages.value[currentResultIndex.value] ?? '');
const currentResultText = computed(() => resultTexts.value[currentResultIndex.value] ?? '');
const hasMultipleResults = computed(() => resultImages.value.length > 1);

/**
 * 将当前展示下标限制在结果范围内，重新生成或清空时保持状态稳定。
 */
const normalizeCurrentResultIndex = () => {
  if (!resultImages.value.length) {
    currentResultIndex.value = 0;
    return;
  }

  currentResultIndex.value = Math.min(currentResultIndex.value, resultImages.value.length - 1);
};

const showPrevResult = () => {
  if (!resultImages.value.length) {
    return;
  }

  currentResultIndex.value = (currentResultIndex.value - 1 + resultImages.value.length) % resultImages.value.length;
};

const showNextResult = () => {
  if (!resultImages.value.length) {
    return;
  }

  currentResultIndex.value = (currentResultIndex.value + 1) % resultImages.value.length;
};

/**
 * 将文本写入系统剪贴板
 */
const { recognitionPreviewUrl, recognitionFileName, recognitionResult, recognitionError, revokeRecognitionUrl, loadImageElement, resetRecognitionState, recognizeFromPreview, recognizeFromClipboardImage } = useQrRecognizer({ activeMode });
const copyTextToClipboard = async (text: string) => {
  const ok = await copyText(text);
  if (!ok) throw new Error('clipboard-write-unavailable');
};

/**
 * 将生成结果的 Data URL 解析为可复用的图片字节，避免依赖桌面端对 data: fetch 的支持
 */
const decodeImageDataUrl = (dataUrl: string) => {
  const matched = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!matched) {
    throw new Error('invalid-image-data-url');
  }

  const [, mimeType, encoded] = matched;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return {
    mimeType: mimeType || 'image/png',
    bytes,
  };
};

/**
 * 将当前生成的 Data URL 渲染成 RGBA 像素，供桌面端按真实位图写入系统剪贴板
 */
const createClipboardImageFromDataUrl = async (dataUrl: string) => {
  const previewImage = await loadImageElement(dataUrl);
  const width = previewImage.naturalWidth || previewImage.width;
  const height = previewImage.naturalHeight || previewImage.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('clipboard-image-canvas-unavailable');
  }

  context.drawImage(previewImage, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  return TauriImage.new(imageData.data, width, height);
};

/** 多行输入的最大生成数量：避免每行一张整幅位图常驻内存（如 100 行 = 100 张位图）。 */
const MAX_GENERATE_RESULTS = 50;

/**
 * 将输入按行拆分为待生成内容，空行不参与生成；超出上限的行被舍弃。
 */
const getGenerateLines = () =>
  inputText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_GENERATE_RESULTS);

/**
 * 根据当前输入与配置生成二维码或条形码
 */
const generate = async () => {
  const lines = getGenerateLines();
  if (!lines.length) {
    resultImage.value = '';
    resultImages.value = [];
    resultTexts.value = [];
    currentResultIndex.value = 0;
    errorMsg.value = '';
    return;
  }

  isGenerating.value = true;
  errorMsg.value = '';

  try {
    if (activeTab.value === 'qrcode') {
      resultTexts.value = lines;
      resultImages.value = await Promise.all(lines.map((line) => generateQRCode(line, qrOptions.value)));
      normalizeCurrentResultIndex();
      resultImage.value = currentResultImage.value;
    } else {
      resultTexts.value = lines;
      resultImages.value = lines.map((line) => generateBarcode(line, barcodeOptions.value));
      normalizeCurrentResultIndex();
      resultImage.value = currentResultImage.value;
    }
  } catch (error) {
    resultImage.value = '';
    resultImages.value = [];
    resultTexts.value = [];
    currentResultIndex.value = 0;
    errorMsg.value = t('tools.qrcode_gen.gen_failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isGenerating.value = false;
  }
};

/**
 * 对生成操作做轻量防抖，避免连续输入时频繁重绘
 */
const triggerGenerate = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = window.setTimeout(() => {
    void generate();
  }, 300);
};

/**
 * 下载当前生成图片
 */
const downloadImage = () => {
  if (!currentResultImage.value) {
    return;
  }

  const link = document.createElement('a');
  link.href = currentResultImage.value;
  link.download = `${activeTab.value}-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  store.showToast(t('tools.qrcode_gen.download_started'), { type: 'success' });
};

/**
 * 复制当前生成图片
 */
const copyImage = async () => {
  if (!currentResultImage.value) {
    return;
  }

  try {
    const { mimeType, bytes } = decodeImageDataUrl(currentResultImage.value);

    try {
      const image = await createClipboardImageFromDataUrl(currentResultImage.value);
      await writeImage(image);
    } catch {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('clipboard-image-write-unavailable');
      }

      await navigator.clipboard.write([
        new ClipboardItem({
          [mimeType]: new Blob([bytes], { type: mimeType }),
        }),
      ]);
    }

    store.showToast(t('tools.qrcode_gen.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.qrcode_gen.copy_failed'), { type: 'error' });
  }
};

/**
 * 清空生成区域
 */
const clearGenerate = () => {
  inputText.value = '';
  resultImage.value = '';
  resultImages.value = [];
  resultTexts.value = [];
  currentResultIndex.value = 0;
  errorMsg.value = '';
};

/**
 * 清空识别区域
 */
const clearRecognition = () => {
  revokeRecognitionUrl();
  recognitionPreviewUrl.value = '';
  recognitionFileName.value = '';
  recognitionResult.value = null;
  recognitionError.value = '';
  isRecognizing.value = false;
  recognitionWorkbenchRef.value?.clearInput();
};

/**
 * 清空当前模式对应的数据
 */
const clearCurrentMode = () => {
  if (activeMode.value === 'generate') {
    clearGenerate();
    return;
  }

  clearRecognition();
};

/**
 * 为识别结果复制文本内容
 */
const copyRecognitionResult = async () => {
  const text = recognitionResult.value?.text?.trim();
  if (!text) {
    store.showToast(t('tools.qrcode_gen.empty_recognition_result'), { type: 'warning' });
    return;
  }

  try {
    await copyTextToClipboard(text);
    store.showToast(t('tools.qrcode_gen.copy_result_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.qrcode_gen.copy_failed'), { type: 'error' });
  }
};

/**
 * 执行一次完整识别流程，统一处理加载态、结果态与错误提示
 */
const runRecognition = async (recognize: () => Promise<RecognitionResult>) => {
  resetRecognitionState();
  isRecognizing.value = true;

  try {
    const result = await recognize();
    recognitionResult.value = result;
    store.showToast(t('tools.qrcode_gen.recognition_success', { format: result.formatLabel }), {
      type: 'success',
    });
  } catch (error) {
    const message = isRecognitionNotFoundError(error)
      ? t('tools.qrcode_gen.recognition_not_found')
      : t('tools.qrcode_gen.recognition_failed', {
          reason: error instanceof Error ? error.message : String(error),
        });

    recognitionError.value = message;
    store.showToast(message, { type: isRecognitionNotFoundError(error) ? 'warning' : 'error' });
  } finally {
    isRecognizing.value = false;
  }
};

/**
 * 使用浏览器文件对象完成识别
 */
const recognizeFromFile = async (file: File) => {
  const fileName = file.name || t('tools.qrcode_gen.pasted_image_default_name');
  const objectUrl = URL.createObjectURL(file);
  return recognizeFromPreview(objectUrl, fileName, true);
};

/**
 * 接收新图片后刷新预览和识别结果
 */
const handleRecognitionFile = async (file: File) => {
  if (!isImageFile(file)) {
    const message = t('tools.qrcode_gen.invalid_image');
    recognitionError.value = message;
    store.showToast(message, { type: 'warning' });
    return;
  }

  await runRecognition(() => recognizeFromFile(file));
};

/**
 * 处理剪贴板粘贴时的图片识别，优先读取系统剪贴板图像以绕开 WebView 的图片兼容问题
 */
const handlePastedRecognitionFile = async (file: File) => {
  if (!isImageFile(file)) {
    const message = t('tools.qrcode_gen.invalid_image');
    recognitionError.value = message;
    store.showToast(message, { type: 'warning' });
    return;
  }

  await runRecognition(async () => {
    try {
      return await recognizeFromClipboardImage();
    } catch {
      return recognizeFromFile(file);
    }
  });
};

/**
 * 处理本地图片上传
 */
const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';

  if (file) {
    void handleRecognitionFile(file);
  }
};

/**
 * 处理全局图片粘贴，文本粘贴仍交给当前输入框
 */
const handlePaste = (event: ClipboardEvent) => {
  const file = extractImageFileFromClipboardItems(event.clipboardData?.items);
  if (!file) {
    return;
  }

  event.preventDefault();
  void handlePastedRecognitionFile(file);
};

watch(
  () => props.initialData,
  (newVal) => {
    if (!newVal) {
      return;
    }

    const shouldGenerate = activeMode.value === 'generate';
    suppressNextGenerate.value = shouldGenerate;
    inputText.value = newVal;
    if (shouldGenerate) {
      void generate();
    }
  },
  { immediate: true },
);

watch([inputText, activeTab], () => {
  if (activeMode.value !== 'generate') {
    return;
  }

  if (suppressNextGenerate.value) {
    suppressNextGenerate.value = false;
    return;
  }

  triggerGenerate();
});

watch(
  qrOptions,
  () => {
    if (activeMode.value === 'generate' && activeTab.value === 'qrcode') {
      triggerGenerate();
    }
  },
  { deep: true },
);

watch(
  barcodeOptions,
  () => {
    if (activeMode.value === 'generate' && activeTab.value === 'barcode') {
      triggerGenerate();
    }
  },
  { deep: true },
);

onMounted(() => {
  window.addEventListener('paste', handlePaste, pasteListenerCapture);
});

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  window.removeEventListener('paste', handlePaste, pasteListenerCapture);
  revokeRecognitionUrl();
});
</script>

<template>
  <div
    data-testid="qrcode-root"
    class="h-full flex flex-col p-4 gap-4 bg-background text-foreground min-h-0 overflow-auto"
  >
    <div class="border-b border-border pb-3 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <button
            class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            :class="activeMode === 'generate' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            @click="activeMode = 'generate'"
          >
            {{ t('tools.qrcode_gen.mode_generate') }}
          </button>
          <button
            class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            :class="activeMode === 'recognize' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            @click="activeMode = 'recognize'"
          >
            {{ t('tools.qrcode_gen.mode_recognize') }}
          </button>
        </div>

        <button
          class="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
          :title="t('tools.qrcode_gen.clear_btn')"
          @click="clearCurrentMode"
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </div>

      <div
        v-if="activeMode === 'generate'"
        class="relative grid w-fit max-w-fit self-start grid-cols-2 overflow-hidden rounded-xl border border-border bg-muted/50 p-1"
      >
        <div
          class="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-primary shadow-sm transition-transform duration-200 ease-out"
          :style="{ transform: activeTab === 'qrcode' ? 'translateX(0)' : 'translateX(100%)' }"
        ></div>
        <button
          class="relative z-10 w-24 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
          :class="activeTab === 'qrcode'
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'"
          @click="activeTab = 'qrcode'"
        >
          {{ t('tools.qrcode_gen.tab_qrcode') }}
        </button>
        <button
          class="relative z-10 w-24 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
          :class="activeTab === 'barcode'
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'"
          @click="activeTab = 'barcode'"
        >
          {{ t('tools.qrcode_gen.tab_barcode') }}
        </button>
      </div>
    </div>

    <div
      v-if="activeMode === 'generate'"
      :ref="generatePanels.containerRef"
      data-testid="generate-layout"
      class="grid grid-cols-1 gap-4 min-h-0 lg:flex-1 lg:grid-cols-[minmax(320px,var(--panel-first-width,1fr))_minmax(320px,1fr)]"
      :style="{ '--panel-first-width': generatePanels.firstPanelWidth === null ? undefined : `${generatePanels.firstPanelWidth}px` }"
    >
      <div
        :ref="generatePanels.firstPanelRef"
        data-testid="generate-form-panel"
        class="relative shrink-0 flex flex-col gap-4 min-h-0 overflow-visible lg:min-w-0 lg:overflow-y-auto"
      >
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">{{ t('tools.qrcode_gen.input_label') }}</label>
          <div class="generate-input-shell">
            <textarea
              v-model="inputText"
              data-testid="qrcode-generate-input"
              class="block w-full h-32 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:outline-none"
              :placeholder="t('tools.qrcode_gen.input_placeholder')"
            ></textarea>
          </div>
        </div>

        <GenerateOptions
          v-model:qr-options="qrOptions"
          v-model:barcode-options="barcodeOptions"
          :tab="activeTab"
        />
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.qrcode_gen.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="generatePanels.startResize" @keydown="generatePanels.handleResizeKeydown"></div>
      </div>

      <div
        data-testid="generate-preview-panel"
        class="shrink-0 min-h-[260px] flex flex-col gap-4 min-h-0 bg-muted/10 rounded-lg p-4 border border-border lg:min-w-0"
      >
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">{{ t('tools.qrcode_gen.preview_title') }}</label>
          <div class="flex items-center gap-2">
            <button
              class="p-2 rounded hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="!resultImage"
              :title="t('tools.qrcode_gen.copy_btn')"
              @click="copyImage"
            >
              <Copy class="w-4 h-4" />
            </button>
            <button
              class="p-2 rounded hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="!resultImage"
              :title="t('tools.qrcode_gen.download_btn')"
              @click="downloadImage"
            >
              <Download class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg bg-background overflow-hidden relative">
          <div v-if="!resultImage && !errorMsg" class="text-muted-foreground text-sm">
            {{ t('tools.qrcode_gen.preview_placeholder') }}
          </div>
          <div v-else-if="errorMsg" class="text-destructive text-sm p-4 text-center">
            {{ errorMsg }}
          </div>
          <div v-else class="flex h-full w-full flex-col items-center justify-center gap-4 p-4">
            <div class="flex w-full flex-1 items-center justify-center gap-4 min-h-0">
              <button
                v-if="hasMultipleResults"
                data-testid="qrcode-prev-button"
                :title="t('tools.qrcode_gen.prev_result_btn')"
                class="shrink-0 rounded-full border border-border bg-card p-2 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                type="button"
                @click="showPrevResult"
              >
                <ChevronLeft class="h-5 w-5" />
              </button>

              <img
                :src="currentResultImage"
                data-testid="qrcode-result-image"
                class="max-h-full max-w-full object-contain"
                :alt="t('tools.qrcode_gen.result_image_alt')"
              />

              <button
                v-if="hasMultipleResults"
                data-testid="qrcode-next-button"
                :title="t('tools.qrcode_gen.next_result_btn')"
                class="shrink-0 rounded-full border border-border bg-card p-2 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                type="button"
                @click="showNextResult"
              >
                <ChevronRight class="h-5 w-5" />
              </button>
            </div>

            <div class="flex w-full max-w-xl flex-col items-center gap-2 rounded-lg border border-border bg-card/80 px-4 py-3 text-center shadow-sm">
              <div
                data-testid="qrcode-result-text"
                class="w-full break-all font-mono text-sm text-foreground"
              >
                {{ currentResultText }}
              </div>
              <div
                v-if="hasMultipleResults"
                data-testid="qrcode-result-counter"
                class="text-xs text-muted-foreground"
              >
                {{ currentResultIndex + 1 }} / {{ resultImages.length }}
              </div>
            </div>
          </div>

          <div v-if="isGenerating" class="absolute inset-0 bg-background/50 flex items-center justify-center">
            <RefreshCw class="w-6 h-6 animate-spin text-primary" />
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <RecognitionWorkbench
        ref="recognitionWorkbenchRef"
        :recognition-preview-url="recognitionPreviewUrl"
        :recognition-file-name="recognitionFileName"
        :recognition-result="recognitionResult"
        :recognition-error="recognitionError"
        :is-recognizing="isRecognizing"
        @file-change="handleFileChange"
        @copy-result="copyRecognitionResult"
      />
    </div>
  </div>
</template>

<style scoped>
.generate-input-shell {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.generate-input-shell:focus-within {
  border-color: hsl(var(--primary));
  box-shadow: inset 0 0 0 1px hsl(var(--primary));
}
</style>
