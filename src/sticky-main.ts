/**
 * 便利贴窗口精简入口：只挂载 StickyNote，不加载主应用的 App/router/pinia/全量样式。
 *
 * 独立入口减少便利贴窗口加载时间（复用 pin 的精简入口模式）。
 */
import './lib/tauri-env';
import { createApp } from 'vue';
import StickyNote from './tools/sticky-note/StickyNote.vue';
import i18n from './i18n';
import { installGlobalErrorHandler } from './lib/global-error-handler';

// 与主入口一致的 polyfill
if (typeof window.global === 'undefined') {
  window.global = window;
}

// 重置 body：去掉默认 margin（消除缝隙）+ 隐藏页面滚动条（便利贴方形铺满）。
const style = document.createElement('style');
style.textContent = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    width: 100%;
    height: 100%;
  }
  body {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  body::-webkit-scrollbar {
    display: none;
  }
  #app {
    width: 100%;
    height: 100%;
  }
`;
document.head.appendChild(style);

const { handleError, handleUnhandledRejection } = installGlobalErrorHandler();
const app = createApp(StickyNote);
app.config.errorHandler = handleError;
window.addEventListener('unhandledrejection', handleUnhandledRejection);
app.use(i18n);
app.mount('#app');
