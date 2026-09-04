<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { formatGlobalShortcutFromKeyboardEvent } from '@/lib/shortcut';
import { loadPipelines, type SavedPipeline } from '@/tools/text-processor/pipeline-store';

/** 预设 op（单步管线），复用 text_processor.type_<op> 文案 */
const PRESET_OPS = ['remove_escape', 'url_decode', 'utf8_decode', 'base64_decode'];

const { t } = useI18n();
const store = useAppStore();
const { pipelineShortcuts } = storeToRefs(store);
const savedPipelines = ref<SavedPipeline[]>([]);

onMounted(() => {
  savedPipelines.value = loadPipelines();
});

const currentShortcut = (target: string) => pipelineShortcuts.value[target] || '';

const handleRecorderKeydown = (e: KeyboardEvent, target: string) => {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    store.clearPipelineShortcut(target);
    return;
  }
  if (e.key === 'Escape') {
    (e.target as HTMLInputElement | null)?.blur?.();
    return;
  }
  const shortcut = formatGlobalShortcutFromKeyboardEvent(e);
  if (!shortcut) return;
  store.setPipelineShortcut(target, shortcut);
  (e.target as HTMLInputElement | null)?.blur?.();
};
</script>

<template>
  <div>
    <div class="settings-section-title">{{ t('common.pipeline_shortcuts_label') }}</div>
    <div class="settings-section-hint">{{ t('common.pipeline_shortcuts_help') }}</div>

    <div class="settings-sub-title">{{ t('common.pipeline_shortcuts_preset_title') }}</div>
    <ul class="tool-shortcut-list">
      <li v-for="op in PRESET_OPS" :key="'preset:' + op" class="tool-shortcut-row">
        <div class="flex-1 min-w-0">
          <div class="tool-shortcut-name">{{ t('tools.text_processor.type_' + op) }}</div>
        </div>
        <input
          :value="currentShortcut('preset:' + op)"
          :placeholder="t('common.tool_shortcuts_placeholder')"
          readonly
          class="settings-input font-mono tool-shortcut-input"
          @keydown.prevent="handleRecorderKeydown($event, 'preset:' + op)"
        />
        <button
          type="button"
          class="settings-btn"
          :disabled="!currentShortcut('preset:' + op)"
          :class="{ 'is-disabled': !currentShortcut('preset:' + op) }"
          @click="store.clearPipelineShortcut('preset:' + op)"
        >
          {{ t('common.tool_shortcuts_clear') }}
        </button>
      </li>
    </ul>

    <div class="settings-sub-title">{{ t('common.pipeline_shortcuts_user_title') }}</div>
    <ul v-if="savedPipelines.length" class="tool-shortcut-list">
      <li v-for="p in savedPipelines" :key="p.name" class="tool-shortcut-row">
        <div class="flex-1 min-w-0">
          <div class="tool-shortcut-name">{{ p.name }}</div>
        </div>
        <input
          :value="currentShortcut(p.name)"
          :placeholder="t('common.tool_shortcuts_placeholder')"
          readonly
          class="settings-input font-mono tool-shortcut-input"
          @keydown.prevent="handleRecorderKeydown($event, p.name)"
        />
        <button
          type="button"
          class="settings-btn"
          :disabled="!currentShortcut(p.name)"
          :class="{ 'is-disabled': !currentShortcut(p.name) }"
          @click="store.clearPipelineShortcut(p.name)"
        >
          {{ t('common.tool_shortcuts_clear') }}
        </button>
      </li>
    </ul>
    <div v-else class="settings-section-hint">{{ t('common.pipeline_shortcuts_empty') }}</div>
  </div>
</template>

<style scoped>
.tool-shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.tool-shortcut-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
}

.tool-shortcut-name {
  color: var(--skin-text-main);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-shortcut-input {
  width: 180px;
  flex-shrink: 0;
}

.settings-section-title {
  color: var(--skin-text-strong);
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  position: relative;
  padding-left: 14px;
}

.settings-section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--skin-accent), var(--skin-accent-2));
  box-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.5);
}

.settings-section-hint,
.settings-sub-title {
  color: var(--skin-text-muted);
  font-size: 12px;
  margin-bottom: 8px;
}

.settings-sub-title {
  font-weight: 700;
  color: var(--skin-text-main);
  margin-top: 4px;
}

.settings-btn {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-main);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.settings-btn:hover:not(.is-disabled) {
  border-color: var(--skin-accent);
  color: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.15);
}

.settings-btn.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}

.settings-input {
  width: 260px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--skin-border);
  background: var(--skin-panel-bg);
  color: var(--skin-text-strong);
  font-size: 12px;
  outline: none;
  transition: all 0.2s ease;
}

.settings-input:focus {
  border-color: var(--skin-accent);
  box-shadow: 0 0 0 3px rgba(var(--skin-accent-rgb) / 0.12), 0 0 16px rgba(var(--skin-accent-rgb) / 0.1);
}
</style>
