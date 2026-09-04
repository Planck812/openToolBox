<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { Copy, ScanText, Upload } from 'lucide-vue-next';
import { ocrRecognizePng, type OcrResult } from '@/lib/ipc/ocr';
import { logContext } from '@/lib/logger';

interface Props {
  initialData?: string;
}

interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile?: () => File | null;
}

const props = defineProps<Props>();
const { t } = useI18n();

const previewUrl = ref('');
const result = ref<OcrResult | null>(null);
const errorMessage = ref('');
const recognizing = ref(false);
const copied = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const pasteListenerCapture = true;
const dragOver = ref(false);

/**
 * 从剪贴板条目中提取第一张图片
 */
const extractImageFileFromClipboardItems = (
  items: ArrayLike<ClipboardImageItem> | null | undefined,
): File | null => {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (!file) continue;
    return file.name ? file : new File([file], 'clipboard-image.png', { type: file.type || 'image/png' });
  }
  return null;
};

/**
 * 读取本地图片文件并转换为 Data URL
 */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });

/**
 * File → PNG 字节数组（invoke 用）
 */
const fileToBytes = async (file: File): Promise<number[]> => {
  const arrayBuffer = await file.arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
};

/**
 * 接收图片文件：预览 + 自动识别
 */
const applyImageFile = async (file: File) => {
  logContext('info', 'OCR', 'applyImageFile', `File selected: ${file.name} size=${file.size} bytes type=${file.type}`);

  if (!file.type.startsWith('image/')) {
    previewUrl.value = '';
    result.value = null;
    errorMessage.value = t('tools.ocr.invalid_image');
    logContext('warn', 'OCR', 'applyImageFile', `Invalid image type: ${file.type}`);
    return;
  }

  try {
    const readStart = performance.now();
    const dataUrl = await readFileAsDataUrl(file);
    const readDuration = performance.now() - readStart;
    logContext('debug', 'OCR', 'applyImageFile', `Image converted to DataURL duration=${readDuration.toFixed(2)}ms`);

    previewUrl.value = dataUrl;
    errorMessage.value = '';
    await recognize(file);
  } catch (e) {
    previewUrl.value = '';
    result.value = null;
    errorMessage.value = t('tools.ocr.read_failed');
    logContext('error', 'OCR', 'applyImageFile', `Image read failed`, { error: String(e) });
  }
};

/** OCR 模式：'best'（精准，默认）或 'fast'（快速）。 */
const ocrMode = ref<'best' | 'fast'>('best');

/**
 * 执行 OCR 识别
 */
const recognize = async (file?: File) => {
  if (recognizing.value) {
    logContext('warn', 'OCR', 'recognize', 'Recognition already in progress, skipping');
    return;
  }

  const startTime = performance.now();
  let target = file;
  if (!target && previewUrl.value) {
    // 从 dataUrl 转回 File（重识别当前预览图）
    logContext('debug', 'OCR', 'recognize', 'Fetching preview image from DataURL');
    const resp = await fetch(previewUrl.value);
    const blob = await resp.blob();
    target = new File([blob], 'preview.png', { type: blob.type || 'image/png' });
  }
  if (!target) {
    errorMessage.value = t('tools.ocr.no_image');
    logContext('warn', 'OCR', 'recognize', 'No image available for recognition');
    return;
  }

  recognizing.value = true;
  copied.value = false;
  errorMessage.value = '';

  logContext('info', 'OCR', 'recognize', `OCR recognition started: mode=${ocrMode.value}`);

  try {
    const bytesStart = performance.now();
    const bytes = await fileToBytes(target);
    const bytesDuration = performance.now() - bytesStart;
    logContext('debug', 'OCR', 'recognize', `Image data prepared: size=${bytes.length} bytes duration=${bytesDuration.toFixed(2)}ms`);

    const recognizeStart = performance.now();
    const res = await ocrRecognizePng({ png: bytes, mode: ocrMode.value });
    const recognizeDuration = performance.now() - recognizeStart;

    result.value = res;
    const totalDuration = performance.now() - startTime;

    logContext('info', 'OCR', 'recognize', `OCR recognition completed: text_length=${res.text.length} confidence=${(res.avgConfidence ?? 0).toFixed(1)}% backend_duration=${recognizeDuration.toFixed(0)}ms total_duration=${totalDuration.toFixed(0)}ms`);

    if (recognizeDuration > 3000) {
      logContext('warn', 'OCR', 'recognize', `Slow OCR recognition (${recognizeDuration.toFixed(0)}ms) - mode=${ocrMode.value}`);
    }
  } catch (e) {
    const duration = performance.now() - startTime;
    errorMessage.value = typeof e === 'string' ? e : String(e);
    result.value = null;
    logContext('error', 'OCR', 'recognize', `OCR recognition failed after ${duration.toFixed(0)}ms`, {
      error: errorMessage.value,
      mode: ocrMode.value,
    });
  } finally {
    recognizing.value = false;
  }
};

/**
 * 复制识别结果
 */
const copyResult = async () => {
  if (!result.value?.text) return;
  const ok = await copyText(result.value.text);
  if (ok) {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } else {
    errorMessage.value = t('tools.ocr.copy_failed');
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

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  dragOver.value = true;
};

const handleDragLeave = () => {
  dragOver.value = false;
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  dragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  void applyImageFile(file);
};

onMounted(() => {
  window.addEventListener('paste', handlePaste, pasteListenerCapture);
  // 若带 initialData（图片 dataUrl），预览并自动识别。
  // 注意：initialData 是 ToolView 传入的搜索输入（inputContent），只有真正的
  // data:image/ 前缀才当作图片处理，避免把搜索词渲染成破图。
  const initial = props.initialData?.trim();
  if (initial?.startsWith('data:image/')) {
    previewUrl.value = initial;
    void recognize();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste, pasteListenerCapture);
});
</script>

<template>
  <div class="h-full overflow-auto bg-background text-foreground">
    <div class="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <!-- 输入区：粘贴提示 + 文件选择 + 拖拽 -->
      <section
        class="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card p-8 transition-colors"
        :class="dragOver ? 'border-primary bg-primary/5' : ''"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <ScanText class="mb-3 h-10 w-10 text-muted-foreground" />
        <div class="mb-2 text-sm text-muted-foreground">{{ t('tools.ocr.paste_tip') }}</div>
        <div class="mb-3 flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <button
            class="rounded-md px-3 py-1.5 transition-colors"
            :class="ocrMode === 'best' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
            @click="ocrMode = 'best'"
          >
            {{ t('tools.ocr.mode_best') }}
          </button>
          <button
            class="rounded-md px-3 py-1.5 transition-colors"
            :class="ocrMode === 'fast' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
            @click="ocrMode = 'fast'"
          >
            {{ t('tools.ocr.mode_fast') }}
          </button>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="mb-2 block w-full max-w-xs text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-primary-foreground"
          @change="handleFileChange"
        >
        <button
          class="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          @click="fileInputRef?.click()"
        >
          <Upload class="h-4 w-4" />
          {{ t('tools.ocr.upload_btn') }}
        </button>
      </section>

      <!-- 预览 + 结果区 -->
      <div v-if="previewUrl || result || errorMessage" class="grid gap-6" style="grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);">
        <section v-if="previewUrl" class="flex min-h-[300px] flex-col rounded-2xl border border-border bg-card p-4">
          <div class="mb-3 text-sm font-medium">{{ t('tools.ocr.image_title') }}</div>
          <div class="flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-muted/30 p-2">
            <img :src="previewUrl" alt="preview" class="max-h-[300px] max-w-full rounded-lg object-contain">
          </div>
        </section>

        <section class="flex min-h-[300px] flex-col rounded-2xl border border-border bg-card p-4">
          <div class="mb-3 flex items-center justify-between text-sm font-medium">
            <span>{{ t('tools.ocr.result_title') }}</span>
            <button
              v-if="result?.text"
              class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
              @click="copyResult"
            >
              <Copy class="h-3.5 w-3.5" />
              {{ copied ? t('tools.ocr.copied') : t('tools.ocr.copy_btn') }}
            </button>
          </div>

          <div v-if="recognizing" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {{ t('tools.ocr.recognizing') }}
          </div>
          <textarea
            v-else-if="result?.text"
            :value="result.text"
            readonly
            class="min-h-[260px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none"
          />
          <div v-else class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {{ t('tools.ocr.result_placeholder') }}
          </div>

          <div v-if="result && (result.avgConfidence ?? 0) > 0" class="mt-2 text-xs text-muted-foreground">
            {{ t('tools.ocr.confidence') }}: {{ Math.round(result.avgConfidence ?? 0) }}%
          </div>
        </section>
      </div>

      <div v-if="errorMessage" class="text-sm text-destructive">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>
