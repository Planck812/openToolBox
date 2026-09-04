<script setup lang="ts">
import { scrollCaptureNext, scrollCaptureStop } from '@/lib/ipc/screenshot';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Scissors, Square, Loader2 } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const stitchedHeight = ref(0);
const running = ref(true);
const errorMessage = ref('');
const isStopping = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let unlisten: (() => void) | null = null;
let cancelled = false;

/** 循环采集拼接（手动滚动模式：工具不自动滚，用户滚到哪拼到哪）。 */
let nextInFlight = false;
const runNext = async () => {
  if (!running.value || isStopping.value || nextInFlight) return;
  nextInFlight = true;
  try {
    const result = await scrollCaptureNext();
    if (isStopping.value || !running.value) return; // 停止中，不再调度下一轮
    stitchedHeight.value = result.stitchedHeight;
  } catch (e) {
    errorMessage.value = String(e ?? t('tools.screenshot.scroll_hud.scroll_capture_failed'));
    running.value = false;
    await stopCapture();
    return;
  } finally {
    nextInFlight = false;
  }
  // 节流 100ms 后再下一轮（更高频率捕捉手动滚动，减少两帧间位移过大导致的漏帧）。
  if (running.value) timer = setTimeout(() => void runNext(), 100);
};

const stopCapture = async () => {
  if (isStopping.value) return;
  isStopping.value = true;
  running.value = false;
  try {
    // 等当前在途的 scroll_capture_next 返回（避免其响应 dispatch 到已关闭窗口）。
    // 带超时兜底，防止 invoke 卡住导致无法停止。
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 500;
      const check = () => {
        if (!nextInFlight || Date.now() > deadline) resolve();
        else setTimeout(check, 20);
      };
      check();
    });
    const result = await scrollCaptureStop();
    // 通知主窗口滚动截图已完成（带预览 token）。用 emitTo 定向主窗口，
    // 比全局 emit 更可靠（避免窗口关闭导致事件丢失）。
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('main', 'scroll_capture_finished', { previewToken: result.previewToken });
    // 给主窗口足够时间处理事件（含 PNG 编码/渲染）。
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (e) {
    errorMessage.value = String(e ?? t('tools.screenshot.scroll_hud.stop_failed'));
  } finally {
    isStopping.value = false;
    // 关闭 HUD 窗口。
    const win = getCurrentWindow();
    await win.close();
  }
};

onMounted(async () => {
  const unlistenFn = await listen<{ stitchedHeight: number }>(
    'scroll_capture_progress',
    (event) => {
      if (cancelled) return;
      stitchedHeight.value = event.payload.stitchedHeight;
    },
  );
  // 监听注册期间组件已卸载：立即释放刚注册的监听，避免泄漏。
  if (cancelled) {
    unlistenFn();
    return;
  }
  unlisten = unlistenFn;
  // 启动采集循环。
  timer = setTimeout(() => void runNext(), 100);
});

onUnmounted(() => {
  cancelled = true;
  running.value = false;
  if (timer) clearTimeout(timer);
  unlisten?.();
});
</script>

<template>
  <div class="scroll-hud-root">
    <div v-if="errorMessage" class="scroll-hud-error">{{ errorMessage }}</div>
    <template v-else>
      <div class="scroll-hud-header">
        <Scissors class="w-4 h-4" />
        <span class="scroll-hud-title">{{ t('tools.screenshot.scroll_hud.title') }}</span>
      </div>
      <div class="scroll-hud-body">
        <div class="scroll-hud-progress">
          <Loader2 class="w-4 h-4 animate-spin" />
          <span>{{ t('tools.screenshot.scroll_hud.stitched_progress', { height: stitchedHeight }) }}</span>
        </div>
        <div class="scroll-hud-hint">{{ t('tools.screenshot.scroll_hud.hint') }}</div>
      </div>
      <button
        class="scroll-hud-stop"
        :disabled="isStopping"
        @click="stopCapture"
      >
        <Square class="w-3.5 h-3.5" />
        {{ t('tools.screenshot.scroll_hud.stop') }}
      </button>
    </template>
  </div>
</template>

<style>
html.scroll-hud-window,
html.scroll-hud-window body,
html.scroll-hud-window #app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: auto;
  background: transparent !important;
}

.scroll-hud-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  color: #e2e8f0;
  box-sizing: border-box;
  user-select: none;
}

.scroll-hud-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #e2e8f0;
}

.scroll-hud-title {
  font-size: 13px;
  font-weight: 600;
}

.scroll-hud-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.scroll-hud-hint {
  font-size: 11px;
  color: #94a3b8;
}

.scroll-hud-progress,
.scroll-hud-done {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #94a3b8;
}

.scroll-hud-done {
  color: #34d399;
}

.scroll-hud-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: #ef4444;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}

.scroll-hud-stop:hover:not(:disabled) {
  background: #dc2626;
}

.scroll-hud-stop:disabled {
  opacity: 0.6;
  cursor: default;
}

.scroll-hud-error {
  font-size: 13px;
  color: #f87171;
}
</style>
