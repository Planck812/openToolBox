/**
 * 验证文本合并工具的输入与输出链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('text-join');
  await ctx.recordStep('已打开文本合并工具');

  const inputText = `left
right`;

  await ctx.setValueByTestId('text-join-input', inputText);
  await ctx.clickTestId('text-join-merge-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.getValueByTestId('text-join-output')) === 'left,right',
    {
      timeout: 5000,
      timeoutMsg: '文本合并结果未在预期时间内产出',
    },
  );

  const output = await ctx.getValueByTestId('text-join-output');
  ctx.assert.equal(output, 'left,right', '合并结果应使用默认逗号分隔');
  await ctx.recordStep('已完成文本合并断言');

  await ctx.goHome();
}
