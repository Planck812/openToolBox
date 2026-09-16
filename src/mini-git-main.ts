import './lib/tauri-env';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import MiniGitApp from './mini-git/App.vue';
import router from './mini-git/router';
import i18n, { i18nReady } from './i18n';
import { installGlobalErrorHandler } from './lib/global-error-handler';
import './style.css';
import { applyThemeMode, getThemeSkin, readStoredThemeSkinId } from './lib/theme';

// 独立 WebView 不共享主窗口的 <html> 标记，必须自行应用主题；
// 放在挂载前执行，避免首帧闪一下亮色。
// 推导方式与 src/store/app.ts 的初始化保持一致（由皮肤的 recommendedMode 决定明暗）。
const initialSkinId = readStoredThemeSkinId();
applyThemeMode(getThemeSkin(initialSkinId).recommendedMode, initialSkinId);

if (typeof window.global === 'undefined') {
  window.global = window;
}

const pinia = createPinia();
const { handleError, handleUnhandledRejection } = installGlobalErrorHandler();

const app = createApp(MiniGitApp);
app.config.errorHandler = handleError;
window.addEventListener('unhandledrejection', handleUnhandledRejection);

app.use(pinia);
app.use(router);
app.use(i18n);

// 文案按当前语言异步加载，就绪后再挂载，避免首帧把 key 原样渲染出来。
void i18nReady.then(() => app.mount('#app'));
