/**
 * 验证 JWT 工具在真实桌面环境中的签发与解析链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  await ctx.openTool('jwt-tool');
  await ctx.recordStep('已打开 JWT 工具');
  await ctx.setValueByTestId('key-text', 'desktop-secret');
  await ctx.recordStep('已输入 JWT 密钥');
  await ctx.clickTestId('sign-btn');

  const jwtValue = await ctx.getValueByTestId('jwt-input');
  ctx.assert.equal(jwtValue.split('.').length, 3, '签发后的 JWT 应为三段式');

  const headerText = await ctx.getValueByTestId('header-text');
  const payloadText = await ctx.getValueByTestId('payload-text');
  ctx.assert.match(headerText, /HS256/, 'Header 应包含 HS256');
  ctx.assert.match(payloadText, /codex/, 'Payload 应包含默认示例字段');
  await ctx.recordStep('JWT 已签发并完成断言');

  await ctx.goHome();
}
