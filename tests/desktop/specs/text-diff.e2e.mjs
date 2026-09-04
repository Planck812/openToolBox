/**
 * 验证 Text Diff 工具的输入、筛选与交换链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('text-diff');
  await ctx.recordStep('已打开文本 Diff 工具');
  await ctx.setValueByTestId('text-diff-left-input', 'alpha\nbeta');
  await ctx.setValueByTestId('text-diff-right-input', 'alpha\ngamma');
  await ctx.recordStep('已输入左右两侧文本');

  let rows = await ctx.browser.$$('[data-testid="diff-row"]');
  ctx.assert.equal(rows.length, 2, '初始应渲染两行 diff');

  const toggle = await ctx.expectTestIdVisible('toggle-only-changes');
  await toggle.click();
  rows = await ctx.browser.$$('[data-testid="diff-row"]');
  ctx.assert.equal(rows.length, 1, '只看变更后应仅保留一行');
  await ctx.recordStep('已切换为只看变更');

  await ctx.clickTestId('swap-button');
  const leftValue = await ctx.getValueByTestId('text-diff-left-input');
  const rightValue = await ctx.getValueByTestId('text-diff-right-input');
  ctx.assert.equal(leftValue, 'alpha\ngamma', '交换后左侧应为原右侧内容');
  ctx.assert.equal(rightValue, 'alpha\nbeta', '交换后右侧应为原左侧内容');
  await ctx.recordStep('已完成文本交换并断言');

  await ctx.goHome();
}
