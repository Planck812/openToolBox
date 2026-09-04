/**
 * 验证计算器工具的基础计算链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('calculator');
  await ctx.recordStep('已打开计算器工具');

  await (await ctx.waitForSelector('[data-key="7"]')).click();
  await (await ctx.waitForSelector('[data-key="*"]')).click();
  await (await ctx.waitForSelector('[data-key="8"]')).click();
  await (await ctx.waitForSelector('[data-key="="]')).click();

  await ctx.browser.waitUntil(
    async () => (await (await ctx.waitForSelector('[data-display-result]')).getText()).includes('56'),
    {
      timeout: 5000,
      timeoutMsg: '计算器结果未在预期时间内显示 56',
    },
  );

  const result = await (await ctx.waitForSelector('[data-display-result]')).getText();
  ctx.assert.match(result, /56/, '7 * 8 应得到 56');
  await ctx.recordStep('已完成计算器断言');

  await ctx.goHome();
}
