/**
 * 验证应用可以在真实桌面环境正常启动并显示首页。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.expectTestIdVisible('home-view', 20000);
  await ctx.recordStep('首页已加载');
  await ctx.expectTestIdVisible('tool-grid');
  await ctx.expectTestIdVisible('tool-card-jwt-tool');
  await ctx.expectTestIdVisible('tool-card-memo');
  await ctx.expectTestIdVisible('tool-card-text-diff');
  await ctx.recordStep('首页工具列表已显示');
}
