import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
});

/**
 * Strips script tags, iframe, object, embed, and all inline event handlers.
 */
export function sanitizeHtml(dirtyHtml: string): string {
  return DOMPurify.sanitize(dirtyHtml, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur',
      'onchange',
      'onsubmit',
    ],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Renders Markdown source code to sanitized HTML string.
 */
export function renderMarkdown(markdownText: string): string {
  const rawHtml = md.render(markdownText);
  return sanitizeHtml(rawHtml);
}
