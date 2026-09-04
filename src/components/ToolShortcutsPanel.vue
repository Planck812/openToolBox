<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { tools as toolList } from '@/tools/registry';
import { formatGlobalShortcutFromKeyboardEvent } from '@/lib/shortcut';

const { t } = useI18n();
const store = useAppStore();
const { toolShortcuts } = storeToRefs(store);

const currentShortcut = (toolId: string) => toolShortcuts.value[toolId] || '';

/**
 * 录制输入：按下组合键即刻写入 store（经 App.vue watch 同步到后端）；Backspace/Del 清除。
 * @param e 键盘事件
 * @param toolId 工具 id
 */
const handleRecorderKeydown = (e: KeyboardEvent, toolId: string) => {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    store.clearToolShortcut(toolId);
    return;
  }
  if (e.key === 'Escape') {
    (e.target as HTMLInputElement | null)?.blur?.();
    return;
  }
  const shortcut = formatGlobalShortcutFromKeyboardEvent(e);
  if (!shortcut) return;
  store.setToolShortcut(toolId, shortcut);
  (e.target as HTMLInputElement | null)?.blur?.();
};
</script>

<template>
  <div>
    <div class="settings-section-title">{{ t('common.tool_shortcuts_label') }}</div>
    <div class="settings-section-hint">{{ t('common.tool_shortcuts_help') }}</div>

    <ul class="tool-shortcut-list">
      <li v-for="tool in toolList" :key="tool.metadata.id" class="tool-shortcut-row">
        <div class="flex-1 min-w-0">
          <div class="tool-shortcut-name" :title="t(tool.metadata.description)">{{ t(tool.metadata.name) }}</div>
        </div>
        <input
          :value="currentShortcut(tool.metadata.id)"
          :placeholder="t('common.tool_shortcuts_placeholder')"
          readonly
          class="settings-input font-mono tool-shortcut-input"
          @keydown.prevent="handleRecorderKeydown($event, tool.metadata.id)"
        />
        <button
          type="button"
          class="settings-btn"
          :disabled="!currentShortcut(tool.metadata.id)"
          :class="{ 'is-disabled': !currentShortcut(tool.metadata.id) }"
          @click="store.clearToolShortcut(tool.metadata.id)"
        >
          {{ t('common.tool_shortcuts_clear') }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tool-shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.settings-section-hint {
  color: var(--skin-text-muted);
  font-size: 12px;
  margin-bottom: 16px;
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
