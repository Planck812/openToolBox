<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { copyText } from '@/lib/clipboard';
import { joinTextLines } from './index';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const DEFAULT_DELIMITER = ',';

const delimiter = ref(DEFAULT_DELIMITER);
const prefix = ref('');
const inputText = ref('');
const outputText = ref('');
const autoCopy = ref(true);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 300, minSecondWidth: 300 });

const enableQuote = ref(false);
const quoteMode = ref<'double' | 'single'>('double');
const quoteChar = computed<'"' | '\''>(() => (quoteMode.value === 'double' ? '"' : "'"));

const delimiterDisplay = computed(() => {
  if (delimiter.value === '\t') return '\\t';
  if (delimiter.value === ' ') return t('tools.text_join.space');
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
 * 执行文本合并处理
 * @param options 可选配置
 */
const merge = async (options?: { silent?: boolean }) => {
  const source = inputText.value;
  const result = joinTextLines(source, {
    delimiter: delimiter.value,
    defaultDelimiter: DEFAULT_DELIMITER,
    prefix: prefix.value,
    enableQuote: enableQuote.value,
    quoteChar: quoteChar.value,
  });

  if (result.items.length === 0 && !source.trim()) {
    outputText.value = '';
    if (!options?.silent) {
      store.showToast(t('tools.text_join.empty_input_warning'), { type: 'warning' });
    }
    return;
  }

  outputText.value = result.text;

  if (options?.silent) return;

  const count = result.items.length;
  if (autoCopy.value) {
    try {
      await copyToClipboard(outputText.value);
      store.showToast(t('tools.text_join.processed_and_copied', { count }), { type: 'success' });
    } catch {
      store.showToast(t('tools.text_join.processed_but_copy_failed', { count }), { type: 'warning' });
    }
    return;
  }

  store.showToast(t('tools.text_join.processed', { count }), { type: 'success' });
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
    store.showToast(t('tools.text_join.empty_output_warning'), { type: 'warning' });
    return;
  }

  try {
    await copyToClipboard(text);
    store.showToast(t('tools.text_join.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.text_join.copy_failed'), { type: 'error' });
  }
};

/**
 * 页面级快捷键处理（仅在文本合并工具页生效）
 * @param e 键盘事件
 */
const handleKeydown = (e: KeyboardEvent) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;

  const key = e.key.toLowerCase();
  if (key === 'enter') {
    e.preventDefault();
    void merge();
    return;
  }

  if (key === 'delete') {
    e.preventDefault();
    clearAll();
    return;
  }

  if (key === 'c') {
    const activeTag = (document.activeElement?.tagName || '').toLowerCase();
    const isEditing = activeTag === 'input' || activeTag === 'textarea';
    if (!isEditing) {
      e.preventDefault();
      void copyResult();
    }
  }
};

/**
 * 输入框粘贴后自动执行合并
 */
const handlePaste = () => {
  window.setTimeout(async () => {
    await nextTick();
    void merge();
  }, 0);
};

onMounted(() => {
  if (props.initialData) {
    inputText.value = props.initialData;
    void merge({ silent: true });
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
    void merge({ silent: true });
  }
);
</script>

<template>
  <div class="h-full flex flex-col p-4 gap-4 bg-background text-foreground min-h-0 overflow-auto">
    <div class="border border-border rounded-md bg-card p-4 flex flex-col gap-3">
      <div class="text-sm font-medium">{{ t('tools.text_join.settings_title') }}</div>
      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm text-muted-foreground w-20 shrink-0">{{ t('tools.text_join.delimiter') }}</label>
        <input
          v-model="delimiter"
          data-testid="text-join-delimiter-input"
          class="flex-1 min-w-[240px] px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_join.delimiter_placeholder')"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(',')">
            {{ t('tools.text_join.preset_comma') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(' ')">
            {{ t('tools.text_join.preset_space') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter(';')">
            {{ t('tools.text_join.preset_semicolon') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter('\t')">
            {{ t('tools.text_join.preset_tab') }}
          </button>
          <button class="px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="setDelimiter('|')">
            {{ t('tools.text_join.preset_pipe') }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm text-muted-foreground w-20 shrink-0">{{ t('tools.text_join.prefix') }}</label>
        <input
          v-model="prefix"
          data-testid="text-join-prefix-input"
          class="flex-1 min-w-[240px] px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_join.prefix_placeholder')"
        />
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-sm text-muted-foreground w-20 shrink-0">{{ t('tools.text_join.quote_wrap') }}</label>
        <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
          <input v-model="enableQuote" data-testid="text-join-enable-quote" type="checkbox" class="h-4 w-4 accent-primary" />
          {{ t('tools.text_join.quote_enable') }}
        </label>
        <div v-if="enableQuote" class="flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input v-model="quoteMode" type="radio" name="quote-type" value="double" />
            {{ t('tools.text_join.quote_double') }}
          </label>
          <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input v-model="quoteMode" type="radio" name="quote-type" value="single" />
            {{ t('tools.text_join.quote_single') }}
          </label>
          <div class="text-xs text-muted-foreground">
            {{ t('tools.text_join.quote_escape_hint') }}
          </div>
        </div>
      </div>

      <div class="text-xs text-muted-foreground">
        {{ t('tools.text_join.hint', { delimiter: delimiterDisplay }) }}
      </div>
    </div>

    <div class="flex items-center justify-center gap-3 flex-wrap">
      <button data-testid="text-join-merge-button" class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="merge()">
        {{ t('tools.text_join.merge') }}
      </button>
      <button class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="clearAll">
        {{ t('tools.text_join.clear') }}
      </button>
      <button class="px-6 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="copyResult">
        {{ t('tools.text_join.copy_result') }}
      </button>
      <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
        <input v-model="autoCopy" type="checkbox" class="h-4 w-4 accent-primary" />
        {{ t('tools.text_join.auto_copy') }}
      </label>
    </div>

    <div ref="containerRef" class="grid grid-cols-2 gap-4 flex-1 min-h-0" :style="{ gridTemplateColumns: firstPanelWidth === null ? undefined : `${firstPanelWidth}px minmax(300px, 1fr)` }">
      <div ref="firstPanelRef" class="relative flex flex-col gap-3 min-h-0">
        <div class="text-sm font-medium">{{ t('tools.text_join.input_title') }}</div>
        <textarea
          v-model="inputText"
          data-testid="text-join-input"
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.text_join.input_placeholder')"
          @paste="handlePaste"
        />
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.text_join.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </div>

      <div class="flex flex-col gap-3 min-h-0">
        <div class="text-sm font-medium">{{ t('tools.text_join.output_title') }}</div>
        <textarea
          v-model="outputText"
          data-testid="text-join-output"
          readonly
          class="flex-1 w-full min-h-0 resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none"
          :placeholder="t('tools.text_join.output_placeholder')"
        />
      </div>
    </div>
  </div>
</template>
