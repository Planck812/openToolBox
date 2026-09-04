<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { copyText } from '@/lib/clipboard';
import { useResizablePanel } from '@/lib/use-resizable-panel';
import { AES_ERROR_I18N_KEY, aesDecrypt, aesEncrypt, looksLikeAesCipher } from './aes';
import { Copy, Play, Trash2 } from 'lucide-vue-next';

interface Props {
  initialData?: string;
}

type AesMode = 'encrypt' | 'decrypt';

const props = defineProps<Props>();
const { t } = useI18n();
const store = useAppStore();

const mode = ref<AesMode>('encrypt');
const inputText = ref('');
const password = ref('');
const outputText = ref('');
const autoCopy = ref(true);
const isBusy = ref(false);

const { containerRef, firstPanelRef, firstPanelWidth, startResize, handleResizeKeydown } =
  useResizablePanel({ minFirstWidth: 300, minSecondWidth: 320 });

const inputTitle = computed(() =>
  mode.value === 'encrypt' ? t('tools.aes_tool.input_plain_title') : t('tools.aes_tool.input_cipher_title'),
);

const runButtonText = computed(() =>
  mode.value === 'encrypt' ? t('tools.aes_tool.run_encrypt') : t('tools.aes_tool.run_decrypt'),
);

const resolveError = (error: unknown): string => {
  if (error instanceof Error && AES_ERROR_I18N_KEY[error.message]) {
    return t(AES_ERROR_I18N_KEY[error.message]);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return t('tools.aes_tool.operation_failed');
};

const handleRun = async () => {
  if (!inputText.value) {
    store.showToast(t('tools.aes_tool.empty_input_warning'), { type: 'warning' });
    return;
  }
  if (!password.value) {
    store.showToast(t('tools.aes_tool.empty_password_warning'), { type: 'warning' });
    return;
  }

  isBusy.value = true;
  try {
    const result =
      mode.value === 'encrypt'
        ? await aesEncrypt(inputText.value, password.value)
        : await aesDecrypt(inputText.value, password.value);
    outputText.value = result;

    if (autoCopy.value) {
      const success = await copyText(result);
      if (success) {
        store.showToast(t('tools.aes_tool.success_and_copied'), { type: 'success' });
      } else {
        store.showToast(t('tools.aes_tool.success_but_copy_failed'), { type: 'warning' });
      }
    } else {
      store.showToast(t('tools.aes_tool.operation_success'), { type: 'success' });
    }
  } catch (error) {
    store.showToast(resolveError(error), { type: 'error' });
  } finally {
    isBusy.value = false;
  }
};

const handleCopy = async () => {
  if (!outputText.value) {
    store.showToast(t('tools.aes_tool.empty_output_warning'), { type: 'warning' });
    return;
  }
  const success = await copyText(outputText.value);
  if (success) {
    store.showToast(t('tools.aes_tool.copy_success'), { type: 'success' });
  } else {
    store.showToast(t('tools.aes_tool.copy_failed'), { type: 'error' });
  }
};

const clearAll = () => {
  inputText.value = '';
  password.value = '';
  outputText.value = '';
  store.showToast(t('tools.aes_tool.cleared'), { type: 'success' });
};

// 模式切换时清空旧结果，避免残留误导
watch(mode, () => {
  outputText.value = '';
});

// 从首页搜索预填：密文自动切到解密模式，否则当作明文进入加密模式
watch(
  () => props.initialData,
  (value) => {
    if (!value) {
      return;
    }
    const incoming = typeof value === 'string' ? value : (value as { value?: string } | undefined)?.value ?? '';
    if (looksLikeAesCipher(incoming)) {
      mode.value = 'decrypt';
      inputText.value = incoming.trim();
    } else {
      mode.value = 'encrypt';
      inputText.value = incoming;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="h-full flex flex-col gap-4 p-4 bg-background text-foreground min-h-0 overflow-auto">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="text-lg font-semibold">{{ t('tools.aes_tool.title') }}</div>
        <div class="text-sm text-muted-foreground mt-1">{{ t('tools.aes_tool.subtitle') }}</div>
      </div>

      <div class="flex gap-2" role="group" :aria-label="t('tools.aes_tool.title')">
        <button
          type="button"
          data-testid="aes-mode-encrypt"
          class="px-4 py-2 rounded-md border transition-colors"
          :class="mode === 'encrypt' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
          @click="mode = 'encrypt'"
        >
          {{ t('tools.aes_tool.mode_encrypt') }}
        </button>
        <button
          type="button"
          data-testid="aes-mode-decrypt"
          class="px-4 py-2 rounded-md border transition-colors"
          :class="mode === 'decrypt' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'"
          @click="mode = 'decrypt'"
        >
          {{ t('tools.aes_tool.mode_decrypt') }}
        </button>
      </div>
    </div>

    <div
      ref="containerRef"
      class="grid grid-cols-1 xl:grid-cols-[minmax(300px,var(--panel-first-width,380px))_minmax(320px,1fr)] gap-4 min-h-0"
      :style="{ '--panel-first-width': firstPanelWidth === null ? undefined : `${firstPanelWidth}px` }"
    >
      <section ref="firstPanelRef" class="relative border border-border rounded-md bg-card p-4 flex flex-col gap-4 min-h-[420px]">
        <div class="flex flex-col gap-2 min-h-0 flex-1">
          <div class="flex items-center justify-between">
            <label class="text-sm text-muted-foreground" for="aes-input">{{ inputTitle }}</label>
            <span class="text-xs text-muted-foreground">{{ inputText.length }} chars</span>
          </div>
          <textarea
            id="aes-input"
            v-model="inputText"
            data-testid="aes-input"
            class="w-full flex-1 min-h-[180px] resize-none rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
            :placeholder="t('tools.aes_tool.input_placeholder')"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-muted-foreground" for="aes-password">{{ t('tools.aes_tool.password_label') }}</label>
          <input
            id="aes-password"
            v-model="password"
            data-testid="aes-password"
            type="password"
            autocomplete="off"
            class="px-3 py-2 rounded-md border border-border bg-background font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
            :placeholder="t('tools.aes_tool.password_placeholder')"
          />
          <p class="text-xs text-muted-foreground">{{ t('tools.aes_tool.password_hint') }}</p>
        </div>

        <label class="flex items-center gap-2 text-sm text-muted-foreground select-none">
          <input v-model="autoCopy" data-testid="aes-auto-copy" type="checkbox" class="h-4 w-4 accent-primary" />
          {{ t('tools.aes_tool.auto_copy') }}
        </label>

        <div class="grid grid-cols-1 gap-2">
          <button
            type="button"
            data-testid="aes-run-button"
            class="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium shadow-sm disabled:opacity-50"
            :disabled="isBusy"
            @click="handleRun"
          >
            <Play class="w-4 h-4" />
            {{ runButtonText }}
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="aes-copy-button"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors border border-transparent"
              @click="handleCopy"
            >
              <Copy class="w-4 h-4" />
              {{ t('tools.aes_tool.copy_btn') }}
            </button>
            <button
              type="button"
              data-testid="aes-clear-button"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20 transition-colors border border-transparent"
              @click="clearAll"
            >
              <Trash2 class="w-4 h-4" />
              {{ t('tools.aes_tool.clear_btn') }}
            </button>
          </div>
        </div>

        <p class="text-xs text-muted-foreground">{{ t('tools.aes_tool.format_hint') }}</p>

        <div
          class="resizable-panel-divider"
          role="separator"
          :aria-label="t('tools.aes_tool.resize_aria')"
          aria-orientation="vertical"
          tabindex="0"
          @pointerdown.prevent="startResize"
          @keydown="handleResizeKeydown"
        />
      </section>

      <section class="border border-border rounded-md bg-card p-4 flex flex-col gap-3 min-h-[420px]">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="text-sm font-medium">{{ t('tools.aes_tool.output_title') }}</div>
          <span class="text-xs text-muted-foreground">{{ outputText.length }} chars</span>
        </div>
        <textarea
          v-model="outputText"
          data-testid="aes-output"
          readonly
          class="w-full flex-1 min-h-[300px] resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          :placeholder="t('tools.aes_tool.output_placeholder')"
        />
      </section>
    </div>
  </div>
</template>
