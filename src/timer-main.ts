/**
 * 计时弹窗精简入口：只挂载 TimerAlert，不加载主应用的 App/router/pinia/全量样式。
 *
 * 独立入口减少弹窗窗口加载时间（复用 reminder-main 的精简入口模式）。
 * 窗口 label = `timer-alert-{kind}-{id}`，TimerAlert 解析 label 得知 kind/id，
 * 再向后端 `timer_get_alert` 读取渲染载荷。
 */
import './lib/tauri-env';
import { createApp } from 'vue';
import TimerAlert from './tools/timer-center/TimerAlert.vue';
import i18n from './i18n';
import { installGlobalErrorHandler } from './lib/global-error-handler';

// 与主入口一致的 polyfill
if (typeof window.global === 'undefined') {
  window.global = window;
}

// 标记透明弹窗窗口：全局 style.css 的 html/body 背景色会盖住透明窗口，
// TimerAlert 的非 scoped 样式据此把 html/body 强制透明。
document.documentElement.classList.add('timer-window');

// 重置 body：去掉默认 margin（消除缝隙）+ 隐藏页面滚动条（弹窗铺满）。
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
const app = createApp(TimerAlert);
app.config.errorHandler = handleError;
window.addEventListener('unhandledrejection', handleUnhandledRejection);
app.use(i18n);
app.mount('#app');
