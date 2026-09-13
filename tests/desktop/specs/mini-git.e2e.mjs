/**
 * 验证 Mini-Git 工具卡片可点击启动独立窗口及渲染引导界面。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('mini-git');
  await ctx.recordStep('已打开 Mini-Git 工具卡片');

  await ctx.expectPageContains('Mini-Git (Git 审阅器)');
  await ctx.recordStep('已显示 Mini-Git 启动界面与常驻提示');

  await ctx.goHome();
}
