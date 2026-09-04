/**
 * 验证二维码工具的桌面主链路：生成、复制，以及切换到识别页的真实冒烟。
 * 图片粘贴与剪贴板回退由 Vitest 组件测试稳定覆盖，避免桌面驱动抖动导致误报。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  const expectedText = 'https://example.com/codex-desktop';

  await ctx.openTool('qrcode-gen');
  await ctx.recordStep('已打开二维码工具');

  await ctx.setValueByTestId('qrcode-generate-input', expectedText);
  await ctx.browser.waitUntil(
    async () => {
      const image = await ctx.browser.$('[data-testid="qrcode-result-image"]');
      if (!(await image.isExisting())) {
        return false;
      }
      const src = await image.getAttribute('src');
      return typeof src === 'string' && src.startsWith('data:image/');
    },
    {
      timeout: 8000,
      timeoutMsg: '二维码图片未在预期时间内生成',
    },
  );

  const image = await ctx.expectTestIdVisible('qrcode-result-image');
  const src = await image.getAttribute('src');
  ctx.assert.ok(src?.startsWith('data:image/'), '二维码结果应为可展示的图片 Data URL');
  await ctx.recordStep('已完成二维码生成断言');

  const copyButton = await ctx.expectVisible('button[title="复制图片"]');
  await copyButton.click();
  await ctx.browser.waitUntil(
    async () => {
      const source = await ctx.browser.getPageSource();
      return source.includes('图片已复制到剪贴板') || source.includes('复制失败');
    },
    {
      timeout: 8000,
      timeoutMsg: '二维码复制后未出现成功或失败提示',
    },
  );

  const pageSource = await ctx.browser.getPageSource();
  ctx.assert.ok(pageSource.includes('图片已复制到剪贴板'), '二维码复制后出现了失败提示');
  await ctx.recordStep('已完成二维码复制断言');

  const recognizeButton = await ctx.expectVisible('button=识别');
  await recognizeButton.click();
  await ctx.expectTestIdVisible('recognition-upload-panel');
  await ctx.expectTestIdVisible('recognition-merged-panel');
  await ctx.expectPageContains('粘贴图片或上传本地图片');
  await ctx.recordStep('已切换到识别页并完成冒烟断言');

  await ctx.goHome();
}
