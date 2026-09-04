import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

/** 依据浏览器/系统语言选择默认语言：中文环境 → zh-CN，其余 → en-US。 */
function detectLocale(): string {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const lang = (navigator.language ?? '').toLowerCase();
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US';
}

const i18n = createI18n({
  legacy: false, // Use Composition API
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export default i18n;
