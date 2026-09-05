<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { copyText } from '@/lib/clipboard';
import { useQrRecognizer } from '@/composables/useQrRecognizer';
import {
  Copy,
  Download,
  FileText,
  Play,
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

interface GeneratedItem {
  text: string;
  image: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const activeMode = ref<ToolMode>('generate');
const activeTab = ref<GenType>('qrcode');

const inputText = ref('');
const isGenerated = ref(false);
const isGenerating = ref(false);
const generatedItems = ref<GeneratedItem[]>([]);
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

const pasteListenerCapture = true;

/**
 * 将文本写入系统剪贴板
 */
const {
  recognitionPreviewUrl,
  recognitionFileName,
  recognitionResult,
  recognitionError,
  revokeRecognitionUrl,
  loadImageElement,
  resetRecognitionState,
  recognizeFromPreview,
  recognizeFromClipboardImage,
} = useQrRecognizer({ activeMode });

const copyTextToClipboard = async (text: string) => {
  const ok = await copyText(text);
  if (!ok) throw new Error('clipboard-write-unavailable');
};

/**
 * 将生成结果的 Data URL 解析为可复用的图片字节
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

/** 多行输入的最大生成数量 */
const MAX_GENERATE_RESULTS = 100;

/**
 * 将输入按行拆分为待生成内容，空行不参与生成；超出上限的行被舍弃。
 */
const getGenerateLines = () =>
  inputText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_GENERATE_RESULTS);

const hasInputLines = computed(() => getGenerateLines().length > 0);

/**
 * 点击生成：根据当前输入与配置生成二维码或条形码
 */
const handleGenerate = async () => {
  const lines = getGenerateLines();
  if (!lines.length) {
    store.showToast(t('tools.qrcode_gen.input_empty_warning'), { type: 'warning' });
    return;
  }

  isGenerating.value = true;
  errorMsg.value = '';

  try {
    const items: GeneratedItem[] = [];
    if (activeTab.value === 'qrcode') {
      const images = await Promise.all(
        lines.map((line) => generateQRCode(line, qrOptions.value))
      );
      for (let i = 0; i < lines.length; i++) {
        items.push({ text: lines[i], image: images[i] });
      }
    } else {
      for (const line of lines) {
        const image = generateBarcode(line, barcodeOptions.value);
        items.push({ text: line, image });
      }
    }
    generatedItems.value = items;
    isGenerated.value = true;
  } catch (error) {
    generatedItems.value = [];
    const reason = error instanceof Error ? error.message : String(error);
    errorMsg.value = t('tools.qrcode_gen.gen_failed', { reason });
    store.showToast(errorMsg.value, { type: 'error' });
  } finally {
    isGenerating.value = false;
  }
};

/**
 * 点击重新生成：切回初始文本输入框，保留用户输入内容
 */
const handleRegenerate = () => {
  isGenerated.value = false;
};

/**
 * 单项图片下载
 */
const downloadSingleImage = (image: string, text: string, index: number) => {
  if (!image) return;

  const link = document.createElement('a');
  link.href = image;
  const safeSnippet = text.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_').slice(0, 20);
  link.download = `${activeTab.value}-${index + 1}${safeSnippet ? `-${safeSnippet}` : ''}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  store.showToast(t('tools.qrcode_gen.download_started'), { type: 'success' });
};

/**
 * 批量下载所有生成的图片
 */
const downloadAll = async () => {
  for (let i = 0; i < generatedItems.value.length; i++) {
    const item = generatedItems.value[i];
    downloadSingleImage(item.image, item.text, i);
    if (i < generatedItems.value.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
};

/**
 * 单项图片复制
 */
const copySingleImage = async (image: string) => {
  if (!image) return;

  try {
    const { mimeType, bytes } = decodeImageDataUrl(image);

    try {
      const tauriImage = await createClipboardImageFromDataUrl(image);
      await writeImage(tauriImage);
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
 * 单项文本复制
 */
const copySingleText = async (text: string) => {
  try {
    await copyTextToClipboard(text);
    store.showToast(t('tools.qrcode_gen.copy_text_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.qrcode_gen.copy_failed'), { type: 'error' });
  }
};

/**
 * 清空生成区域
 */
const clearGenerate = () => {
  inputText.value = '';
  generatedItems.value = [];
  isGenerated.value = false;
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
 * 切换生成类型时若在编辑态则保持，若在已生成态则切回未生成
 */
const onTabChange = (tab: GenType) => {
  activeTab.value = tab;
  if (isGenerated.value) {
    isGenerated.value = false;
  }
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
 * 处理剪贴板粘贴时的图片识别
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
 * 处理全局图片粘贴
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
    inputText.value = newVal;
    isGenerated.value = false;
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('paste', handlePaste, pasteListenerCapture);
});

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste, pasteListenerCapture);
  revokeRecognitionUrl();
});
</script>

<template>
  <div
    data-testid="qrcode-root"
    class="h-full flex flex-col p-4 gap-4 bg-background text-foreground min-h-0 overflow-auto"
  >
    <!-- 顶部模式与操作条 -->
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

      <!-- 类型切换（仅在未生成时显示） -->
      <div
        v-if="activeMode === 'generate' && !isGenerated"
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
          @click="onTabChange('qrcode')"
        >
          {{ t('tools.qrcode_gen.tab_qrcode') }}
        </button>
        <button
          class="relative z-10 w-24 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
          :class="activeTab === 'barcode'
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'"
          @click="onTabChange('barcode')"
        >
          {{ t('tools.qrcode_gen.tab_barcode') }}
        </button>
      </div>
    </div>

    <!-- 生成模式 -->
    <div v-if="activeMode === 'generate'" class="flex-1 flex flex-col gap-4 min-h-0">
      <!-- 初始未生成状态：不展示预览框，仅展示输入框与生成设置 -->
      <div v-if="!isGenerated" class="flex flex-col gap-4 max-w-3xl">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">{{ t('tools.qrcode_gen.input_label') }}</label>
            <span class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.input_hint') }}</span>
          </div>
          <div class="generate-input-shell">
            <textarea
              v-model="inputText"
              data-testid="qrcode-generate-input"
              class="block w-full h-36 p-3 bg-transparent font-mono text-sm resize-none border-0 outline-none focus:outline-none"
              :placeholder="t('tools.qrcode_gen.input_placeholder')"
              @keydown.ctrl.enter="handleGenerate"
              @keydown.meta.enter="handleGenerate"
            ></textarea>
          </div>
        </div>

        <GenerateOptions
          v-model:qr-options="qrOptions"
          v-model:barcode-options="barcodeOptions"
          :tab="activeTab"
        />

        <div>
          <button
            data-testid="qrcode-generate-btn"
            type="button"
            class="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            :disabled="!hasInputLines || isGenerating"
            @click="handleGenerate"
          >
            <RefreshCw v-if="isGenerating" class="w-4 h-4 animate-spin" />
            <Play v-else class="w-4 h-4 fill-current" />
            {{ t('tools.qrcode_gen.btn_generate') }}
          </button>
        </div>

        <div v-if="errorMsg" class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
          {{ errorMsg }}
        </div>
      </div>

      <!-- 已生成状态：输入不可编辑、不显示生成设置、只显示二维码/条形码、带有重新生成按钮 -->
      <div v-else class="flex-1 flex flex-col gap-4 min-h-0">
        <!-- 顶部操作条与不可编辑输入框 -->
        <div class="flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-4">
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-foreground">
                {{ t('tools.qrcode_gen.generated_count', { count: generatedItems.length }) }}
              </span>
              <span class="text-xs text-muted-foreground">
                ({{ activeTab === 'qrcode' ? t('tools.qrcode_gen.tab_qrcode') : t('tools.qrcode_gen.tab_barcode') }})
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="generatedItems.length > 1"
                data-testid="qrcode-batch-download-btn"
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors"
                @click="downloadAll"
              >
                <Download class="w-3.5 h-3.5" />
                {{ t('tools.qrcode_gen.batch_download_btn') }}
              </button>
              <button
                data-testid="qrcode-regenerate-btn"
                type="button"
                class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                @click="handleRegenerate"
              >
                <RefreshCw class="w-3.5 h-3.5" />
                {{ t('tools.qrcode_gen.btn_regenerate') }}
              </button>
            </div>
          </div>

          <div class="generate-input-shell opacity-80">
            <textarea
              :value="inputText"
              readonly
              disabled
              data-testid="qrcode-generate-input"
              class="block w-full h-16 p-2.5 bg-muted/30 font-mono text-xs resize-none border-0 outline-none cursor-not-allowed select-text text-muted-foreground"
            ></textarea>
          </div>
        </div>

        <!-- 结果多列网格展示：一行最多展示4个，无需分页，支持纵向滚动 -->
        <div class="flex-1 min-h-0 overflow-y-auto pr-1">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
            <div
              v-for="(item, index) in generatedItems"
              :key="index"
              class="flex flex-col items-center gap-3 p-4 rounded-xl border border-border bg-card shadow-sm hover:shadow transition-shadow"
            >
              <div class="flex items-center justify-between w-full text-xs text-muted-foreground">
                <span class="font-mono">#{{ index + 1 }}</span>
              </div>

              <div class="flex-1 flex items-center justify-center min-h-[160px] max-h-[220px] w-full p-3 bg-white rounded-lg border border-border/50 overflow-hidden">
                <img
                  :src="item.image"
                  data-testid="qrcode-result-image"
                  class="max-h-full max-w-full object-contain mx-auto select-none"
                  :alt="t('tools.qrcode_gen.result_image_alt')"
                />
              </div>

              <div class="w-full flex flex-col gap-2">
                <div
                  data-testid="qrcode-result-text"
                  class="text-xs font-mono break-all text-center text-muted-foreground line-clamp-2"
                  :title="item.text"
                >
                  {{ item.text }}
                </div>

                <div class="flex items-center justify-center gap-1.5 pt-2 border-t border-border/50">
                  <button
                    class="inline-flex items-center gap-1 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
                    :title="t('tools.qrcode_gen.copy_btn')"
                    @click="copySingleImage(item.image)"
                  >
                    <Copy class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="inline-flex items-center gap-1 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
                    :title="t('tools.qrcode_gen.download_btn')"
                    @click="downloadSingleImage(item.image, item.text, index)"
                  >
                    <Download class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="inline-flex items-center gap-1 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
                    :title="t('tools.qrcode_gen.copy_text_btn')"
                    @click="copySingleText(item.text)"
                  >
                    <FileText class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 识别模式 -->
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
