import { createI18n } from 'vue-i18n';

/** 文案结构以中文包为准（两份语言包 key 完全一致）。type-only 引用，不产生运行时代码。 */
type MessageSchema = typeof import('./locales/zh-CN.json');

/** 依据浏览器/系统语言选择默认语言：中文环境 → zh-CN，其余 → en-US。 */
function detectLocale(): 'zh-CN' | 'en-US' {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const lang = (navigator.language ?? '').toLowerCase();
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US';
}

const locale = detectLocale();

// 只加载当前语言的文案。两份语言包各 1670 条 key、双向无缺失，故 fallback 指向自身，
// 不必为了兜底把另一份也读进内存——每个窗口都是独立 WebView，省下的是
// 「87 KB JSON 解析后的常驻对象 × 窗口数」。
const i18n = createI18n({
  legacy: false, // Use Composition API
  locale,
  fallbackLocale: locale,
  messages: {} as Record<string, MessageSchema>,
});

/**
 * 文案就绪信号：各窗口入口必须 `await` 之后再 mount，否则首帧会把 key 原样渲染出来。
 */
export const i18nReady: Promise<void> = (async () => {
  try {
    const mod =
      locale === 'zh-CN'
        ? await import('./locales/zh-CN.json')
        : await import('./locales/en-US.json');
    // 打包后 JSON 是带 default 的 ES 模块，而 TS 给 JSON 模块的类型里没有 default，
    // 两种形态都兜住。
    const messages = (mod as MessageSchema & { default?: MessageSchema }).default ?? mod;
    i18n.global.setLocaleMessage(locale, messages);
  } catch (error) {
    // 各入口都在等这个信号才挂载：绝不能让它 reject，否则整个窗口白屏。
    // 退化结果是界面显示文案 key，仍可操作。
    console.error('[i18n] 语言包加载失败，界面将显示文案 key', error);
  }
})();

export default i18n;
