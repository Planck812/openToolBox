/**
 * Windows 注册表写入回归只使用此固定临时变量，绝不读取或输出其他环境变量。
 */
const TEST_ENV_KEY = 'OPEN_TOOLBOX_E2E_QUOTE_TEST';
const TEST_ENV_VALUE = 'GG';

async function deleteTestVariableAndConfirmAbsent(ctx) {
  const cleanupResult = await ctx.browser.executeAsync((done) => {
    const requestEvent = 'open-toolbox:desktop-e2e:env-setter-cleanup';
    const resultEvent = 'open-toolbox:desktop-e2e:env-setter-cleanup-result';
    const timeout = window.setTimeout(() => {
      window.removeEventListener(resultEvent, onResult);
      done({ ok: false, exists: true });
    }, 10000);
    const onResult = (event) => {
      window.clearTimeout(timeout);
      window.removeEventListener(resultEvent, onResult);
      const detail = event instanceof CustomEvent ? event.detail : null;
      done({ ok: detail?.ok === true, exists: detail?.exists === true });
    };

    window.addEventListener(resultEvent, onResult, { once: true });
    window.dispatchEvent(new Event(requestEvent));
  });

  ctx.assert.deepEqual(
    cleanupResult,
    { ok: true, exists: false },
    '专用测试变量清理必须成功且确认变量不存在',
  );
}

/**
 * 验证 UI 写入不会将 GG 保存成字面量 "GG"，并始终清理专用临时变量。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  // Do not let the runner capture a partially loaded, unfiltered environment list.
  ctx.setAutomaticScreenshotsAllowed(false);
  let scenarioError = null;

  try {
    await ctx.openTool('env-setter');
    // 先清理上次异常中断的残留；此时自动截图仍被禁用。
    await deleteTestVariableAndConfirmAbsent(ctx);

    // 过滤必须早于任何环境变量列表断言或截图。
    await ctx.setValueByTestId('env-setter-list-filter', TEST_ENV_KEY);
    ctx.setAutomaticScreenshotsAllowed(true);
    await ctx.expectTestIdVisible('env-setter-list-empty', 20000);

    await ctx.setValueByTestId('env-setter-key-input', TEST_ENV_KEY);
    await ctx.setValueByTestId('env-setter-value-input', TEST_ENV_VALUE);
    await ctx.clickTestId('env-setter-submit-button');

    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="env-setter-variable-row"]')).length === 1,
      {
        timeout: 10000,
        timeoutMsg: '写入后筛选列表未刷新为专用临时变量',
      },
    );

    const filteredRows = await ctx.browser.$$('[data-testid="env-setter-variable-row"]');
    await filteredRows[0].click();
    ctx.assert.equal(
      await ctx.getValueByTestId('env-setter-key-input'),
      TEST_ENV_KEY,
      '筛选后的测试条目应回填固定 KEY',
    );
    ctx.assert.equal(
      await ctx.getValueByTestId('env-setter-value-input'),
      TEST_ENV_VALUE,
      '筛选后的测试条目回填 VALUE 必须严格等于 GG',
    );

    // “读取当前值”通过产品 get_env_var command 从 HKCU\Environment 原始 REG_SZ 值回读。
    await ctx.clickTestId('env-setter-read-button');
    const currentValue = await ctx.expectTestIdVisible('env-setter-current-value');
    const currentValueText = await (await currentValue.$('pre')).getText();
    ctx.assert.equal(currentValueText, TEST_ENV_VALUE, '注册表原始值必须严格等于 GG');
    ctx.assert.notEqual(currentValueText, '"GG"', '注册表原始值不得包含多余双引号');

    // 当前列表已固定筛选为专用变量，截图只会包含测试 KEY 和 GG。
    await ctx.recordStep('GG 已原样写入并从后端严格回读', 'env-setter-quote-test');
  } catch (error) {
    scenarioError = error;
  } finally {
    try {
      await deleteTestVariableAndConfirmAbsent(ctx);
    } catch (cleanupError) {
      // Preserve both failures: neither a test failure nor a registry residue may be hidden.
      if (scenarioError) {
        throw new AggregateError(
          [scenarioError, cleanupError],
          '环境变量写入场景失败，且专用测试变量清理失败',
        );
      }
      throw cleanupError;
    }
  }

  if (scenarioError) {
    throw scenarioError;
  }
}
