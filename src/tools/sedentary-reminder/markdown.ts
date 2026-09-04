/**
 * 久坐提醒文案富文本渲染（工具页与弹窗共用）。
 *
 * 用户文案按 Markdown + 内联 HTML 子集渲染（markdown-it `html: true`），
 * 渲染结果必须经 DOMPurify 净化后才可用于 v-html（遵循前端组件规范
 * 「不得向 v-html 传入未经净化内容」，与 MermaidPreview 的净化链一致）。
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

/** markdown-it 单例：允许内联 HTML 子集，渲染后统一由 DOMPurify 兜底净化。 */
const md = new MarkdownIt({ html: true });

/**
 * 把纯文本/富文本文案渲染为净化后的 HTML。
 *
 * 净化走 DOMPurify 默认规则：剥离 script、on* 事件等危险内容，允许
 * style/span/b 等内联样式标签。纯文本输入渲染结果与原文一致，无回归。
 */
export const renderMessage = (raw: string): string => {
  return DOMPurify.sanitize(md.render(raw));
};
