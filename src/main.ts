import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import PinWindow from "./tools/screenshot-universal/shared/PinWindow.vue";
import ScrollHud from "./tools/screenshot-universal/shared/ScrollHud.vue";
import OverlayView from "./views/OverlayView.vue";
import ToastRoot from "./components/ToastRoot.vue";
import router from "./router";
import i18n from "./i18n";
import { installGlobalErrorHandler } from './lib/global-error-handler';
import { useAppStore } from './store/app';
import "./style.css";

// Polyfill for global
if (typeof window.global === 'undefined') {
  window.global = window;
}

const label = getCurrentWindow().label;
const isPinWindow = label.startsWith('pin-');
const isOverlayWindow = label.startsWith('overlay-');
const isScrollHud = label.startsWith('scroll-hud-');
const isToastWindow = label === 'toast';
// 主窗口才挂载 Pinia + Router；其余辅助窗口（贴图/覆盖层/滚动提示/独立 toast）只挂 i18n。
const isMainWindow = !isPinWindow && !isOverlayWindow && !isScrollHud && !isToastWindow;
// 覆盖层窗口需要全透明背景（OverlayView 的非 scoped 样式据此生效），
// 在挂载前给 <html> 打上标记，避免首帧白底。
if (isOverlayWindow) {
  document.documentElement.classList.add('overlay-window');
}
if (isScrollHud) {
  document.documentElement.classList.add('scroll-hud-window');
}
if (isToastWindow) {
  document.documentElement.classList.add('toast-window');
}
// ---- 全局错误边界：让生产环境未捕获错误可见、可记录 ----
// Pinia 实例在主窗口分支创建一次并复用（errorHandler 里用它弹 toast）。
const pinia = createPinia();
const { handleError, handleUnhandledRejection } = installGlobalErrorHandler({
  onError: (message) => {
    // 仅主窗口可用 store 弹 toast（Pinia 已挂载且 App.vue 渲染 store.toasts）；
    // 其余辅助窗口只记录日志，不打扰用户。
    if (isMainWindow) {
      try {
        const store = useAppStore(pinia);
        const short = message.length > 120 ? `${message.slice(0, 120)}…` : message;
        store.showToast(`发生未预期错误：${short}`, { type: 'error', durationMs: 5000 });
      } catch {
        // Pinia 未就绪或 store 初始化失败：只记录，不打扰用户
      }
    }
  },
});

const app = createApp(isPinWindow ? PinWindow : isOverlayWindow ? OverlayView : isScrollHud ? ScrollHud : isToastWindow ? ToastRoot : App);

app.config.errorHandler = handleError;

window.addEventListener('unhandledrejection', handleUnhandledRejection);

app.use(i18n);

if (isMainWindow) {
  app.use(pinia);
  app.use(router);
}

app.mount("#app");
