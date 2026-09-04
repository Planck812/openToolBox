<script setup lang="ts">
import { Copy, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

defineProps<{
  state: 'idle' | 'loading' | 'error' | 'done';
  result: string;
  error: string;
  copied: boolean;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="overlay-ocr-panel" @mousedown.stop>
    <div class="overlay-ocr-header">
      <span>{{ t('overlay.ocr.title') }}</span>
      <button class="overlay-ocr-close" @click.stop="emit('close')">
        <X class="w-4 h-4" />
      </button>
    </div>
    <div v-if="state === 'loading'" class="overlay-ocr-body">
      <span>{{ t('overlay.ocr.recognizing') }}</span>
    </div>
    <div v-else-if="state === 'error'" class="overlay-ocr-body">
      <span class="overlay-ocr-error">{{ error || t('overlay.ocr.recognition_failed') }}</span>
    </div>
    <template v-else-if="result">
      <textarea :value="result" readonly class="overlay-ocr-text" spellcheck="false" />
      <div class="overlay-ocr-actions">
        <button class="overlay-ocr-copy" @click.stop="emit('copy')">
          <Copy class="w-4 h-4" />
          <span>{{ copied ? t('overlay.ocr.copied') : t('overlay.ocr.copy') }}</span>
        </button>
      </div>
    </template>
    <div v-else class="overlay-ocr-body">
      <span>{{ t('overlay.ocr.no_text') }}</span>
    </div>
  </div>
</template>

<style scoped>
.overlay-ocr-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 40;
  width: 420px;
  max-width: 90vw;
  background: rgba(17, 24, 39, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  padding: 12px;
}
.overlay-ocr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}
.overlay-ocr-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  padding: 2px;
}
.overlay-ocr-close:hover {
  color: #fff;
}
.overlay-ocr-body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
}
.overlay-ocr-error {
  color: #ff6b6b;
}
.overlay-ocr-text {
  width: 100%;
  min-height: 160px;
  max-height: 320px;
  resize: none;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  padding: 10px;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
}
.overlay-ocr-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
.overlay-ocr-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: auto;
  height: auto;
  white-space: nowrap;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}
.overlay-ocr-copy:hover {
  background: rgba(255, 255, 255, 0.28);
}
</style>
