<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { useAppStore } from '@/store/app';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { formatUuidBatch, generateUuidBatch, type UuidVersion } from './index';

const { t } = useI18n();
const store = useAppStore();

const version = ref<UuidVersion>('v4');
const count = ref(10);
const uppercase = ref(false);
const removeHyphen = ref(false);
const autoCopy = ref(true);
const outputText = ref('');
const generatedCount = ref(0);
const rawItems = ref<string[]>([]);
const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } = useResizablePanel({ minFirstWidth: 300, minSecondWidth: 420 });

const versionOptions: Array<{ value: UuidVersion; label: string }> = [
  { value: 'v1', label: 'UUID v1' },
  { value: 'v4', label: 'UUID v4' },
  { value: 'v7', label: 'UUID v7' },
];

const countValue = computed({
  get: () => count.value,
  set: (value: number | string) => {
    const nextValue = Number(value);
    if (Number.isNaN(nextValue)) {
      count.value = 1;
      return;
    }
    count.value = Math.max(1, Math.min(500, Math.floor(nextValue)));
  },
});

/**
 * 将文本写入系统剪贴板，优先复用 Tauri 能力。
 * @param text 待复制文本
 */
const copyToClipboard = async (text: string) => {
  if (!(await copyText(text))) throw new Error('clipboard-unavailable');
};

/**
 * 执行 UUID 生成，并在需要时自动复制结果。
 * @param options 是否静默执行
 */
const generate = async (options?: { silent?: boolean }) => {
  rawItems.value = generateUuidBatch({
    version: version.value,
    count: countValue.value,
  });

  generatedCount.value = rawItems.value.length;
  outputText.value = formatUuidBatch(rawItems.value, {
    uppercase: uppercase.value,
    removeHyphen: removeHyphen.value,
  });

  if (options?.silent) {
    return;
  }

  if (!autoCopy.value) {
    store.showToast(t('tools.uuid_generator.generated', { count: generatedCount.value }), { type: 'success' });
    return;
  }

  try {
    await copyToClipboard(outputText.value);
    store.showToast(t('tools.uuid_generator.generated_and_copied', { count: generatedCount.value }), { type: 'success' });
  } catch {
    store.showToast(t('tools.uuid_generator.generated_but_copy_failed', { count: generatedCount.value }), { type: 'warning' });
  }
};

/**
 * 复制当前结果。
 */
const copyResult = async () => {
  if (!outputText.value.trim()) {
    store.showToast(t('tools.uuid_generator.empty_output_warning'), { type: 'warning' });
    return;
  }

  try {
    await copyToClipboard(outputText.value);
    store.showToast(t('tools.uuid_generator.copy_success'), { type: 'success' });
  } catch {
    store.showToast(t('tools.uuid_generator.copy_failed'), { type: 'error' });
  }
};

/**
 * 清空当前结果并恢复默认数量。
 */
const clearAll = () => {
  outputText.value = '';
  generatedCount.value = 0;
  rawItems.value = [];
  count.value = 10;
};

watch([uppercase, removeHyphen], () => {
  if (!outputText.value.trim()) {
    return;
  }

  outputText.value = formatUuidBatch(rawItems.value, {
    uppercase: uppercase.value,
    removeHyphen: removeHyphen.value,
  });
});

onMounted(() => {
  void generate({ silent: true });
});
</script>

<template>
  <div class="h-full flex flex-col gap-4 p-4 bg-background text-foreground min-h-0 overflow-auto">
    <div ref="containerRef" class="grid grid-cols-1 xl:grid-cols-[minmax(300px,var(--panel-first-width,360px))_minmax(420px,1fr)] gap-4 min-h-0" :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }">
      <section ref="firstPanelRef" class="relative border border-border rounded-md bg-card p-4 flex flex-col gap-4">
        <div>
          <div class="text-lg font-semibold">{{ t('tools.uuid_generator.title') }}</div>
          <div class="text-sm text-muted-foreground mt-1">{{ t('tools.uuid_generator.subtitle') }}</div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground">{{ t('tools.uuid_generator.version') }}</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in versionOptions"
              :key="option.value"
              :data-testid="`uuid-version-${option.value}`"
              class="px-4 py-2 rounded-md border transition-colors"
              :class="version === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
              @click="version = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label for="uuid-count" class="text-sm text-muted-foreground">{{ t('tools.uuid_generator.count') }}</label>
          <input
            id="uuid-count"
            v-model="countValue"
            data-testid="uuid-count-input"
            type="number"
            min="1"
            max="500"
            class="px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <div class="text-xs text-muted-foreground">{{ t('tools.uuid_generator.count_hint') }}</div>
        </div>

        <div class="flex flex-col gap-3">
          <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input v-model="uppercase" type="checkbox" class="h-4 w-4 accent-primary" />
            {{ t('tools.uuid_generator.uppercase') }}
          </label>
          <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input v-model="removeHyphen" type="checkbox" class="h-4 w-4 accent-primary" />
            {{ t('tools.uuid_generator.remove_hyphen') }}
          </label>
          <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
            <input v-model="autoCopy" type="checkbox" class="h-4 w-4 accent-primary" />
            {{ t('tools.uuid_generator.auto_copy') }}
          </label>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button data-testid="uuid-generate-button" class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="generate()">
            {{ t('tools.uuid_generator.generate') }}
          </button>
          <button class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="copyResult">
            {{ t('tools.uuid_generator.copy_result') }}
          </button>
          <button class="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors" @click="clearAll">
            {{ t('tools.uuid_generator.clear') }}
          </button>
        </div>
        <div class="resizable-panel-divider" role="separator" :aria-label="t('tools.uuid_generator.resize_aria')" aria-orientation="vertical" tabindex="0" @pointerdown.prevent="startResize" @keydown="handleResizeKeydown"></div>
      </section>

      <section class="border border-border rounded-md bg-card p-4 flex flex-col gap-3 min-h-[420px]">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="text-sm font-medium">{{ t('tools.uuid_generator.output_title') }}</div>
          <div class="text-xs text-muted-foreground">{{ t('tools.uuid_generator.stats', { count: generatedCount }) }}</div>
        </div>
        <textarea
          v-model="outputText"
          data-testid="uuid-output-textarea"
          readonly
          class="flex-1 w-full min-h-[360px] resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none"
          :placeholder="t('tools.uuid_generator.output_placeholder')"
        />
      </section>
    </div>
  </div>
</template>
