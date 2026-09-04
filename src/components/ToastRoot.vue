<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { toastGet, type ToastPayload } from '@/lib/ipc/toast';

const message = ref('');
const isError = ref(false);
const visible = ref(false);
let unlisten: (() => void) | null = null;
let cancelled = false;

onMounted(async () => {
  // 首次建窗：webview 加载期间事件可能早于监听，先 invoke 读取后端当前载荷兜底。
  try {
    const payload = await toastGet();
    if (payload && !cancelled) {
      message.value = payload.message;
      isError.value = payload.isError;
      visible.value = true;
    }
  } catch {
    // 无载荷或调用失败时保持空白，等待事件推送
  }

  // 窗口复用：后端每次显示都 emit 最新载荷。
  const unlistenFn = await listen<ToastPayload>('toast_show', (event) => {
    if (cancelled) return;
    message.value = event.payload.message;
    isError.value = event.payload.isError;
    visible.value = true;
  });
  // 监听注册期间组件已卸载：立即释放刚注册的监听，避免泄漏。
  if (cancelled) {
    unlistenFn();
    return;
  }
  unlisten = unlistenFn;
});

onUnmounted(() => {
  cancelled = true;
  unlisten?.();
});
</script>

<template>
  <div v-if="visible" class="toast-root" :class="{ 'is-error': isError }">
    <span class="toast-dot" />
    <span class="toast-text">{{ message }}</span>
  </div>
</template>

<style>
/* 非 scoped：强制透明 toast 窗口背景（照 ReminderWindow 的 reminder-window 模式）。
   全局 style.css 的 html/body 背景（皮肤/主题色）会盖住透明窗口形成白底，这里 !important 覆盖。 */
html.toast-window,
html.toast-window body {
  background: transparent !important;
  background-image: none !important;
  background-color: transparent !important;
}
html.toast-window::before {
  display: none !important;
}
</style>

<style scoped>
/* 卡片铺满窗口：去留白，文字居中 */
.toast-root {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  padding: 0 16px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(34, 197, 94, 0.45);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.toast-root.is-error {
  border-color: rgba(239, 68, 68, 0.5);
}

.toast-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
}

.toast-root.is-error .toast-dot {
  background: #ef4444;
}

.toast-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
