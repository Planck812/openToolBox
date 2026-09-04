/**
 * 验证 JSON Diff 工具的对比主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('json-diff');
  await ctx.recordStep('已打开 JSON Diff 工具');

  await ctx.setValueByTestId('json-diff-input-a', '{"user":{"name":"old"}}');
  await ctx.setValueByTestId('json-diff-input-b', '{"user":{"name":"new"}}');
  await ctx.clickTestId('json-diff-compare-button');

  await ctx.expectTestIdVisible('json-diff-result');
  await ctx.expectPageContains('/user/name');
  await ctx.expectPageContains('VALUE_MISMATCH');
  await ctx.recordStep('已完成 JSON Diff 断言');

  await ctx.goHome();
}
