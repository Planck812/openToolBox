<script setup lang="ts">
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Check,
  Droplets,
  Pin,
  Redo2,
  ScanText,
  Scissors,
  Trash2,
  Undo2,
  X,
} from 'lucide-vue-next';
import type { ToolKind } from '@/tools/screenshot-universal/annotation-model';

/** 当前工具样式（新建标注时应用；选中已有标注时改样式也用它）。 */
export interface StyleState {
  color: string;
  strokeWidth: number;
  fontSize: number;
  mosaicBlock: number;
}

/** 工具栏按钮描述（icon 为 lucide 图标组件）。 */
export interface ToolButton {
  kind: ToolKind;
  icon: Component;
  label: string;
}

defineProps<{
  /** 工具栏位置（紧跟选区下方/上方），null 时不渲染（配合父级 toolbarVisible）。 */
  toolbarStyle: { left: string; top: string } | null;
  activeTool: ToolKind;
  toolButtons: ToolButton[];
  showStyleBar: boolean;
  showStrokeWidth: boolean;
  showFontSize: boolean;
  showMosaicBlock: boolean;
  currentStyle: StyleState;
  presetColors: string[];
  busy: boolean;
  /** 非 null 时显示「长截图」与 OCR 入口（有可用选区）。 */
  selectionBox: { left: number; top: number; right: number; bottom: number } | null;
  ocrMode: 'best' | 'fast';
  ocrModeHover: boolean;
  pickerMode: boolean;
}>();

const emit = defineEmits<{
  'switch-tool': [kind: ToolKind];
  undo: [];
  redo: [];
  'remove-selected': [];
  capture: [kind: 'copy' | 'pin'];
  'scroll-capture': [];
  ocr: [];
  'update:ocr-mode': [mode: 'best' | 'fast'];
  'update:ocr-mode-hover': [hover: boolean];
  'toggle-picker': [];
  cancel: [];
  /** 样式字段局部更新（color/strokeWidth/fontSize/mosaicBlock 的子集）。 */
  'update:style': [patch: Partial<StyleState>];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="toolbarStyle" class="overlay-toolbar" :style="toolbarStyle">
    <div class="overlay-tools">
      <button
        v-for="btn in toolButtons"
        :key="btn.kind"
        class="overlay-tool-btn"
        :class="{ active: activeTool === btn.kind }"
        :title="t(btn.label)"
        @mousedown.stop
        @click.stop="emit('switch-tool', btn.kind)"
      >
        <component :is="btn.icon" class="w-4 h-4" />
      </button>
    </div>
    <!-- 样式调节条：按当前工具显示相关项 -->
    <div v-if="showStyleBar" class="overlay-stylebar" @mousedown.stop @click.stop>
      <!-- 颜色面板 -->
      <div class="overlay-style-group">
        <div
          v-for="c in presetColors"
          :key="c"
          class="overlay-color-swatch"
          :class="{ active: currentStyle.color === c }"
          :style="{ background: c }"
          :title="c"
          @click="emit('update:style', { color: c })"
        ></div>
      </div>
      <!-- 线宽滑杆（矩形/箭头/画笔） -->
      <label v-if="showStrokeWidth" class="overlay-style-item">
        {{ t('overlay.style.stroke_width') }}
        <input
          :value="currentStyle.strokeWidth"
          type="range"
          min="1"
          max="12"
          step="1"
          @input="emit('update:style', { strokeWidth: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="overlay-style-val">{{ currentStyle.strokeWidth }}</span>
      </label>
      <!-- 字号（文字工具） -->
      <label v-if="showFontSize" class="overlay-style-item">
        {{ t('overlay.style.font_size') }}
        <input
          :value="currentStyle.fontSize"
          type="range"
          min="12"
          max="40"
          step="2"
          @input="emit('update:style', { fontSize: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="overlay-style-val">{{ currentStyle.fontSize }}</span>
      </label>
      <!-- 马赛克块大小 -->
      <label v-if="showMosaicBlock" class="overlay-style-item">
        {{ t('overlay.style.mosaic') }}
        <select
          :value="currentStyle.mosaicBlock"
          @change="emit('update:style', { mosaicBlock: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option :value="0">{{ t('overlay.style.mosaic_auto') }}</option>
          <option :value="8">{{ t('overlay.style.mosaic_small') }}</option>
          <option :value="16">{{ t('overlay.style.mosaic_medium') }}</option>
          <option :value="24">{{ t('overlay.style.mosaic_large') }}</option>
        </select>
      </label>
    </div>
    <div class="overlay-actions">
      <button class="overlay-action-btn" :title="t('overlay.action.undo')" @mousedown.stop @click.stop="emit('undo')">
        <Undo2 class="w-4 h-4" />
      </button>
      <button class="overlay-action-btn" :title="t('overlay.action.redo')" @mousedown.stop @click.stop="emit('redo')">
        <Redo2 class="w-4 h-4" />
      </button>
      <button class="overlay-action-btn" :title="t('overlay.action.delete')" @mousedown.stop @click.stop="emit('remove-selected')">
        <Trash2 class="w-4 h-4" />
      </button>
      <div class="overlay-sep" />
      <button class="overlay-action-btn" :title="t('overlay.action.copy')" @mousedown.stop @click.stop="emit('capture', 'copy')">
        <Check class="w-4 h-4" />
      </button>
      <button class="overlay-action-btn" :title="t('overlay.action.pin')" @mousedown.stop @click.stop="emit('capture', 'pin')">
        <Pin class="w-4 h-4" />
      </button>
      <button
        v-if="selectionBox"
        class="overlay-action-btn"
        :title="t('overlay.action.scroll')"
        :disabled="busy"
        @mousedown.stop
        @click.stop="emit('scroll-capture')"
      >
        <Scissors class="w-4 h-4" />
      </button>
      <div
        v-if="selectionBox"
        class="overlay-ocr-wrap"
        @mouseenter="emit('update:ocr-mode-hover', true)"
        @mouseleave="emit('update:ocr-mode-hover', false)"
      >
        <div v-if="ocrModeHover" class="overlay-ocr-mode-pop">
          <button
            class="overlay-ocr-mode-opt"
            :class="{ active: ocrMode === 'best' }"
            @mousedown.stop
            @click.stop="emit('update:ocr-mode', 'best')"
          >{{ t('overlay.ocr.mode_best') }}</button>
          <button
            class="overlay-ocr-mode-opt"
            :class="{ active: ocrMode === 'fast' }"
            @mousedown.stop
            @click.stop="emit('update:ocr-mode', 'fast')"
          >{{ t('overlay.ocr.mode_fast') }}</button>
        </div>
        <button
          class="overlay-action-btn"
          :title="t('overlay.ocr.action_title')"
          :disabled="busy"
          @mousedown.stop
          @click.stop="emit('ocr')"
        >
          <ScanText class="w-4 h-4" />
        </button>
      </div>
      <button
        class="overlay-action-btn"
        :class="{ active: pickerMode }"
        :title="t('overlay.action.picker')"
        @mousedown.stop
        @click.stop="emit('toggle-picker')"
      >
        <Droplets class="w-4 h-4" />
      </button>
      <div class="overlay-sep" />
      <button class="overlay-action-btn overlay-cancel" :title="t('overlay.action.cancel')" @mousedown.stop @click.stop="emit('cancel')">
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay-toolbar {
  position: fixed;
  z-index: 10;
  display: flex;
  gap: 8px;
  align-items: center;
  background: rgba(17, 24, 39, 0.85);
  backdrop-filter: blur(12px);
  padding: 8px 12px;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.overlay-stylebar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-left: 12px;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
}
.overlay-style-group {
  display: flex;
  gap: 4px;
}
.overlay-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
}
.overlay-color-swatch.active {
  outline: 2px solid #fff;
  outline-offset: 1px;
}
.overlay-style-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}
.overlay-style-item input[type="range"] {
  width: 80px;
}
.overlay-style-item select {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  padding: 2px 4px;
}
.overlay-style-val {
  min-width: 20px;
  text-align: center;
  font-family: monospace;
}
.overlay-tools {
  display: flex;
  gap: 4px;
}
.overlay-tool-btn,
.overlay-action-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #e5e7eb;
  cursor: pointer;
  transition: background 0.15s;
}
.overlay-tool-btn:hover,
.overlay-action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.overlay-tool-btn.active {
  background: rgba(255, 71, 87, 0.35);
  color: #fff;
}
.overlay-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.overlay-sep {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.2);
}
.overlay-cancel {
  color: #f87171;
}
.overlay-ocr-wrap {
  position: relative;
  display: inline-flex;
}
.overlay-ocr-mode-pop {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  gap: 4px;
  background: rgba(17, 24, 39, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}
.overlay-ocr-mode-opt {
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.overlay-ocr-mode-opt:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.overlay-ocr-mode-opt.active {
  background: rgba(255, 71, 87, 0.35);
  color: #fff;
}
</style>
