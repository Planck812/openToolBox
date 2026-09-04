<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { ArrowLeftRight, Copy, Eraser, RefreshCw } from 'lucide-vue-next';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import {
  convertFormat,
  detectFormatSync,
  SUPPORTED_FORMATS,
  type DataFormat,
  type DetectedFormat,
} from './engine';

interface Props {
  initialData?: string | { format?: DetectedFormat; text?: string; confidence?: number };
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const inputText = ref('');
const outputText = ref('');
const sourceFormat = ref<DataFormat>('auto');
const targetFormat = ref<DetectedFormat>('yaml');
const indent = ref(2);
const errorMessage = ref('');
const warningMessage = ref('');
const isConverting = ref(false);
const lastSourceFormat = ref<DetectedFormat | null>(null);

const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } =
  useResizablePanel({ minFirstWidth: 300, minSecondWidth: 300 });

const formatLabel = (format: DataFormat) => {
  if (format === 'auto') {
    return t('tools.format_convert.format_auto');
  }
  return t(`tools.format_convert.format_${format}`);
};

const detection = computed(() => detectFormatSync(inputText.value));

const detectionHint = computed(() => {
  if (!inputText.value.trim()) {
    return '';
  }
  if (!detection.value.format) {
    return t('tools.format_convert.detected_unknown');
  }
  return t('tools.format_convert.detected', {
    format: formatLabel(detection.value.format),
    confidence: detection.value.confidence,
  });
});

const applyInitialData = (value: Props['initialData']) => {
  if (!value) {
    return;
  }
  if (typeof value === 'string') {
    inputText.value = value;
    return;
  }
  if (value.text) {
    inputText.value = value.text;
  }
  if (value.format && SUPPORTED_FORMATS.includes(value.format)) {
    sourceFormat.value = value.format;
    // 默认目标选一个不同格式
    if (value.format === targetFormat.value) {
      targetFormat.value = value.format === 'json' ? 'yaml' : 'json';
    }
  }
};

watch(
  () => props.initialData,
  (value) => {
    applyInitialData(value);
  },
  { immediate: true },
);

const copyToClipboard = async (text: string) => copyText(text);

/**
 * 执行格式转换
 */
const handleConvert = async () => {
  errorMessage.value = '';
  warningMessage.value = '';

  if (!inputText.value.trim()) {
    outputText.value = '';
    store.showToast(t('tools.format_convert.empty_input_warning'), { type: 'warning' });
    return;
  }

  isConverting.value = true;
  try {
    const result = await convertFormat(inputText.value, {
      sourceFormat: sourceFormat.value,
      targetFormat: targetFormat.value,
      indent: indent.value,
    });

    if (!result.ok) {
      outputText.value = '';
      lastSourceFormat.value = result.sourceFormat ?? null;
      errorMessage.value = result.error;
      store.showToast(result.error || t('tools.format_convert.convert_failed'), { type: 'error' });
      return;
    }

    outputText.value = result.output;
    lastSourceFormat.value = result.sourceFormat;
    if (result.warning) {
      warningMessage.value = result.warning;
    }
    store.showToast(
      result.degraded
        ? t('tools.format_convert.convert_success_degraded')
        : t('tools.format_convert.convert_success'),
      { type: result.degraded ? 'warning' : 'success' },
    );
  } finally {
    isConverting.value = false;
  }
};

const clearAll = () => {
  inputText.value = '';
  outputText.value = '';
  errorMessage.value = '';
  warningMessage.value = '';
  lastSourceFormat.value = null;
};

const copyResult = async () => {
  if (!outputText.value.trim()) {
    store.showToast(t('tools.format_convert.empty_output_warning'), { type: 'warning' });
    return;
  }
  const ok = await copyToClipboard(outputText.value);
  store.showToast(
    ok ? t('tools.format_convert.copy_success') : t('tools.format_convert.copy_failed'),
    { type: ok ? 'success' : 'error' },
  );
};

/**
 * 用当前输出作为输入，并交换源/目标格式
 */
const swapFormats = () => {
  if (outputText.value.trim()) {
    inputText.value = outputText.value;
    outputText.value = '';
  }

  const resolvedSource: DetectedFormat =
    sourceFormat.value === 'auto'
      ? lastSourceFormat.value ?? detection.value.format ?? 'json'
      : sourceFormat.value;
  const previousTarget = targetFormat.value;

  sourceFormat.value = previousTarget;
  targetFormat.value = resolvedSource;
  errorMessage.value = '';
  warningMessage.value = '';
};
</script>

<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <div class="flex items-start justify-between gap-4 border-b border-border p-4">
      <div>
        <h1 class="text-lg font-medium">{{ t('tools.format_convert.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('tools.format_convert.subtitle') }}</p>
      </div>
      <div v-if="detectionHint" class="max-w-xs text-right text-xs text-muted-foreground">
        {{ detectionHint }}
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div class="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        <label class="flex min-w-[140px] flex-col gap-1 text-sm">
          <span class="text-muted-foreground">{{ t('tools.format_convert.source_format') }}</span>
          <select
            v-model="sourceFormat"
            data-testid="format-convert-source"
            class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="auto">{{ formatLabel('auto') }}</option>
            <option v-for="fmt in SUPPORTED_FORMATS" :key="`src-${fmt}`" :value="fmt">
              {{ formatLabel(fmt) }}
            </option>
          </select>
        </label>

        <button
          type="button"
          class="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-muted"
          :title="t('tools.format_convert.swap')"
          data-testid="format-convert-swap"
          @click="swapFormats"
        >
          <ArrowLeftRight class="h-4 w-4" />
        </button>

        <label class="flex min-w-[140px] flex-col gap-1 text-sm">
          <span class="text-muted-foreground">{{ t('tools.format_convert.target_format') }}</span>
          <select
            v-model="targetFormat"
            data-testid="format-convert-target"
            class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option v-for="fmt in SUPPORTED_FORMATS" :key="`dst-${fmt}`" :value="fmt">
              {{ formatLabel(fmt) }}
            </option>
          </select>
        </label>

        <label class="flex w-24 flex-col gap-1 text-sm">
          <span class="text-muted-foreground">{{ t('tools.format_convert.indent') }}</span>
          <input
            v-model.number="indent"
            type="number"
            min="0"
            max="8"
            data-testid="format-convert-indent"
            class="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        <div class="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="format-convert-run"
            class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            :disabled="isConverting"
            @click="handleConvert"
          >
            <RefreshCw class="h-4 w-4" :class="isConverting ? 'animate-spin' : ''" />
            {{ t('tools.format_convert.convert') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            @click="copyResult"
          >
            <Copy class="h-4 w-4" />
            {{ t('tools.format_convert.copy_result') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            @click="clearAll"
          >
            <Eraser class="h-4 w-4" />
            {{ t('tools.format_convert.clear') }}
          </button>
        </div>
      </div>

      <p class="text-xs text-muted-foreground">{{ t('tools.format_convert.hint') }}</p>

      <div
        v-if="errorMessage"
        data-testid="format-convert-error"
        class="rounded-md border border-rose-500/30 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-100"
      >
        {{ errorMessage }}
      </div>
      <div
        v-else-if="warningMessage"
        data-testid="format-convert-warning"
        class="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-100"
      >
        {{ warningMessage }}
      </div>

      <div
        ref="containerRef"
        class="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2"
        :style="{
          gridTemplateColumns:
            firstPanelWidth === null ? undefined : `${firstPanelWidth}px minmax(300px, 1fr)`,
        }"
      >
        <div ref="firstPanelRef" class="relative flex min-h-0 min-w-[280px] flex-col gap-2">
          <div class="text-sm font-medium text-muted-foreground">
            {{ t('tools.format_convert.input_title') }}
          </div>
          <textarea
            v-model="inputText"
            data-testid="format-convert-input"
            class="min-h-[220px] flex-1 resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-sm outline-none focus:ring-1 focus:ring-primary"
            :placeholder="t('tools.format_convert.input_placeholder')"
          />
          <div
            class="resizable-panel-divider"
            role="separator"
            :aria-label="t('tools.format_convert.resize_aria')"
            aria-orientation="vertical"
            tabindex="0"
            @pointerdown.prevent="startResize"
            @keydown="handleResizeKeydown"
          />
        </div>

        <div class="flex min-h-0 min-w-[280px] flex-col gap-2">
          <div class="text-sm font-medium text-muted-foreground">
            {{ t('tools.format_convert.output_title') }}
          </div>
          <textarea
            v-model="outputText"
            data-testid="format-convert-output"
            readonly
            class="min-h-[220px] flex-1 resize-none rounded-md border border-border bg-muted/20 p-3 font-mono text-sm outline-none"
            :placeholder="t('tools.format_convert.output_placeholder')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
