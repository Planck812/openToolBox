/**
 * 验证 UUID 工具的生成主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('uuid-generator');
  await ctx.recordStep('已打开 UUID 工具');

  await ctx.setValueByTestId('uuid-count-input', '3');
  await ctx.clickTestId('uuid-generate-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.getValueByTestId('uuid-output-textarea')).trim().split('\n').filter(Boolean).length === 3,
    {
      timeout: 5000,
      timeoutMsg: 'UUID 输出未在预期时间内生成 3 条结果',
    },
  );

  const lines = (await ctx.getValueByTestId('uuid-output-textarea')).trim().split('\n').filter(Boolean);
  ctx.assert.equal(lines.length, 3, 'UUID 结果区应包含 3 条记录');
  await ctx.recordStep('已完成 UUID 生成断言');

  await ctx.goHome();
}
