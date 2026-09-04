<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { copyText } from '@/lib/clipboard';
import { dedupLines } from './index';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const inputText = ref('');
const outputText = ref('');
const autoCopy = ref(true);

const trimLine = ref(true);
const ignoreCase = ref(true);
const removeEmpty = ref(true);
const sortOutput = ref(false);
const keepOrder = ref(true);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 320, minSecondWidth: 320, desktopBreakpoint: 768 });

const stats = computed(() => {
  const total = inputText.value ? inputText.value.replace(/\r\n/g, '\n').split('\n').length : 0;
  const current = outputText.value ? outputText.value.split('\n').length : 0;
  const removed = Math.max(total - current, 0);
  return { total, current, removed };
});

watch(
  () => props.initialData,
  (val) => {
    if (val) {
      inputText.value = val;
    }
  },
  { immediate: true }
);

/**
 * 写入剪贴板（优先 Tauri）
 */
const copyToClipboard = async (text: string) => copyText(text);

/**
 * 执行去重
 */
const handleDedup = async () => {
  if (!inputText.value.trim()) {
    outputText.value = '';
    store.showToast(t('tools.text_dedup.empty_input_warning'), { type: 'warning' });
    return;
  }

  const result = dedupLines(inputText.value, {
    trimLine: trimLine.value,
    ignoreCase: ignoreCase.value,
    removeEmpty: removeEmpty.value,
    sortOutput: sortOutput.value,
    keepOrder: keepOrder.value,
  });

  // 若保持顺序，dedupLines 已按原顺序；sortOutput=true 时会重新排序
  outputText.value = result.items.join('\n');

  const toastPayload = { total: result.total, removed: result.removed, unique: result.items.length };

  if (autoCopy.value) {
    const success = await copyToClipboard(outputText.value);
    if (success) {
      store.showToast(t('tools.text_dedup.processed_and_copied', toastPayload), { type: 'success' });
    } else {
      store.showToast(t('tools.text_dedup.processed_but_copy_failed', toastPayload), { type: 'warning' });
    }
    return;
  }

  store.showToast(t('tools.text_dedup.processed', toastPayload), { type: 'success' });
};

/**
 * 清空输入输出
 */
const clearAll = () => {
  inputText.value = '';
  outputText.value = '';
};

/**
 * 复制结果
 */
const copyResult = async () => {
  if (!outputText.value.trim()) {
    store.showToast(t('tools.text_dedup.empty_output_warning'), { type: 'warning' });
    return;
  }
  const success = await copyToClipboard(outputText.value);
  if (success) {
    store.showToast(t('tools.text_dedup.processed_and_copied', { total: stats.value.total, removed: stats.value.removed, unique: stats.value.current }), {
      type: 'success',
    });
  } else {
    store.showToast(t('tools.text_dedup.processed_but_copy_failed', { total: stats.value.total, removed: stats.value.removed, unique: stats.value.current }), {
      type: 'warning',
    });
  }
};
</script>

<template>
  <div class="flex flex-col h-full bg-background text-foreground">
    <div class="p-4 border-b border-border flex items-center justify-between gap-4">
      <div>
        <h1 class="text-lg font-medium">{{ t('tools.text_dedup.title') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ t('tools.text_dedup.description') }}
        </p>
      </div>
      <div class="text-sm text-muted-foreground">
        {{ t('tools.text_dedup.stats', { total: stats.total, removed: stats.removed, unique: stats.current }) }}
      </div>
    </div>

    <div class="p-4 flex flex-col gap-3 h-full overflow-hidden">
      <!-- Action bar -->
      <div class="flex items-center gap-3 justify-between">
        <div class="flex items-center gap-3 text-sm">
          <label class="flex items-center gap-1 cursor-pointer">
            <input v-model="autoCopy" type="checkbox" class="rounded border-border text-primary" />
            <span>{{ t('tools.text_dedup.auto_copy') }}</span>
          </label>
          <button class="px-3 py-1 text-sm border border-border rounded hover:bg-muted transition-colors" @click="clearAll">
            {{ t('tools.text_dedup.clear') }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button data-testid="text-dedup-run-button" class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" @click="handleDedup">
            {{ t('tools.text_dedup.dedup') }}
          </button>
          <button class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="copyResult">
            {{ t('tools.text_dedup.copy_result') }}
          </button>
        </div>
      </div>

      <div ref="containerRef" class="grid grid-cols-1 md:grid-cols-[minmax(320px,var(--panel-first-width,1fr))_minmax(320px,1fr)] gap-4 flex-1 overflow-hidden" :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }">
        <!-- Left: Input + Options -->
        <div ref="firstPanelRef" class="relative flex flex-col gap-3 h-full min-w-[320px]">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-muted-foreground">{{ t('tools.text_dedup.input_title') }}</h2>
          </div>
          <textarea
            v-model="inputText"
            data-testid="text-dedup-input"
            class="flex-1 min-h-[200px] bg-muted/30 border border-border rounded-md p-3 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            :placeholder="t('tools.text_dedup.input_placeholder')"
          ></textarea>

          <!-- Options -->
          <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="trimLine" type="checkbox" class="rounded border-border text-primary" />
              <span>{{ t('tools.text_dedup.trim_line') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="ignoreCase" type="checkbox" class="rounded border-border text-primary" />
              <span>{{ t('tools.text_dedup.ignore_case') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="removeEmpty" type="checkbox" class="rounded border-border text-primary" />
              <span>{{ t('tools.text_dedup.remove_empty') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="keepOrder" type="checkbox" class="rounded border-border text-primary" />
              <span>{{ t('tools.text_dedup.keep_order') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="sortOutput" type="checkbox" class="rounded border-border text-primary" />
              <span>{{ t('tools.text_dedup.sort_output') }}</span>
            </label>
          </div>
          <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.text_dedup.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
        </div>

        <!-- Right: Output -->
        <div class="flex flex-col gap-3 h-full min-w-[320px]">
          <h2 class="text-sm font-medium text-muted-foreground">{{ t('tools.text_dedup.output_title') }}</h2>
          <textarea
            v-model="outputText"
            data-testid="text-dedup-output"
            class="flex-1 min-h-[200px] bg-muted/20 border border-border rounded-md p-3 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            :placeholder="t('tools.text_dedup.output_placeholder')"
            readonly
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>
