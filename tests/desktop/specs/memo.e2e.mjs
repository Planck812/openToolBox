/**
 * 验证 Memo 工具的创建、编辑、搜索主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  const uniqueId = Date.now();
  const noteTitle = `desktop-memo-${uniqueId}`;
  const noteContent = `memo-content-${uniqueId}`;

  await ctx.openTool('memo');
  await ctx.recordStep('已打开备忘录工具');
  await ctx.clickTestId('memo-create-button');
  await ctx.setValueByTestId('memo-title-input', noteTitle);
  await ctx.setValueByTestId('memo-content-input', noteContent);
  await ctx.recordStep('已创建并填写便签');

  await ctx.expectPageContains(noteTitle);
  await ctx.setValueByTestId('memo-search-input', noteTitle);
  await ctx.expectPageContains(noteContent);

  const items = await ctx.browser.$$('[data-testid="memo-list-item"]');
  ctx.assert.equal(items.length, 1, '搜索后应只保留目标便签');
  await ctx.recordStep('已完成便签搜索过滤');

  await ctx.clickTestId('memo-delete-button');
  await ctx.browser.waitUntil(
    async () => (await ctx.browser.$$('[data-testid="memo-list-item"]')).length === 0,
    {
      timeout: 5000,
      timeoutMsg: '删除测试便签后，列表未在预期时间内清空',
    },
  );
  await ctx.recordStep('已删除测试便签并完成清理');

  await ctx.goHome();
}
