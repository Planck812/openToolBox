/**
 * 验证文本处理工具的默认处理链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('text-processor');
  await ctx.recordStep('已打开文本处理工具');

  await ctx.setValueByTestId('text-processor-input', 'hello codex');
  await ctx.clickTestId('text-processor-process-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.getValueByTestId('text-processor-output')) === 'HELLO CODEX',
    {
      timeout: 5000,
      timeoutMsg: '文本处理结果未在预期时间内产出',
    },
  );

  const output = await ctx.getValueByTestId('text-processor-output');
  ctx.assert.equal(output, 'HELLO CODEX', '默认大写转换应输出全大写文本');
  await ctx.recordStep('已完成文本处理断言');

  await ctx.goHome();
}
