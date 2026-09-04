/**
 * 验证图片/Base64 工具的文本转图片预览链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('image-base64');
  await ctx.recordStep('已打开图片 Base64 工具');

  await ctx.setValueByTestId('base64-textarea', 'data:image/png;base64,YWJj');
  await ctx.browser.waitUntil(
    async () => {
      const preview = await ctx.browser.$('[data-testid="image-preview"]');
      if (!(await preview.isExisting())) {
        return false;
      }
      const src = await preview.getAttribute('src');
      return src === 'data:image/png;base64,YWJj';
    },
    {
      timeout: 5000,
      timeoutMsg: '图片预览未在预期时间内出现',
    },
  );

  const preview = await ctx.expectTestIdVisible('image-preview');
  ctx.assert.equal(await preview.getAttribute('src'), 'data:image/png;base64,YWJj', '预览图应回显输入的 Data URL');
  await ctx.recordStep('已完成图片预览断言');

  await ctx.goHome();
}
