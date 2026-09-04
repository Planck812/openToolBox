/**
 * 验证时间戳工具的输入与转换主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('timestamp');
  await ctx.recordStep('已打开时间戳工具');

  await ctx.setValueByTestId('timestamp-input', '1704067200');
  await ctx.browser.waitUntil(
    async () => ((await (await ctx.browser.$('[data-testid="timestamp-date-result"]')).getText()) || '').includes('2024-01-01 08:00:00'),
    {
      timeout: 5000,
      timeoutMsg: '秒级时间戳未在预期时间内转换为日期',
    },
  );

  const dateText = await (await ctx.expectTestIdVisible('timestamp-date-result')).getText();
  const msText = await (await ctx.expectTestIdVisible('timestamp-ms-result')).getText();
  ctx.assert.match(dateText, /2024-01-01 08:00:00/, '日期结果应转换为本地时间');
  ctx.assert.equal(msText, '1704067200000', '毫秒时间戳结果应正确');
  await ctx.recordStep('已完成时间戳转换断言');

  await ctx.goHome();
}
