/**
 * 验证 Mermaid 工具的默认渲染链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('mermaid-preview');
  await ctx.recordStep('已打开 Mermaid 工具');

  await ctx.setValueByTestId('mermaid-source-input', `graph TD
A[开始] --> B[结束]`);
  await ctx.browser.waitUntil(
    async () => (await ctx.browser.$('[data-testid="mermaid-preview-svg-shell"] svg')).isExisting(),
    {
      timeout: 10000,
      timeoutMsg: 'Mermaid 预览 SVG 未在预期时间内渲染',
    },
  );

  await ctx.clickTestId('mermaid-zoom-in-button');
  await ctx.clickTestId('mermaid-reset-button');
  ctx.assert.equal(await (await ctx.browser.$('[data-testid="mermaid-preview-svg-shell"] svg')).isExisting(), true, 'Mermaid 预览 SVG 应持续可见');
  await ctx.recordStep('已完成 Mermaid 渲染断言');

  await ctx.goHome();
}
