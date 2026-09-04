/**
 * 验证 JSON Viewer 工具可以在桌面端正常打开并渲染编辑区。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('json-viewer');
  await ctx.recordStep('已打开 JSON Viewer 工具');

  await ctx.expectTestIdVisible('json-viewer-root');
  await ctx.expectTestIdVisible('json-viewer-content');
  const editorRoot = await ctx.waitForSelector('.jse-main');
  await editorRoot.waitForDisplayed({ timeout: 10000 });

  const editableNodes = await ctx.browser.$$('[contenteditable="true"], .cm-content, .jse-main textarea');
  ctx.assert.ok(editableNodes.length > 0, 'JSON Viewer 应渲染可编辑区域');
  await ctx.recordStep('JSON 编辑区已渲染');

  await ctx.goHome();
}
