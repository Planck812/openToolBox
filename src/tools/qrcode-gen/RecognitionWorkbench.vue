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
      class="recognition-upload-card border border-border rounded-md bg-card p-4 flex flex-col gap-3"
    >
      <div class="text-sm font-medium tracking-[0.01em]">{{ t('tools.qrcode_gen.recognition_title') }}</div>
      <div class="text-sm text-muted-foreground">{{ t('tools.qrcode_gen.recognition_description') }}</div>

      <div class="recognition-dropzone rounded-lg border border-dashed border-primary/35 bg-primary/5 p-6 flex flex-col items-center justify-center gap-3 text-center">
        <div class="text-sm font-medium tracking-[0.01em]">{{ t('tools.qrcode_gen.paste_or_upload') }}</div>
        <div class="text-xs text-muted-foreground max-w-md">
          {{ t('tools.qrcode_gen.paste_tip') }}
        </div>
        <button
          class="recognition-upload-button inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-background hover:bg-muted transition-colors text-sm"
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
      class="recognition-preview-card min-h-0 min-w-0 border border-border rounded-2xl bg-card/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]"
    >
      <div class="min-h-0 min-w-0 flex flex-col gap-3">
        <div class="recognition-preview-toolbar flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="recognition-preview-title text-sm font-medium tracking-[0.01em]">{{ t('tools.qrcode_gen.image_preview_title') }}</div>
            <div class="text-xs text-muted-foreground">
              {{ recognitionResult?.formatLabel || t('tools.qrcode_gen.recognition_result_placeholder') }}
            </div>
          </div>
          <button
            class="recognition-copy-chip shrink-0"
            :disabled="!recognitionResult?.text"
            @click="emit('copy-result')"
          >
            {{ t('tools.qrcode_gen.copy_result_btn') }}
          </button>
        </div>
        <div
          data-testid="recognition-preview-panel"
          class="recognition-preview-stage min-h-[420px] max-h-[clamp(420px,62vh,680px)] flex items-center justify-center overflow-hidden relative px-10 py-12"
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
              class="recognition-preview-image max-w-full max-h-full object-contain"
              alt="Recognition Source"
            />
            <div
              v-if="recognitionResult && !recognitionError"
              data-testid="recognition-result-panel"
              class="min-h-[32px]"
            >
              <div
                data-testid="recognition-text-badge"
                class="text-[clamp(1.15rem,1.6vw,1.45rem)] font-semibold leading-[1.1] tracking-[0.01em] break-all text-foreground text-center"
              >
                {{ recognitionResult.text }}
              </div>
            </div>
          </div>

          <div
            v-if="recognitionError"
            class="absolute inset-x-4 bottom-4 rounded-2xl border border-destructive/25 bg-background/96 px-4 py-3 text-sm text-destructive shadow-[0_12px_28px_rgba(15,23,42,0.14)] backdrop-blur-sm"
          >
            {{ recognitionError }}
          </div>

          <div v-if="isRecognizing" class="absolute inset-0 bg-background/45 flex items-center justify-center">
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

.recognition-upload-card,
.recognition-preview-card {
  border-radius: 1.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 18px 45px rgba(15, 23, 42, 0.06);
}

.recognition-upload-card {
  padding: 1.25rem;
}

.recognition-dropzone {
  min-height: 14.5rem;
  border-color: rgba(148, 163, 184, 0.55);
  background:
    linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.94)),
    radial-gradient(circle at top, rgba(59, 130, 246, 0.06), transparent 38%);
}

.recognition-upload-button {
  border-radius: 999px;
  padding-inline: 1.2rem;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.recognition-preview-title {
  letter-spacing: 0.02em;
}

.recognition-preview-toolbar {
  padding: 0.15rem 0.2rem 0;
}

.recognition-preview-stage {
  border: 1px dashed hsl(var(--border));
  border-radius: 1.8rem;
  background:
    radial-gradient(circle at 50% 6%, rgba(59, 130, 246, 0.1), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(244, 247, 251, 0.96));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    0 22px 54px rgba(15, 23, 42, 0.07);
}

.recognition-preview-stage::before {
  content: '';
  position: absolute;
  inset: 0.9rem;
  border-radius: 1.25rem;
  border: 1px solid rgba(226, 232, 240, 0.75);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0)),
    repeating-linear-gradient(
      0deg,
      rgba(226, 232, 240, 0.16) 0,
      rgba(226, 232, 240, 0.16) 1px,
      transparent 1px,
      transparent 28px
    );
  pointer-events: none;
}

.recognition-preview-stage > * {
  position: relative;
  z-index: 1;
}

.recognition-preview-image {
  max-width: 66%;
  max-height: 66%;
  filter: drop-shadow(0 16px 30px rgba(15, 23, 42, 0.08));
}

.recognition-preview-stack {
  max-width: 100%;
}

.recognition-copy-chip {
  border: 1px solid rgba(226, 232, 240, 0.82);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(12px);
}

.recognition-copy-chip {
  border-radius: 999px;
  padding: 0.78rem 1.18rem;
  font-size: 0.9rem;
  font-weight: 600;
  transition: background-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.recognition-copy-chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.95);
  transform: translateY(-1px);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.11);
}
</style>
