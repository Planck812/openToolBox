/**
 * 验证文本拆分工具的输入与输出链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('text-split');
  await ctx.recordStep('已打开文本拆分工具');

  const expectedOutput = `alpha
beta
gamma`;

  await ctx.setValueByTestId('text-split-input', 'alpha,beta,gamma');
  await ctx.clickTestId('text-split-convert-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.getValueByTestId('text-split-output')) === expectedOutput,
    {
      timeout: 5000,
      timeoutMsg: '文本拆分结果未在预期时间内产出',
    },
  );

  const output = await ctx.getValueByTestId('text-split-output');
  ctx.assert.equal(output, expectedOutput, '拆分结果应按行输出');
  await ctx.recordStep('已完成文本拆分断言');

  await ctx.goHome();
}
