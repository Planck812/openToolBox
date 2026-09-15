/**
 * 贴图窗口精简入口：只挂载 PinWindow，不加载主应用的 App/router/pinia/全量样式。
 *
 * 独立入口显著减少贴图窗口的加载时间（主应用入口要解析 App.vue、路由、store、
 * 全局皮肤系统等，PinWindow 只用 i18n）。
 */
import { createApp } from 'vue';
import PinWindow from './tools/screenshot-universal/shared/PinWindow.vue';
import i18n, { i18nReady } from './i18n';
import { installGlobalErrorHandler } from './lib/global-error-handler';

// 与主入口一致的 polyfill
if (typeof window.global === 'undefined') {
  window.global = window;
}

const { handleError, handleUnhandledRejection } = installGlobalErrorHandler();
const app = createApp(PinWindow);
app.config.errorHandler = handleError;
window.addEventListener('unhandledrejection', handleUnhandledRejection);
app.use(i18n);
// 文案按当前语言异步加载，就绪后再挂载，避免首帧把 key 原样渲染出来。
void i18nReady.then(() => app.mount('#app'));
