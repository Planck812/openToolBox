<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { copyText } from '@/lib/clipboard';
import { splitTextToList } from './index';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const DEFAULT_DELIMITER = ',';

const delimiter = ref(DEFAULT_DELIMITER);
const inputText = ref('');
const outputText = ref('');
const autoCopy = ref(true);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 300, minSecondWidth: 300 });

const delimiterDisplay = computed(() => {
  if (delimiter.value === '\t') return '\\t';
  if (delimiter.value === ' ') return t('tools.text_split.space');
  return delimiter.value || DEFAULT_DELIMITER;
});

/**
 * 设定分隔符（支持多个字符与真实制表符）
 * @param value 分隔符
 */
const setDelimiter = (value: string) => {
  delimiter.value = value;
};

/**
 * 将处理结果写入系统剪贴板
 * @param text 待复制的文本
 */
const copyToClipboard = async (text: string) => {
  await copyText(text);
};

/**
 * 执行文本分割转换
 * @param options 配置项
 */
const convert = async (options?: { silent?: boolean }) => {
  const source = inputText.value;
  const result = splitTextToList(source, { delimiter: delimiter.value, defaultDelimiter: DEFAULT_DELIMITER });
  if (result.items.length === 0 && !source.trim()) {
    outputText.value = '';
    if (!options?.silent) {
      store.showToast(t('tools.text_split.empty_input_warning'), { type: 'warning' });
    }
    return;
  }

  outputText.value = result.text;

  if (options?.silent) return;

  const count = result.items.length;
  if (autoCopy.value) {
    try {
      await copyToClipboard(outputText.value);
      store.showToast(t('tools.text_split.processed_and_copied', { count }), { type: 'success' });
    } catch {
      store.showToast(t('tools.text_split.processed_but_copy_failed', { count }), { type: 'warning' });
    }
    return;
  }

  store.showToast(t('tools.text_split.processed', { count }), { type: 'success' });
};

/**
 * 清空输入与输出内容
 */
const clearAll = () => {
  inputText.value = '';
  outputText.value = '';
};

/**
 * 复制转换结果到剪贴板
 */
const copyResult = async () => {
  const text = outputText.value;
  if (!text.trim()) {
    store.showToast(t('tools.text_split.empty_output_warning'), { type: 'warning' });
    return;
  }

  try {
    await copyToClipboard(text);
    store.showToast(t('tools.text_split.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.text_split.copy_failed'), { type: 'error' });
  }
};

/**
 * 页面级快捷键处理（仅在文本分割工具页生效）
 * @param e 键盘事件
 */
const handleKeydown = (e: KeyboardEvent) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;

  const key = e.key.toLowerCase();
  if (key === 'enter') {
    e.preventDefault();
    void convert();
    return;
  }

  if (key === 'l') {
    e.preventDefault();
    clearAll();
    return;
  }
};

/**
 * 输入框粘贴后自动执行转换
 */
const handlePaste = () => {
  window.setTimeout(async () => {
    await nextTick();
    void convert();
  }, 0);
};

onMounted(() => {
  if (props.initialData) {
    inputText.value = props.initialData;
    void convert({ silent: true });
  }
  window.addEventListener('keydown', handleKeydown, { capture: true });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, { capture: true });
});

watch(
  () => props.initialData,
  (newVal) => {
    if (!newVal) return;
    inputText.value = newVal;
    void convert({ silent: true });
  }
);
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4 bg-background text-foreground min-h-0 overflow-auto">
    <div class="border border-border rounded-md bg-card p-4 flex flex-col gap-3">
      <div class="text-sm font-medium">{{ t('tools.text_split.delimiter_settings') }}</div>
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm text-muted-foreground w-20 shrink-0">{{ t('tools.text_split.delimiter') }}</label>
        <input
          v-model="delimiter"
          data-testid="text-split-delimiter-input"
          class="flex-1 min-w-[240px] px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_split.delimiter_placeholder')"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(',')">
            {{ t('tools.text_split.preset_comma') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(' ')">
            {{ t('tools.text_split.preset_space') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(';')">
            {{ t('tools.text_split.preset_semicolon') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter('\t')">
            {{ t('tools.text_split.preset_tab') }}
          </button>
        </div>
      </div>
      <div class="text-xs text-muted-foreground">
        {{ t('tools.text_split.hint', { delimiter: delimiterDisplay }) }}
      </div>
    </div>

    <div class="flex items-center justify-center gap-3 flex-wrap">
      <button data-testid="text-split-convert-button" class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="convert()">
        {{ t('tools.text_split.convert') }}
      </button>
      <button class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="clearAll">
        {{ t('tools.text_split.clear') }}
      </button>
      <button class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="copyResult">
        {{ t('tools.text_split.copy_result') }}
      </button>
      <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
        <input v-model="autoCopy" type="checkbox" class="h-4 w-4 accent-primary" />
        {{ t('tools.text_split.auto_copy') }}
      </label>
    </div>

    <div ref="containerRef" class="grid grid-cols-2 gap-4 flex-1 min-h-0" :style="{ gridTemplateColumns: firstPanelWidth === null ? undefined : `${firstPanelWidth}px minmax(300px, 1fr)` }">
      <div ref="firstPanelRef" class="relative flex flex-col gap-3 min-h-0">
        <div class="text-sm font-medium">{{ t('tools.text_split.input_title') }}</div>
        <textarea
          v-model="inputText"
          data-testid="text-split-input"
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_split.input_placeholder')"
          @paste="handlePaste"
        />
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.text_split.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </div>

      <div class="flex flex-col gap-3 min-h-0">
        <div class="text-sm font-medium">{{ t('tools.text_split.output_title') }}</div>
        <textarea
          v-model="outputText"
          data-testid="text-split-output"
          readonly
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none"
          :placeholder="t('tools.text_split.output_placeholder')"
        />
      </div>
    </div>
  </div>
</template>
