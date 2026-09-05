<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RefreshCw, Upload } from 'lucide-vue-next';
import type { RecognitionResult } from './runtime';

defineProps<{
  recognitionPreviewUrl: string;
  recognitionFileName: string;
  recognitionResult: RecognitionResult | null;
  recognitionError: string;
  isRecognizing: boolean;
}>();

const emit = defineEmits<{
  (e: 'file-change', event: Event): void;
  (e: 'copy-result'): void;
}>();

const { t } = useI18n();

const fileInputRef = ref<HTMLInputElement | null>(null);

const openFilePicker = () => {
  fileInputRef.value?.click();
};

const clearInput = () => {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
};

defineExpose({ clearInput });
</script>

<template>
  <div
    data-testid="recognition-layout"
    class="recognition-workbench grid min-h-full min-w-0 grid-cols-2 items-start gap-4"
  >
    <div
      data-testid="recognition-upload-panel"
      class="recognition-upload-card border border-border rounded-2xl bg-card p-5 flex flex-col gap-4 shadow-sm"
    >
      <div class="text-sm font-medium tracking-[0.01em] text-foreground">{{ t('tools.qrcode_gen.recognition_title') }}</div>
      <div class="text-sm text-muted-foreground">{{ t('tools.qrcode_gen.recognition_description') }}</div>

      <div class="recognition-dropzone rounded-xl border-2 border-dashed border-border/80 bg-muted/20 hover:bg-muted/30 p-8 flex flex-col items-center justify-center gap-3 text-center transition-colors">
        <div class="text-sm font-medium tracking-[0.01em] text-foreground">{{ t('tools.qrcode_gen.paste_or_upload') }}</div>
        <div class="text-xs text-muted-foreground max-w-md">
          {{ t('tools.qrcode_gen.paste_tip') }}
        </div>
        <button
          type="button"
          class="recognition-upload-button inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors text-sm shadow-sm"
          @click="openFilePicker"
        >
          <Upload class="w-4 h-4" />
          {{ t('tools.qrcode_gen.upload_btn') }}
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="(e: Event) => emit('file-change', e)"
        />
      </div>

      <div class="text-xs text-muted-foreground">{{ t('tools.qrcode_gen.recognition_formats_hint') }}</div>
      <div v-if="recognitionFileName" class="truncate text-xs text-muted-foreground" :title="recognitionFileName">
        {{ t('tools.qrcode_gen.current_image', { name: recognitionFileName }) }}
      </div>
    </div>

    <div
      data-testid="recognition-merged-panel"
      class="recognition-preview-card min-h-0 min-w-0 border border-border rounded-2xl bg-card/95 p-5 shadow-sm"
    >
      <div class="min-h-0 min-w-0 flex flex-col gap-3">
        <div class="recognition-preview-toolbar flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="recognition-preview-title text-sm font-medium tracking-[0.01em] text-foreground">{{ t('tools.qrcode_gen.image_preview_title') }}</div>
            <div class="text-xs text-muted-foreground">
              {{ recognitionResult?.formatLabel || t('tools.qrcode_gen.recognition_result_placeholder') }}
            </div>
          </div>
          <button
            type="button"
            class="recognition-copy-chip shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            :disabled="!recognitionResult?.text"
            @click="emit('copy-result')"
          >
            {{ t('tools.qrcode_gen.copy_result_btn') }}
          </button>
        </div>
        <div
          data-testid="recognition-preview-panel"
          class="recognition-preview-stage min-h-[420px] max-h-[clamp(420px,62vh,680px)] rounded-xl border border-dashed border-border bg-muted/15 flex items-center justify-center overflow-hidden relative px-10 py-12"
        >
          <div v-if="!recognitionPreviewUrl" class="text-sm text-muted-foreground text-center px-4">
            {{ t('tools.qrcode_gen.recognition_preview_placeholder') }}
          </div>
          <div
            v-else
            class="recognition-preview-stack flex flex-col items-center justify-center gap-5"
          >
            <img
              :src="recognitionPreviewUrl"
              class="recognition-preview-image max-w-full max-h-full object-contain rounded-lg"
              alt="Recognition Source"
            />
            <div
              v-if="recognitionResult && !recognitionError"
              data-testid="recognition-result-panel"
              class="min-h-[32px]"
            >
              <div
                data-testid="recognition-text-badge"
                class="text-[clamp(1.15rem,1.6vw,1.45rem)] font-semibold leading-[1.1] tracking-[0.01em] break-all text-foreground text-center select-text"
              >
                {{ recognitionResult.text }}
              </div>
            </div>
          </div>

          <div
            v-if="recognitionError"
            class="absolute inset-x-4 bottom-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm backdrop-blur-sm"
          >
            {{ recognitionError }}
          </div>

          <div v-if="isRecognizing" class="absolute inset-0 bg-background/50 flex items-center justify-center backdrop-blur-[1px]">
            <RefreshCw class="w-6 h-6 animate-spin text-primary" />
          </div>
        </div>

        <div
          v-if="!recognitionResult && !recognitionError"
          data-testid="recognition-result-panel"
          class="min-h-[32px] px-1 pt-1 text-sm text-muted-foreground"
        >
          {{ t('tools.qrcode_gen.recognition_result_placeholder') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recognition-workbench {
  align-items: stretch;
}

.recognition-dropzone {
  min-height: 14.5rem;
}

.recognition-preview-title {
  letter-spacing: 0.02em;
}

.recognition-preview-toolbar {
  padding: 0.15rem 0.2rem 0;
}

.recognition-preview-image {
  max-width: 66%;
  max-height: 66%;
  filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.12));
}

.recognition-preview-stack {
  max-width: 100%;
}
</style>
