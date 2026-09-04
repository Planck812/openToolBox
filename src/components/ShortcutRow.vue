<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatGlobalShortcutFromKeyboardEvent } from '@/lib/shortcut';

interface Props {
  labelKey: string;
  hintKey: string;
  placeholderKey: string;
  saveLabelKey: string;
  resetLabelKey: string;
  modelValue: string;
  onSave: (value: string) => void | Promise<void>;
  onReset: () => void;
}

const props = defineProps<Props>();
const { t } = useI18n();

const draft = ref(props.modelValue);
watch(
  () => props.modelValue,
  (value) => {
    draft.value = value;
  }
);

/**
 * 快捷键输入框按键处理（按下组合键即可生成配置）
 * @param e 键盘事件
 */
const handleKeydown = (e: KeyboardEvent) => {
  // Tab 用于键盘导航：放行默认行为，不写入草稿、不阻止焦点移动。
  if (e.key === 'Tab') return;
  e.preventDefault();

  if (e.key === 'Backspace' || e.key === 'Delete') {
    draft.value = '';
    return;
  }

  if (e.key === 'Escape') {
    (e.target as HTMLInputElement | null)?.blur?.();
    return;
  }

  const shortcut = formatGlobalShortcutFromKeyboardEvent(e);
  if (!shortcut) return;
  draft.value = shortcut;
};

const isDirty = computed(() => draft.value.trim() !== props.modelValue.trim());

/**
 * 提交当前草稿，交由父级完成保存（写 store + Toast + 跳转）
 */
const save = () => {
  void props.onSave(draft.value);
};

/**
 * 交由父级完成恢复默认（写 store + Toast）
 */
const reset = () => {
  props.onReset();
};
</script>

<template>
  <section>
    <div class="settings-section-title">{{ t(labelKey) }}</div>
    <div class="settings-section-hint">{{ t(hintKey) }}</div>

    <div class="flex items-center gap-2 flex-wrap">
      <input
        v-model="draft"
        readonly
        class="settings-input font-mono"
        :placeholder="t(placeholderKey)"
        @keydown="handleKeydown"
      />
      <button
        class="settings-btn"
        type="button"
        :disabled="!isDirty"
        :class="{ 'is-disabled': !isDirty }"
        @click="save"
      >
        {{ t(saveLabelKey) }}
      </button>
      <button class="settings-btn" type="button" @click="reset">
        {{ t(resetLabelKey) }}
      </button>
    </div>
  </section>
</template>

<style scoped>
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
