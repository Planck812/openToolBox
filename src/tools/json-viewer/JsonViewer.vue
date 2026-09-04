<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useClipboard } from '@vueuse/core';
import { storeToRefs } from 'pinia';

import JsonEditor, { type MenuItem } from 'vue3-ts-jsoneditor';
import { useAppStore } from '@/store/app';

interface Props {
  initialData?: string;
}

const props = defineProps<Props>();
const { t } = useI18n();
const { copy } = useClipboard();
const store = useAppStore();
const { themeMode } = storeToRefs(store);

// State management
const jsonData = ref<unknown>({});
const error = ref('');
const editorMode = ref<'text' | 'tree' | 'table'>('text');
const jsonText = ref('');
const isDarkTheme = computed(() => themeMode.value === 'dark');

/**
 * 解析并设置 JSON 数据
 * @param content JSON 字符串
 */
const parseJson = (content: string) => {
  if (!content.trim()) {
    jsonData.value = {};
    jsonText.value = '';
    error.value = '';
    return;
  }
  try {
    jsonData.value = JSON.parse(content);
    jsonText.value = JSON.stringify(jsonData.value, null, 2);
    error.value = '';
  } catch (e) {
    error.value = (e as { message?: string } | null)?.message || t('tools.json_viewer.error');
  }
};

/**
 * 将“整体被转义的 JSON”恢复为正常 JSON
 * - 若当前内容本身是 JSON 对象/数组（如 {"a":"{\\"b\\":1}"}），不进行处理
 * - 若当前内容是整体转义的 JSON（如 {\\"a\\":1} 或 "{\\"a\\":1}"），则去除转义并格式化
 */
const unescapeWholeJson = () => {
  const source = (editorMode.value === 'text' ? jsonText.value : JSON.stringify(jsonData.value)).trim();
  if (!source) {
    error.value = '';
    return;
  }

  const tryParse = (text: string) => {
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch {
      return { ok: false as const };
    }
  };

  const unescapeOnce = (text: string) => text.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\\//g, '/');

  let candidateText = source;
  for (let i = 0; i < 3; i += 1) {
    const parsed = tryParse(candidateText);
    if (parsed.ok) {
      if (typeof parsed.value === 'string') {
        candidateText = parsed.value.trim();
        continue;
      }

      if (i === 0) {
        error.value = '';
        return;
      }

      editorMode.value = 'text';
      jsonData.value = parsed.value;
      jsonText.value = JSON.stringify(parsed.value, null, 2);
      error.value = '';
      return;
    }

    const next = unescapeOnce(candidateText);
    if (next === candidateText) {
      break;
    }
    candidateText = next;
  }

  error.value = t('tools.json_viewer.unescape_not_applicable');
};

/**
 * 压缩 JSON 并复制
 */
const copyMinified = () => {
  try {
    const minified = JSON.stringify(jsonData.value);
    copy(minified);
  } catch (e) {
    error.value = t('tools.json_viewer.minify_error');
  }
};

/**
 * 压缩并转义 JSON 并复制
 */
const copyMinifiedEscaped = () => {
  try {
    const minified = JSON.stringify(jsonData.value);
    const escaped = JSON.stringify(minified).replace(/^"|"$/g, '');
    copy(escaped);
  } catch (e) {
    error.value = t('tools.json_viewer.minify_escape_error');
  }
};

const onRenderMenu = (items: MenuItem[]) => {
  // Check if items is undefined or not an array (just in case the signature differs)
  const menuItems = Array.isArray(items) ? items : [];

  // Find the 'space' item which pushes subsequent items to the right
  // Usually the order is: mode, separator, ..., undo, redo, space, ...
  // We want to insert after redo (or before space).
  const spaceIndex = menuItems.findIndex((item) => item.type === 'space');

  const myItems: MenuItem[] = [
    {
      type: 'separator'
    },
    {
      type: 'button',
      className: 'custom-btn-minify',
      title: t('tools.json_viewer.minify_copy'),
      onClick: copyMinified
    },
    {
      type: 'button',
      className: 'custom-btn-escape',
      title: t('tools.json_viewer.minify_escape_copy'),
      onClick: copyMinifiedEscaped
    },
    {
      type: 'button',
      className: 'custom-btn-unescape',
      title: t('tools.json_viewer.unescape'),
      onClick: unescapeWholeJson
    }
  ];

  if (spaceIndex !== -1) {
    // Insert before the space
    const newItems = [...menuItems];
    newItems.splice(spaceIndex, 0, ...myItems);
    return newItems;
  }

  // Fallback: append
  return [...menuItems, ...myItems];
};

// Watch initialData
watch(() => props.initialData, (newVal) => {
  if (newVal) {
    parseJson(newVal);
  }
}, { immediate: true });

</script>

<template>
  <div data-testid="json-viewer-root" class="json-viewer h-full flex flex-col p-4 gap-4 bg-background">

    <!-- Main Editor Area -->
    <div data-testid="json-viewer-content" class="json-content flex-1 border border-border rounded-md overflow-hidden bg-card relative transition-all duration-200">
      <div class="h-full overflow-auto custom-scrollbar">
         <JsonEditor
            v-model:json="jsonData"
            v-model:text="jsonText"
            :mode="editorMode"
            :darkTheme="isDarkTheme"
            :readOnly="false"
            :onRenderMenu="onRenderMenu"
            class="h-full"
        />
      </div>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="error-message p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm font-mono">
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
:deep(.jse-main) {
  height: 100%;
}

:deep(.custom-btn-minify::before),
:deep(.custom-btn-escape::before),
:deep(.custom-btn-unescape::before) {
  content: '';
  display: block;
  width: 18px;
  height: 18px;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

:deep(.custom-btn-minify::before) {
  /* Minimize2 icon */
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='4 14 10 14 10 20'/%3E%3Cpolyline points='20 10 14 10 14 4'/%3E%3Cline x1='14' y1='10' x2='21' y2='3'/%3E%3Cline x1='3' y1='21' x2='10' y2='14'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='4 14 10 14 10 20'/%3E%3Cpolyline points='20 10 14 10 14 4'/%3E%3Cline x1='14' y1='10' x2='21' y2='3'/%3E%3Cline x1='3' y1='21' x2='10' y2='14'/%3E%3C/svg%3E");
}

:deep(.custom-btn-escape::before) {
  /* Quote icon representing escape */
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z' fill='black'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z' fill='black'/%3E%3C/svg%3E");
}

:deep(.custom-btn-unescape::before) {
  /* Eraser icon representing unescape */
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20H7L3 16l9-9 8 8-4 4'/%3E%3Cpath d='M6 16l4 4'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20H7L3 16l9-9 8 8-4 4'/%3E%3Cpath d='M6 16l4 4'/%3E%3C/svg%3E");
}
</style>
