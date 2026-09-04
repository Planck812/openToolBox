<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { info as logInfo } from '@tauri-apps/plugin-log';
import { Minus, MousePointer2, RotateCcw, X, ZoomIn } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  pinClose,
  pinGetState,
  pinReset,
  pinSetClickThrough,
  pinSetFlip,
  pinSetGroup,
  pinSetOpacity,
  pinSetRotation,
  pinSetZoom,
  pinStartDrag,
  type PinState,
} from '@/lib/ipc/screenshot';

const { t } = useI18n();
const ZOOM_STEP = 10;
const OPACITY_STEP = 10;
const pinId = ref('');
const state = ref<PinState | null>(null);
const imageUrl = ref('');
const errorMessage = ref('');
const busy = ref(false);
const contextMenu = ref<HTMLElement | null>(null);
const contextMenuOpen = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
let isMounted = false;
let loadVersion = 0;
/** onMounted 到 <img> onload 的总耗时起点（用于量化「创建窗口→图片就绪」）。 */
let onLoadStart = 0;

const zoomLabel = computed(() => `${state.value?.zoomPercent ?? 100}%`);
const opacityLabel = computed(() => `${state.value?.opacityPercent ?? 100}%`);

/** 贴图 CSS transform：旋转 + 翻转。 */
const pinImageStyle = computed(() => {
  const s = state.value;
  if (!s) return {};
  const rotate = `rotate(${s.rotation ?? 0}deg)`;
  const flipX = s.flippedH ? -1 : 1;
  const flipY = s.flippedV ? -1 : 1;
  return { transform: `${rotate} scale(${flipX}, ${flipY})` };
});

/** 旋转贴图（增加指定角度，默认 +90°）。 */
const rotatePin = async (delta = 90) => {
  if (!pinId.value || busy.value) return;
  busy.value = true;
  try {
    const next = ((state.value?.rotation ?? 0) + delta) % 360;
    state.value = await pinSetRotation({ pinId: pinId.value, rotation: next });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

/** 水平/垂直翻转。 */
const flipPin = async (horizontal: boolean, vertical: boolean) => {
  if (!pinId.value || busy.value) return;
  busy.value = true;
  try {
    const h = horizontal ? !(state.value?.flippedH ?? false) : (state.value?.flippedH ?? false);
    const v = vertical ? !(state.value?.flippedV ?? false) : (state.value?.flippedV ?? false);
    state.value = await pinSetFlip({ pinId: pinId.value, horizontal: h, vertical: v });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

/** 贴图分组。 */
const setPinGroup = async (group: number) => {
  if (!pinId.value || busy.value) return;
  busy.value = true;
  try {
    state.value = await pinSetGroup({ pinId: pinId.value, group });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

const errorText = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown');
};

const resolvePinIdentity = () => {
  const label = getCurrentWindow().label;
  const pinId = label.startsWith('pin-') ? label.slice(4) : '';
  if (!pinId) {
    throw new Error(t('tools.screenshot.pin_window.identity_failed'));
  }
  return { pinId };
};

const load = async (version: number) => {
  const t0 = performance.now();
  const identity = resolvePinIdentity();
  const next = await pinGetState({ pinId: identity.pinId });
  logInfo(`[pin] get_state ${Math.round(performance.now() - t0)}ms (since load)`);

  if (!isMounted || version !== loadVersion) return;
  pinId.value = identity.pinId;
  state.value = next;
  // 通过 pin-image 自定义协议直接加载图片（<img> 流式，比 invoke Vec<u8>
  // JSON 序列化快得多）。窗口先不可见，图片渲染完成后由 <img @load> 调 show。
  imageUrl.value = `http://pin-image.localhost/${identity.pinId}/${next.imageToken}`;
};

const handleImageLoad = () => {
  const total = Math.round(performance.now() - onLoadStart);
  logInfo(`[pin] img onload ${total}ms (onMounted → 图片就绪)`);
  getCurrentWindow().show().catch(() => {
    // show 失败兜底：强制可见，避免窗口永久不可见。
    setTimeout(() => getCurrentWindow().show().catch(() => {}), 50);
  });
};

const handleImageError = () => {
  errorMessage.value = t('tools.screenshot.pin_window.image_empty');
  // 加载失败也显示窗口，展示错误提示 + 重试按钮。
  getCurrentWindow().show().catch(() => {});
};

const retryLoad = () => {
  if (busy.value || !isMounted) return;
  const version = ++loadVersion;
  busy.value = true;
  errorMessage.value = '';
  state.value = null;
  void load(version)
    .catch((error) => {
      if (isMounted && version === loadVersion) {
        errorMessage.value = errorText(error);
        // 加载失败也要显示窗口，展示错误提示 + 重试。
        getCurrentWindow().show().catch(() => {});
      }
    })
    .finally(() => {
      if (isMounted && version === loadVersion) busy.value = false;
    });
};

const updateZoom = async (zoomPercent: number) => {
  if (!state.value || busy.value) return;
  busy.value = true;
  try {
    state.value = await pinSetZoom({
      pinId: pinId.value,
      zoomPercent,
    });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

const updateOpacity = async (opacityPercent: number) => {
  if (!state.value || busy.value) return;
  busy.value = true;
  try {
    state.value = await pinSetOpacity({
      pinId: pinId.value,
      opacityPercent,
    });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

const resetPin = async () => {
  if (busy.value) return;
  busy.value = true;
  try {
    state.value = await pinReset({ pinId: pinId.value });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

const setClickThrough = async (enabled: boolean) => {
  if (busy.value) return;
  busy.value = true;
  try {
    state.value = await pinSetClickThrough({
      pinId: pinId.value,
      enabled,
    });
  } catch (error) {
    errorMessage.value = errorText(error);
  } finally {
    busy.value = false;
  }
};

const enableClickThrough = () => setClickThrough(true);

const dismissContextMenu = () => {
  contextMenuOpen.value = false;
};

const openContextMenu = async (event: MouseEvent) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest('.pin-toolbar')) return;

  event.preventDefault();
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
  contextMenuOpen.value = true;
  await nextTick();
  contextMenu.value?.focus();
};

const performContextMenuAction = (action: () => void) => {
  dismissContextMenu();
  action();
};

const startDrag = async (event: MouseEvent) => {
  if (event.button !== 0 || busy.value) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest('button, input')) return;
  event.preventDefault();
  try {
    await pinStartDrag({ pinId: pinId.value });
  } catch (error) {
    errorMessage.value = errorText(error);
  }
};

const closePin = async () => {
  dismissContextMenu();
  if (!pinId.value || busy.value) return;
  busy.value = true;
  try {
    await pinClose({ pinId: pinId.value });
  } catch (error) {
    busy.value = false;
    errorMessage.value = errorText(error);
  }
};

const handleWheel = (event: WheelEvent) => {
  if (!state.value) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  if (event.ctrlKey || event.shiftKey) {
    void updateOpacity(state.value.opacityPercent + direction * OPACITY_STEP);
  } else {
    void updateZoom(state.value.zoomPercent + direction * ZOOM_STEP);
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (contextMenuOpen.value) {
      dismissContextMenu();
      return;
    }
    void closePin();
    return;
  }
  // 1/2 旋转（+90°/180°），3/4 翻转（水平/垂直）（仿 Snipaste）。
  if (event.key === '1') { event.preventDefault(); void rotatePin(90); return; }
  if (event.key === '2') { event.preventDefault(); void rotatePin(180); return; }
  if (event.key === '3') { event.preventDefault(); void flipPin(true, false); return; }
  if (event.key === '4') { event.preventDefault(); void flipPin(false, true); return; }
};

const handlePointerDown = (event: PointerEvent) => {
  if (!contextMenuOpen.value || contextMenu.value?.contains(event.target as Node)) return;
  dismissContextMenu();
};

onMounted(() => {
  isMounted = true;
  onLoadStart = performance.now();
  logInfo('[pin] onMounted (Vue 挂载完成)');
  document.documentElement.classList.add('pin-window-root');
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('wheel', handleWheel, { passive: false });
  retryLoad();
});

onUnmounted(() => {
  isMounted = false;
  ++loadVersion;
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('pointerdown', handlePointerDown, true);
  window.removeEventListener('wheel', handleWheel);
  dismissContextMenu();
  document.documentElement.classList.remove('pin-window-root');
});
</script>

<template>
  <main
    class="pin-window"
    data-testid="pin-window"
    @mousedown="startDrag"
    @dblclick="resetPin"
    @contextmenu="openContextMenu"
  >
    <img
      v-if="imageUrl"
      class="pin-image"
      :src="imageUrl"
      :style="pinImageStyle"
      :alt="t('tools.screenshot.pin_window.image_alt')"
      draggable="false"
      @load="handleImageLoad"
      @error="handleImageError"
    />
    <!-- 加载失败时显示错误提示 + 重试（加载中不显示 loading，图片就绪即出现）。 -->
    <div v-else-if="errorMessage" class="pin-loading" role="alert" data-testid="pin-load-error">
      <span>{{ t('tools.screenshot.pin_window.load_failed', { error: errorMessage }) }}</span>
      <div class="pin-loading__actions">
        <button type="button" data-testid="pin-load-retry" :disabled="busy" @click="retryLoad">{{ t('tools.screenshot.pin_window.retry') }}</button>
        <button type="button" :disabled="busy" @click="closePin">{{ t('tools.screenshot.pin_window.close') }}</button>
      </div>
    </div>

    <div v-if="state" class="pin-toolbar" data-testid="pin-toolbar" @mousedown.stop>
      <button
        type="button"
        :aria-label="t('tools.screenshot.pin_window.zoom_out')"
        :title="t('tools.screenshot.pin_window.zoom_out')"
        :disabled="busy || state.zoomPercent <= 20"
        data-testid="pin-zoom-out"
        @click="updateZoom(state.zoomPercent - ZOOM_STEP)"
      >
        <Minus />
      </button>
      <span class="pin-value">{{ zoomLabel }}</span>
      <button
        type="button"
        :aria-label="t('tools.screenshot.pin_window.zoom_in')"
        :title="t('tools.screenshot.pin_window.zoom_in')"
        :disabled="busy || state.zoomPercent >= 500"
        data-testid="pin-zoom-in"
        @click="updateZoom(state.zoomPercent + ZOOM_STEP)"
      >
        <ZoomIn />
      </button>
      <input
        :aria-label="t('tools.screenshot.pin_window.opacity')"
        :title="t('tools.screenshot.pin_window.opacity')"
        type="range"
        min="20"
        max="100"
        step="10"
        :value="state.opacityPercent"
        data-testid="pin-opacity"
        @input="updateOpacity(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="pin-value">{{ opacityLabel }}</span>
      <button type="button" :aria-label="t('tools.screenshot.pin_window.reset')" :title="t('tools.screenshot.pin_window.reset')" :disabled="busy" data-testid="pin-reset" @click="resetPin">
        <RotateCcw />
      </button>
      <button
        type="button"
        :aria-label="t('tools.screenshot.pin_window.enable_click_through')"
        :title="t('tools.screenshot.pin_window.click_through_hint')"
        :disabled="busy"
        data-testid="pin-click-through"
        @click="enableClickThrough"
      >
        <MousePointer2 />
      </button>
      <button
        type="button"
        class="pin-close"
        :aria-label="t('tools.screenshot.pin_window.close')"
        :title="t('tools.screenshot.pin_window.close')"
        :disabled="busy"
        data-testid="pin-close"
        @click="closePin"
      >
        <X />
      </button>
    </div>

    <div v-if="state?.clickThrough" class="pin-click-through-banner" data-testid="pin-click-through-banner">
      {{ t('tools.screenshot.pin_window.click_through_active') }}
    </div>

    <div v-if="errorMessage && imageUrl" class="pin-error">{{ errorMessage }}</div>

    <div
      v-if="contextMenuOpen && state"
      ref="contextMenu"
      class="pin-context-menu"
      role="menu"
      tabindex="-1"
      :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }"
      @mousedown.stop
      @contextmenu.prevent
    >
      <button type="button" role="menuitem" data-testid="pin-context-zoom-out" :disabled="busy || state.zoomPercent <= 20" @click="performContextMenuAction(() => void updateZoom(state!.zoomPercent - ZOOM_STEP))">{{ t('tools.screenshot.pin_window.menu_zoom_out') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-zoom-in" :disabled="busy || state.zoomPercent >= 500" @click="performContextMenuAction(() => void updateZoom(state!.zoomPercent + ZOOM_STEP))">{{ t('tools.screenshot.pin_window.menu_zoom_in') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-reset-zoom" :disabled="busy" @click="performContextMenuAction(() => void updateZoom(100))">{{ t('tools.screenshot.pin_window.menu_reset_zoom') }}</button>
      <div class="pin-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" data-testid="pin-context-opacity-down" :disabled="busy || state.opacityPercent <= 20" @click="performContextMenuAction(() => void updateOpacity(state!.opacityPercent - OPACITY_STEP))">{{ t('tools.screenshot.pin_window.menu_decrease_opacity') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-opacity-up" :disabled="busy || state.opacityPercent >= 100" @click="performContextMenuAction(() => void updateOpacity(state!.opacityPercent + OPACITY_STEP))">{{ t('tools.screenshot.pin_window.menu_increase_opacity') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-reset-opacity" :disabled="busy" @click="performContextMenuAction(() => void updateOpacity(100))">{{ t('tools.screenshot.pin_window.menu_reset_opacity') }}</button>
      <div class="pin-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" data-testid="pin-context-click-through" :disabled="busy" @click="performContextMenuAction(() => void setClickThrough(!state!.clickThrough))">{{ state.clickThrough ? t('tools.screenshot.pin_window.menu_restore_interaction') : t('tools.screenshot.pin_window.menu_enable_click_through') }}</button>
      <div class="pin-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" data-testid="pin-context-rotate" :disabled="busy" @click="performContextMenuAction(() => void rotatePin())">{{ t('tools.screenshot.pin_window.menu_rotate') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-flip-h" :disabled="busy" @click="performContextMenuAction(() => void flipPin(true, false))">{{ t('tools.screenshot.pin_window.menu_flip_h') }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-flip-v" :disabled="busy" @click="performContextMenuAction(() => void flipPin(false, true))">{{ t('tools.screenshot.pin_window.menu_flip_v') }}</button>
      <div class="pin-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" data-testid="pin-context-group-0" :disabled="busy" @click="performContextMenuAction(() => void setPinGroup(0))">{{ t('tools.screenshot.pin_window.menu_group', { name: t('tools.screenshot.pin_window.menu_group_none'), checked: state.group === 0 ? t('tools.screenshot.pin_window.menu_group_checked') : '' }) }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-group-1" :disabled="busy" @click="performContextMenuAction(() => void setPinGroup(1))">{{ t('tools.screenshot.pin_window.menu_group', { name: '1', checked: state.group === 1 ? t('tools.screenshot.pin_window.menu_group_checked') : '' }) }}</button>
      <button type="button" role="menuitem" data-testid="pin-context-group-2" :disabled="busy" @click="performContextMenuAction(() => void setPinGroup(2))">{{ t('tools.screenshot.pin_window.menu_group', { name: '2', checked: state.group === 2 ? t('tools.screenshot.pin_window.menu_group_checked') : '' }) }}</button>
      <div class="pin-context-menu__separator" role="separator" />
      <button type="button" role="menuitem" data-testid="pin-context-close" class="pin-context-menu__close" :disabled="busy" @click="performContextMenuAction(() => void closePin())">{{ t('tools.screenshot.pin_window.menu_close') }}</button>
    </div>
  </main>
</template>

<style>
html.pin-window-root,
html.pin-window-root body,
html.pin-window-root #app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

.pin-window {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  user-select: none;
  cursor: move;
}

.pin-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.pin-loading {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
  background: #111827;
  color: #f8fafc;
  font: 13px/1.4 system-ui, sans-serif;
  text-align: center;
}

.pin-loading__actions {
  display: flex;
  gap: 8px;
}

.pin-loading button {
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  cursor: pointer;
}

.pin-loading button:disabled {
  cursor: default;
  opacity: 0.5;
}

.pin-toolbar {
  position: absolute;
  top: 8px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 120ms ease;
  cursor: default;
}

.pin-window:hover .pin-toolbar,
.pin-toolbar:focus-within {
  opacity: 1;
}

.pin-toolbar button {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  cursor: pointer;
}

.pin-toolbar button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
}

.pin-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.pin-toolbar button svg {
  width: 15px;
  height: 15px;
}

.pin-toolbar .pin-close:hover:not(:disabled) {
  background: #dc2626;
}

.pin-toolbar input[type='range'] {
  width: 72px;
}

.pin-value {
  min-width: 36px;
  color: #f8fafc;
  font: 11px/1 system-ui, sans-serif;
  text-align: center;
}

.pin-context-menu {
  position: fixed;
  z-index: 10;
  min-width: 144px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  cursor: default;
}

.pin-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #f8fafc;
  font: 12px/1.3 system-ui, sans-serif;
  text-align: left;
  cursor: pointer;
}

.pin-context-menu button:hover:not(:disabled),
.pin-context-menu button:focus-visible:not(:disabled) {
  outline: 0;
  background: rgba(255, 255, 255, 0.18);
}

.pin-context-menu button:disabled {
  opacity: 0.4;
  cursor: default;
}

.pin-context-menu .pin-context-menu__close:hover:not(:disabled),
.pin-context-menu .pin-context-menu__close:focus-visible:not(:disabled) {
  background: #dc2626;
}

.pin-context-menu__separator {
  height: 1px;
  margin: 4px 2px;
  background: rgba(255, 255, 255, 0.18);
}

.pin-click-through-banner {
  position: absolute;
  bottom: 8px;
  left: 50%;
  max-width: calc(100% - 16px);
  padding: 5px 10px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.88);
  color: #f8fafc;
  font: 11px/1.4 system-ui, sans-serif;
  pointer-events: none;
  text-align: center;
  transform: translateX(-50%);
  white-space: nowrap;
}

.pin-error {
  position: absolute;
  right: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  padding: 6px 8px;
  border-radius: 5px;
  background: rgba(127, 29, 29, 0.92);
  color: white;
  font: 11px/1.3 system-ui, sans-serif;
  cursor: default;
}
</style>
