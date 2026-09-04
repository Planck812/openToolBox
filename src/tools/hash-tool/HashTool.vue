<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import {
  HASH_ALGORITHMS,
  compareHash,
  digestAll,
  formatDigest,
  type HashAlgorithm,
  type HashDigestMap,
} from './runtime';

interface Props {
  initialData?: string;
}

type InputMode = 'text' | 'file';
type AlgorithmSelection = HashAlgorithm | 'all';

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const inputMode = ref<InputMode>('text');
const textInput = ref('');
const fileName = ref('');
const fileSize = ref(0);
const fileBytes = ref<Uint8Array | null>(null);
const algorithmSelection = ref<AlgorithmSelection>('all');
const uppercase = ref(false);
const expectedValue = ref('');
const isBusy = ref(false);
const digests = ref<Partial<HashDigestMap>>({});

const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } =
  useResizablePanel({ minFirstWidth: 300, minSecondWidth: 360 });

const algorithmOptions: Array<{ value: AlgorithmSelection; label: string }> = [
  { value: 'all', label: t('tools.hash_tool.all') },
  ...HASH_ALGORITHMS.map((algorithm) => ({ value: algorithm, label: algorithm })),
];

const selectedAlgorithms = computed<HashAlgorithm[]>(() => {
  if (algorithmSelection.value === 'all') {
    return [...HASH_ALGORITHMS];
  }
  return [algorithmSelection.value];
});

const resultRows = computed(() =>
  selectedAlgorithms.value.map((algorithm) => {
    const raw = digests.value[algorithm] ?? '';
    const display = raw ? formatDigest(raw, uppercase.value) : '';
    let matchState: 'ok' | 'fail' | 'skip' = 'skip';
    if (raw && expectedValue.value.trim()) {
      matchState = compareHash(raw, expectedValue.value) ? 'ok' : 'fail';
    }
    return { algorithm, display, matchState };
  }),
);

const hasAnyResult = computed(() => resultRows.value.some((row) => row.display));

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

const copyToClipboard = async (text: string) => {
  if (!(await copyText(text))) throw new Error('clipboard-unavailable');
};

const clearResults = () => {
  digests.value = {};
};

const clearAll = () => {
  textInput.value = '';
  fileName.value = '';
  fileSize.value = 0;
  fileBytes.value = null;
  expectedValue.value = '';
  clearResults();
};

const onFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    fileName.value = '';
    fileSize.value = 0;
    fileBytes.value = null;
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    fileBytes.value = new Uint8Array(buffer);
    fileName.value = file.name;
    fileSize.value = file.size;
    clearResults();
  } catch {
    store.showToast(t('tools.hash_tool.file_read_failed'), { type: 'error' });
  }
};

const resolveInputBytes = (): Uint8Array | null => {
  if (inputMode.value === 'file') {
    return fileBytes.value;
  }
  return new TextEncoder().encode(textInput.value);
};

const compute = async () => {
  const bytes = resolveInputBytes();
  if (!bytes || (inputMode.value === 'text' && !textInput.value) || (inputMode.value === 'file' && !fileBytes.value)) {
    store.showToast(t('tools.hash_tool.empty_input_warning'), { type: 'warning' });
    return;
  }

  isBusy.value = true;
  try {
    digests.value = await digestAll(bytes, selectedAlgorithms.value);
    store.showToast(t('tools.hash_tool.compute_success'), { type: 'success' });
  } catch (error) {
    digests.value = {};
    const message =
      error instanceof Error && /Web Crypto/i.test(error.message)
        ? t('tools.hash_tool.crypto_unavailable')
        : error instanceof Error
          ? error.message
          : t('tools.hash_tool.crypto_unavailable');
    store.showToast(message, { type: 'error' });
  } finally {
    isBusy.value = false;
  }
};

const copyOne = async (value: string) => {
  if (!value) {
    store.showToast(t('tools.hash_tool.empty_output_warning'), { type: 'warning' });
    return;
  }

  try {
    await copyToClipboard(value);
    store.showToast(t('tools.hash_tool.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.hash_tool.copy_failed'), { type: 'error' });
  }
};

const copyAll = async () => {
  const lines = resultRows.value
    .filter((row) => row.display)
    .map((row) => `${row.algorithm}: ${row.display}`);

  if (!lines.length) {
    store.showToast(t('tools.hash_tool.empty_output_warning'), { type: 'warning' });
    return;
  }

  try {
    await copyToClipboard(lines.join('\n'));
    store.showToast(t('tools.hash_tool.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.hash_tool.copy_failed'), { type: 'error' });
  }
};

const matchLabel = (state: 'ok' | 'fail' | 'skip') => {
  if (state === 'ok') {
    return t('tools.hash_tool.match_ok');
  }
  if (state === 'fail') {
    return t('tools.hash_tool.match_fail');
  }
  return t('tools.hash_tool.match_skip');
};

watch(
  () => props.initialData,
  (value) => {
    if (!value) {
      return;
    }
    // 若像期望摘要，预填期望值；否则作为文本输入
    const normalized = value.replace(/\s+/g, '');
    if (/^[0-9a-fA-F]+$/.test(normalized) && [32, 40, 64, 128].includes(normalized.length)) {
      expectedValue.value = value.trim();
    } else {
      inputMode.value = 'text';
      textInput.value = value;
    }
  },
  { immediate: true },
);

watch(inputMode, () => {
  clearResults();
});

watch(algorithmSelection, () => {
  if (hasAnyResult.value) {
    void compute();
  }
});
</script>

<template>
  <div class="h-full flex flex-col gap-4 p-4 bg-background text-foreground min-h-0 overflow-auto">
    <div
      ref="containerRef"
      class="grid grid-cols-1 xl:grid-cols-[minmax(300px,var(--panel-first-width,380px))_minmax(360px,1fr)] gap-4 min-h-0"
      :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }"
    >
      <section ref="firstPanelRef" class="relative border border-border rounded-md bg-card p-4 flex flex-col gap-4">
        <div>
          <div class="text-lg font-semibold">{{ t('tools.hash_tool.title') }}</div>
          <div class="text-sm text-muted-foreground mt-1">{{ t('tools.hash_tool.subtitle') }}</div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground">{{ t('tools.hash_tool.input_mode') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="hash-mode-text"
              class="px-4 py-2 rounded-md border transition-colors"
              :class="inputMode === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
              @click="inputMode = 'text'"
            >
              {{ t('tools.hash_tool.mode_text') }}
            </button>
            <button
              type="button"
              data-testid="hash-mode-file"
              class="px-4 py-2 rounded-md border transition-colors"
              :class="inputMode === 'file' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
              @click="inputMode = 'file'"
            >
              {{ t('tools.hash_tool.mode_file') }}
            </button>
          </div>
        </div>

        <div v-if="inputMode === 'text'" class="flex flex-col gap-2 min-h-0">
          <textarea
            v-model="textInput"
            data-testid="hash-text-input"
            class="w-full min-h-[180px] resize-y rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
            :placeholder="t('tools.hash_tool.text_placeholder')"
          />
        </div>

        <div v-else class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground" for="hash-file-input">{{ t('tools.hash_tool.file_label') }}</label>
          <input
            id="hash-file-input"
            data-testid="hash-file-input"
            type="file"
            class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            @change="onFileChange"
          />
          <div class="text-xs text-muted-foreground">
            <template v-if="fileName">
              {{ t('tools.hash_tool.file_selected', { name: fileName, size: formatFileSize(fileSize) }) }}
            </template>
            <template v-else>
              {{ t('tools.hash_tool.file_empty') }}
            </template>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground">{{ t('tools.hash_tool.algorithms') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in algorithmOptions"
              :key="option.value"
              type="button"
              :data-testid="`hash-algo-${option.value}`"
              class="px-3 py-1.5 rounded-md border text-sm transition-colors"
              :class="algorithmSelection === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
              @click="algorithmSelection = option.value"
            >
              {{ option.value === 'all' ? t('tools.hash_tool.algorithm_all') : option.label }}
            </button>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
          <input v-model="uppercase" data-testid="hash-uppercase" type="checkbox" class="h-4 w-4 accent-primary" />
          {{ t('tools.hash_tool.uppercase') }}
        </label>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground" for="hash-expected">{{ t('tools.hash_tool.expected') }}</label>
          <input
            id="hash-expected"
            v-model="expectedValue"
            data-testid="hash-expected-input"
            type="text"
            class="px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
            :placeholder="t('tools.hash_tool.expected_placeholder')"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="hash-compute-button"
            class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="isBusy"
            @click="compute"
          >
            {{ isBusy ? t('tools.hash_tool.busy') : t('tools.hash_tool.compute') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors"
            @click="clearAll"
          >
            {{ t('tools.hash_tool.clear') }}
          </button>
        </div>

        <div
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.hash_tool.resize_aria')"
          aria-orientation="vertical"
          tabindex="0"
          @pointerdown.prevent="startResize"
          @keydown="handleResizeKeydown"
        />
      </section>

      <section class="border border-border rounded-md bg-card p-4 flex flex-col gap-3 min-h-[420px]">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="text-sm font-medium">{{ t('tools.hash_tool.result_title') }}</div>
          <button
            type="button"
            data-testid="hash-copy-all"
            class="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition-colors"
            @click="copyAll"
          >
            {{ t('tools.hash_tool.copy_all') }}
          </button>
        </div>

        <div v-if="!hasAnyResult" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {{ t('tools.hash_tool.result_empty') }}
        </div>

        <div v-else class="flex flex-col gap-3">
          <div
            v-for="row in resultRows"
            :key="row.algorithm"
            class="rounded-md border border-border bg-background p-3 flex flex-col gap-2"
            :data-testid="`hash-result-${row.algorithm}`"
          >
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="text-sm font-semibold">{{ row.algorithm }}</div>
              <div class="flex items-center gap-2">
                <span
                  class="text-xs px-2 py-0.5 rounded-full border"
                  :class="{
                    'border-emerald-500/40 text-emerald-600 dark:text-emerald-300': row.matchState === 'ok',
                    'border-rose-500/40 text-rose-600 dark:text-rose-300': row.matchState === 'fail',
                    'border-border text-muted-foreground': row.matchState === 'skip',
                  }"
                >
                  {{ matchLabel(row.matchState) }}
                </span>
                <button
                  type="button"
                  class="px-2 py-1 rounded-md border border-border text-xs hover:bg-muted"
                  @click="copyOne(row.display)"
                >
                  {{ t('tools.hash_tool.copy') }}
                </button>
              </div>
            </div>
            <div class="font-mono text-sm break-all select-all">
              {{ row.display || '—' }}
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
