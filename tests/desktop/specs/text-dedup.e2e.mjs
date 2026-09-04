/**
 * 验证文本去重工具的去重主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('text-dedup');
  await ctx.recordStep('已打开文本去重工具');

  const inputText = `A
a
b`;
  const expectedOutput = `A
b`;

  await ctx.setValueByTestId('text-dedup-input', inputText);
  await ctx.clickTestId('text-dedup-run-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.getValueByTestId('text-dedup-output')) === expectedOutput,
    {
      timeout: 5000,
      timeoutMsg: '文本去重结果未在预期时间内产出',
    },
  );

  const output = await ctx.getValueByTestId('text-dedup-output');
  ctx.assert.equal(output, expectedOutput, '默认去重应忽略大小写并保留顺序');
  await ctx.recordStep('已完成文本去重断言');

  await ctx.goHome();
}
