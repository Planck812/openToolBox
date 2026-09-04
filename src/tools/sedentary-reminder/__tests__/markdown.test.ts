import { describe, expect, it } from 'vitest';
import { renderMessage } from '../markdown';
import { sedentaryReminderTool } from '../index';

describe('renderMessage 久坐提醒文案渲染', () => {
  it('纯文本原样渲染', () => {
    const html = renderMessage('久坐提醒，起来活动一下');

    expect(html).toContain('久坐提醒，起来活动一下');
  });

  it('渲染 Markdown 常用语法', () => {
    const html = renderMessage('**粗体** 和 *斜体*，以及 `行内代码`');

    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<code>行内代码</code>');
  });

  it('渲染 Markdown 标题', () => {
    expect(renderMessage('# 一级标题')).toContain('<h1>一级标题</h1>');
    expect(renderMessage('## 二级标题')).toContain('<h2>二级标题</h2>');
  });

  it('保留内联 HTML 子集（b/span 等）', () => {
    const html = renderMessage('<b>加粗</b> 与 <span style="color:red">红字</span>');

    expect(html).toContain('<b>加粗</b>');
    expect(html).toContain('<span style="color:red">红字</span>');
  });

  it('剥离 script 标签', () => {
    const html = renderMessage('before<script>alert(1)</script>after');

    expect(html).not.toContain('<script');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('剥离事件处理属性', () => {
    const html = renderMessage('<p onclick="alert(1)">hello</p>');

    expect(html).not.toContain('onclick');
    expect(html).toContain('hello');
  });

  it('剥离 javascript: 协议链接', () => {
    const html = renderMessage('<a href="javascript:alert(1)">点我</a>');

    expect(html).not.toContain('javascript:');
    expect(html).toContain('点我');
  });
});

describe('sedentaryReminderTool matcher', () => {
  it('命中关键词返回固定分数', () => {
    for (const keyword of ['久坐', '提醒', '起身', 'sedentary', 'break', '休息', '活动']) {
      const result = sedentaryReminderTool.match(keyword);
      expect(result).toEqual({ toolId: 'sedentary-reminder', score: 90 });
    }
  });

  it('大小写不敏感匹配英文关键词', () => {
    expect(sedentaryReminderTool.match('SEDENTARY')).toEqual({ toolId: 'sedentary-reminder', score: 90 });
  });

  it('关键词位于长句中也匹配', () => {
    expect(sedentaryReminderTool.match('每 45 分钟提醒我起身活动')).toEqual({
      toolId: 'sedentary-reminder',
      score: 90,
    });
  });

  it('无关输入与空输入不匹配', () => {
    expect(sedentaryReminderTool.match('hello world')).toBeNull();
    expect(sedentaryReminderTool.match('')).toBeNull();
    expect(sedentaryReminderTool.match('   ')).toBeNull();
  });
});
