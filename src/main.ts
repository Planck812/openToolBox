import './lib/tauri-env';
import { createApp, type Component } from "vue";
import type { Pinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n, { i18nReady } from "./i18n";
import { installGlobalErrorHandler } from './lib/global-error-handler';
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
const isQuickLaunchWindow = label === 'quicklaunch';
// 主窗口才需要 Router；快速唤起只需要 Pinia（工具推荐读 store），
// 其余辅助窗口（贴图/覆盖层/滚动提示/独立 toast）只挂 i18n。
const isMainWindow =
  !isPinWindow && !isOverlayWindow && !isScrollHud && !isToastWindow && !isQuickLaunchWindow;
const needsPinia = isMainWindow || isQuickLaunchWindow;
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

// Pinia 实例在挂载时创建（主窗口 / 快速唤起），错误提示复用同一实例。
let pinia: Pinia | null = null;

/**
 * 主窗口的未捕获错误提示。store 与其依赖的工具注册表按需引入，
 * 辅助窗口不会为了这条兜底路径把它们加载进来。
 */
const showErrorToast = async (message: string) => {
  if (!pinia) return;
  try {
    const { useAppStore } = await import('./store/app');
    const store = useAppStore(pinia);
    const short = message.length > 120 ? `${message.slice(0, 120)}…` : message;
    store.showToast(`发生未预期错误：${short}`, { type: 'error', durationMs: 5000 });
  } catch {
    // Pinia 未就绪或 store 初始化失败：只记录，不打扰用户
  }
};

// ---- 全局错误边界：让生产环境未捕获错误可见、可记录 ----
const { handleError, handleUnhandledRejection } = installGlobalErrorHandler({
  onError: (message) => {
    // 仅主窗口弹 toast（App.vue 渲染 store.toasts）；其余窗口只记录日志，不打扰用户。
    if (isMainWindow) {
      void showErrorToast(message);
    }
  },
});
// 监听同步注册：不等根组件异步加载完，避免启动期的 rejection 漏网。
window.addEventListener('unhandledrejection', handleUnhandledRejection);

/**
 * 根组件按窗口动态加载。
 *
 * 此前五个根组件都是静态 import，于是任何走 index.html 的窗口（toast、快速唤起、
 * 截图覆盖层、滚动 HUD）都要把 App.vue、router 及其整条依赖链下载并解析一遍——
 * 一个气泡提示也要付完整主应用的代价。改为动态引入后，每个窗口只加载自己那一份。
 */
const loadRoot = async (): Promise<Component> => {
  if (isPinWindow) return (await import('./tools/screenshot-universal/shared/PinWindow.vue')).default;
  if (isOverlayWindow) return (await import('./views/OverlayView.vue')).default;
  if (isScrollHud) return (await import('./tools/screenshot-universal/shared/ScrollHud.vue')).default;
  if (isToastWindow) return (await import('./components/ToastRoot.vue')).default;
  if (isQuickLaunchWindow) return (await import('./components/QuickLaunchRoot.vue')).default;
  return (await import('./App.vue')).default;
};

const bootstrap = async () => {
  const [root] = await Promise.all([loadRoot(), i18nReady]);

  const app = createApp(root);
  app.config.errorHandler = handleError;

  app.use(i18n);

  if (needsPinia) {
    const { createPinia } = await import('pinia');
    pinia = createPinia();
    app.use(pinia);
  }
  if (isMainWindow) {
    app.use((await import('./router')).default);
  }

  app.mount("#app");
};

void bootstrap();
