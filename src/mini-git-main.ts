import './lib/tauri-env';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import MiniGitApp from './mini-git/App.vue';
import router from './mini-git/router';
import i18n from './i18n';
import { installGlobalErrorHandler } from './lib/global-error-handler';
import './style.css';

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

app.mount('#app');
