import { describe, it, expect } from 'vitest';
import { renderMarkdown, sanitizeHtml } from '../markdownSanitize';

describe('markdownSanitize', () => {
  it('renders standard markdown headings and lists', () => {
    const md = '# Title\n\n- Item 1\n- Item 2';
    const html = renderMarkdown(md);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>Item 1</li>');
  });

  it('strips <script> tags and inline onerror event handlers', () => {
    const dirty = '<div>Hello <script>alert("xss")</script><img src="x" onerror="alert(1)" /></div>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('alert("xss")');
    expect(clean).not.toContain('onerror');
  });

  it('strips iframe and object tags', () => {
    const dirty = '<iframe src="https://evil.com"></iframe><object data="test"></object>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
  });
});
