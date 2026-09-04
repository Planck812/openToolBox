<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '@/store/app';
import { storeToRefs } from 'pinia';
import { applyThemeMode, getThemeSkin } from '@/lib/theme';
import { useI18n } from 'vue-i18n';
import { Copy, Maximize2, Minus, Pin, PinOff, X } from 'lucide-vue-next';
import QuickLaunchRoot from '@/components/QuickLaunchRoot.vue';
import { logToFile } from '@/lib/logger';
import { useWindowControls } from '@/composables/useWindowControls';
import { useAppNavigation } from '@/composables/useAppNavigation';
import { useShortcutSync } from '@/composables/useShortcutSync';
import { useGlobalKeyboard } from '@/composables/useGlobalKeyboard';
import { isTauriEnvironment } from '@/lib/tauri-env';

const store = useAppStore();
const { t } = useI18n();
/** 快速唤起小窗口的 SPA 实例：不渲染主窗口 UI，只渲染 QuickLaunchRoot */
const isQuickLaunchWindow = isTauriEnvironment() && getCurrentWindow().label === 'quicklaunch';
const { toasts, themeMode, themeSkinId, appBackgroundImage, appBackgroundMode } = storeToRefs(store);
const DEFAULT_BG_IMAGE = '/backgrounds/landscape-1.jpg';

/** onMounted 中 await 之后创建的 watch 不再自动绑定组件 scope，手动保存 stop 句柄并在 onUnmounted 释放。 */
let stopWatchThemeMode: (() => void) | null = null;
let stopWatchThemeSkinId: (() => void) | null = null;
let stopWatchAppBackgroundImage: (() => void) | null = null;
let stopWatchAppBackgroundMode: (() => void) | null = null;

const resolveAppBackgroundCssValue = () => {
  if (appBackgroundMode.value === 'none') return 'none';
  if (appBackgroundMode.value === 'custom' && appBackgroundImage.value) {
    return `url('${appBackgroundImage.value}')`;
  }
  return `url('${DEFAULT_BG_IMAGE}')`;
};

const {
  isWindowMaximized,
  isWindowAlwaysOnTop,
  ensureWindowActivated,
  minimizeWindow,
  toggleWindowMaximize,
  toggleWindowAlwaysOnTop,
  closeWindow,
  handleTitlebarMouseDown,
  handleTitlebarDoubleClick,
} = useWindowControls();
const navigation = useAppNavigation({ ensureWindowActivated });
useShortcutSync({ navigation });
const { handleKeydown } = useGlobalKeyboard();

// 帧率监控（开发模式）
let lastFrameTime = performance.now();
let slowFrameCount = 0;
let frameMonitorRunning = false;
const monitorFrameRate = () => {
  const now = performance.now();
  const frameTime = now - lastFrameTime;
  if (frameTime > 50) { // 16.67ms 是 60fps 标准，50ms 算卡顿
    slowFrameCount++;
    if (slowFrameCount % 20 === 0) { // 每 20 帧卡顿记一次（避免日志过多）
      logToFile('debug', `[PERF] Frame drop detected: ${frameTime.toFixed(1)}ms (occurrences: ${slowFrameCount})`);
    }
  }
  lastFrameTime = now;
  if (frameMonitorRunning) {
    requestAnimationFrame(monitorFrameRate);
  }
};

onMounted(async () => {
  // 快速唤起窗口的实例：跳过主窗口全部初始化（快捷键同步/事件注册等），UI 由 QuickLaunchRoot 承担。
  if (isQuickLaunchWindow) {
    return;
  }
  await logToFile('info', 'App.vue mounted');
  applyThemeMode(themeMode.value, themeSkinId.value);
  document.documentElement.style.setProperty('--app-bg-image', resolveAppBackgroundCssValue());

  window.addEventListener('keydown', handleKeydown, { capture: true });

  stopWatchThemeMode = watch(
    () => themeMode.value,
    (mode) => {
      applyThemeMode(mode, themeSkinId.value);
    },
    { immediate: true }
  );

  stopWatchThemeSkinId = watch(
    () => themeSkinId.value,
    (skinId) => {
      applyThemeMode(themeMode.value, skinId);
      const skin = getThemeSkin(skinId);
      logToFile('info', `Theme skin switched to: ${skin.name}`).catch(() => {});
    },
    { immediate: true }
  );

  stopWatchAppBackgroundImage = watch(
    () => appBackgroundImage.value,
    () => {
      document.documentElement.style.setProperty('--app-bg-image', resolveAppBackgroundCssValue());
    },
    { immediate: true }
  );
  stopWatchAppBackgroundMode = watch(
    () => appBackgroundMode.value,
    () => {
      document.documentElement.style.setProperty('--app-bg-image', resolveAppBackgroundCssValue());
    },
    { immediate: true }
  );

  // 启动帧率监控
  frameMonitorRunning = true;
  requestAnimationFrame(monitorFrameRate);

  await logToFile('info', 'App.vue initialization complete');
  await logToFile('info', '=== End Debug ===');
  await logToFile('info', t('app.log_location'));
});

onUnmounted(() => {
  logToFile('info', 'App.vue unmounting, cleaning up').catch(() => {});
  frameMonitorRunning = false; // 停止帧率监控
  window.removeEventListener('keydown', handleKeydown, { capture: true });
  stopWatchThemeMode?.();
  stopWatchThemeMode = null;
  stopWatchThemeSkinId?.();
  stopWatchThemeSkinId = null;
  stopWatchAppBackgroundImage?.();
  stopWatchAppBackgroundImage = null;
  stopWatchAppBackgroundMode?.();
  stopWatchAppBackgroundMode = null;
  logToFile('info', 'App.vue cleanup complete').catch(() => {});
});
</script>

<template>
  <QuickLaunchRoot v-if="isQuickLaunchWindow" />
  <template v-else>
    <div class="app-shell flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <header
      class="app-titlebar"
      @mousedown="handleTitlebarMouseDown"
      @dblclick="handleTitlebarDoubleClick"
    >
      <div class="app-titlebar-brand">
        <span class="app-titlebar-logo">
          <img :src="'/tauri.svg'" alt="" class="app-titlebar-icon" />
          <span class="app-titlebar-logo-glow"></span>
        </span>
        <span class="app-titlebar-name">open-toolbox</span>
        <span class="app-titlebar-tag">TECH</span>
      </div>
      <div class="app-window-controls">
        <button
          type="button"
          class="app-window-button app-window-pin"
          :class="isWindowAlwaysOnTop ? 'is-active' : ''"
          data-window-control
          :aria-label="isWindowAlwaysOnTop ? t('app.pin_off') : t('app.pin_on')"
          :title="isWindowAlwaysOnTop ? t('app.pin_off') : t('app.pin_on')"
          @mousedown.stop.prevent
          @dblclick.stop
          @click.stop="toggleWindowAlwaysOnTop"
        >
          <PinOff v-if="isWindowAlwaysOnTop" class="h-[14px] w-[14px]" />
          <Pin v-else class="h-[14px] w-[14px]" />
        </button>
        <button
          type="button"
          class="app-window-button"
          data-window-control
          :aria-label="t('app.minimize')"
          :title="t('app.minimize')"
          @mousedown.stop.prevent
          @dblclick.stop
          @click.stop="minimizeWindow"
        >
          <Minus class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="app-window-button"
          data-window-control
          :aria-label="isWindowMaximized ? t('app.restore') : t('app.maximize')"
          :title="isWindowMaximized ? t('app.restore') : t('app.maximize')"
          @mousedown.stop.prevent
          @dblclick.stop
          @click.stop="toggleWindowMaximize"
        >
          <Copy v-if="isWindowMaximized" class="h-[13px] w-[13px]" />
          <Maximize2 v-else class="h-[13px] w-[13px]" />
        </button>
        <button
          type="button"
          class="app-window-button app-window-close"
          data-window-control
          :aria-label="t('app.close')"
          :title="t('app.close')"
          @mousedown.stop.prevent
          @dblclick.stop
          @click.stop="closeWindow"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden">
      <router-view v-slot="{ Component, route: currentRoute }">
        <!-- KeepAlive 常驻包裹：切回首页不再卸载缓存，工具实例状态真实保活。
             仅缓存 ToolView（按 fullPath 区分多个工具实例），其余路由不缓存。 -->
        <KeepAlive :include="['ToolView']">
          <component :is="Component" :key="currentRoute.fullPath" />
        </KeepAlive>
      </router-view>
    </main>
    <div class="app-toast-container fixed right-4 top-16 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="app-toast rounded-md border px-4 py-3 text-sm shadow-md"
        :class="{
          'app-toast-success': toast.type === 'success',
          'app-toast-warning': toast.type === 'warning',
          'app-toast-error': toast.type === 'error',
          'app-toast-info': toast.type === 'info',
        }"
      >
        {{ toast.message }}
      </div>
    </div>
  </div>
  </template>
</template>

<style>
.app-shell {
  position: relative;
  background-image:
    var(--skin-app-bg-overlay),
    var(--app-bg-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

.app-titlebar {
  position: relative;
  display: flex;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-titlebar-bg);
  color: var(--skin-text-strong);
  user-select: none;
  box-shadow: inset 0 -1px 0 rgba(var(--skin-accent-rgb) / 0.08), 0 2px 12px rgba(0, 0, 0, 0.08);
  z-index: 10;
}

.app-titlebar::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--skin-grid-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--skin-grid-color) 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.6;
}

.app-titlebar-brand {
  display: inline-flex;
  height: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding-left: 12px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
  position: relative;
  z-index: 1;
}

.app-titlebar-logo {
  position: relative;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
}

.app-titlebar-icon {
  width: 18px;
  height: 18px;
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 0 6px rgba(var(--skin-accent-rgb) / 0.5));
}

.app-titlebar-logo-glow {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--skin-accent-rgb) / 0.4), transparent 70%);
  opacity: 0.35;
}

.app-titlebar-name {
  background: linear-gradient(135deg, var(--skin-text-strong), var(--skin-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
  letter-spacing: 0.5px;
}

.app-titlebar-tag {
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 2px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(var(--skin-accent-rgb) / 0.12);
  color: var(--skin-accent);
  border: 1px solid rgba(var(--skin-accent-rgb) / 0.25);
  text-shadow: 0 0 8px rgba(var(--skin-accent-rgb) / 0.4);
  font-family: "Consolas", "SF Mono", monospace;
}

.app-window-controls {
  display: inline-flex;
  height: 100%;
  align-items: stretch;
  position: relative;
  z-index: 1;
}

.app-window-button {
  display: grid;
  width: 46px;
  height: 100%;
  place-items: center;
  color: var(--skin-window-text);
  transition: all 0.18s ease;
  position: relative;
}

.app-window-button::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(var(--skin-accent-rgb) / 0), rgba(var(--skin-accent-rgb) / 0));
  transition: background 0.18s ease;
  pointer-events: none;
}

.app-window-button:hover {
  color: var(--skin-window-hover-text);
}

.app-window-button:hover::after {
  background: linear-gradient(135deg, rgba(var(--skin-accent-rgb) / 0.18), rgba(var(--skin-accent-rgb) / 0.06));
  box-shadow: inset 0 -2px 0 rgba(var(--skin-accent-rgb) / 0.5), 0 0 12px rgba(var(--skin-accent-rgb) / 0.2);
}

.app-window-pin.is-active {
  color: var(--skin-accent);
  background: rgba(var(--skin-accent-rgb) / 0.14);
  box-shadow: inset 0 -2px 0 rgba(var(--skin-accent-rgb) / 0.72), 0 0 16px rgba(var(--skin-accent-rgb) / 0.25);
}

.app-window-pin.is-active::after {
  background: radial-gradient(circle at center, rgba(var(--skin-accent-rgb) / 0.2), transparent 70%);
}

.app-window-close:hover {
  color: #ffffff;
}

.app-window-close:hover::after {
  background: linear-gradient(135deg, #e81123, #c50f1f);
  box-shadow: inset 0 -2px 0 rgba(232, 17, 35, 0.6), 0 0 12px rgba(232, 17, 35, 0.3);
}

/* 暗色模式标题栏增强 */
html.dark .app-titlebar {
  box-shadow: inset 0 -1px 0 rgba(var(--skin-accent-rgb) / 0.15), 0 4px 20px rgba(0, 0, 0, 0.3);
}

html.dark .app-titlebar-name {
  background: linear-gradient(135deg, var(--skin-text-strong), var(--skin-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 8px rgba(var(--skin-accent-rgb) / 0.3));
}

/* Toast 通知科技风 */
.app-toast {
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border-radius: 8px;
  font-weight: 600;
  position: relative;
  overflow: hidden;
  animation: app-toast-in 0.25s ease both;
}

@keyframes app-toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.app-toast::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 3px;
}

.app-toast-info {
  background: var(--skin-panel-bg);
  border-color: var(--skin-border);
  color: var(--skin-text-main);
  box-shadow: var(--skin-glow-soft);
}

.app-toast-info::before {
  background: var(--skin-accent);
  box-shadow: 0 0 12px rgba(var(--skin-accent-rgb) / 0.5);
}

.app-toast-success {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
  color: rgb(22 163 74);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.15);
}

.app-toast-success::before {
  background: rgb(16 185 129);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
}

.app-toast-warning {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  color: rgb(217 119 6);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.15);
}

.app-toast-warning::before {
  background: rgb(245 158 11);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
}

.app-toast-error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: rgb(220 38 38);
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.15);
}

.app-toast-error::before {
  background: rgb(239 68 68);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
}

html.dark .app-toast-success {
  background: rgba(16, 185, 129, 0.15);
  color: rgb(110 231 183);
}

html.dark .app-toast-warning {
  background: rgba(245, 158, 11, 0.15);
  color: rgb(253 230 138);
}

html.dark .app-toast-error {
  background: rgba(239, 68, 68, 0.15);
  color: rgb(252 165 165);
}

html.dark .app-toast-info {
  background: var(--skin-panel-bg);
  color: var(--skin-text-main);
}
</style>
