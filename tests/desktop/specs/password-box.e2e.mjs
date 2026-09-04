import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const passwordBoxFilePath = path.join(process.env.USERPROFILE || os.homedir(), '.smtPwdBox.json');

async function withPasswordBoxBackup(run) {
  let originalContent = null;
  let existed = false;

  try {
    originalContent = await fs.readFile(passwordBoxFilePath, 'utf8');
    existed = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    await run();
  } finally {
    if (existed) {
      await fs.writeFile(passwordBoxFilePath, originalContent, 'utf8');
    } else {
      await fs.rm(passwordBoxFilePath, { force: true });
    }
  }
}

/**
 * 验证密码夹的新增、搜索、显示密码、编辑、删除与本地文件同步主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  const uniqueId = Date.now();
  const site = `desktop-password-${uniqueId}.example.com`;
  const username = `user-${uniqueId}`;
  const password = `secret-${uniqueId}`;
  const note = `note-${uniqueId}`;
  const updatedNote = `${note}-edited`;

  await withPasswordBoxBackup(async () => {
    await ctx.openTool('pwd-box');
    await ctx.recordStep('已打开密码夹工具');

    await ctx.clickTestId('pwd-box-create-button');
    await ctx.setValueByTestId('pwd-box-site-input', site);
    await ctx.setValueByTestId('pwd-box-username-input', username);
    await ctx.setValueByTestId('pwd-box-password-input', password);
    await ctx.setValueByTestId('pwd-box-note-input', note);
    await ctx.expectPageContains(site);
    await ctx.expectPageContains(username);
    await ctx.recordStep('已创建密码记录');

    await ctx.browser.waitUntil(
      async () => {
        const content = await fs.readFile(passwordBoxFilePath, 'utf8').catch(() => '');
        // 加密落盘：文件以 `v1:` 开头，且不得出现明文敏感字段。
        return content.startsWith('v1:') && !content.includes(site) && !content.includes(note);
      },
      {
        timeout: 5000,
        timeoutMsg: '密码夹文件未在预期时间内以密文写入新增记录',
      },
    );
    await ctx.recordStep('已确认本地文件写入');

    await ctx.setValueByTestId('pwd-box-search-input', note);
    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="pwd-box-list-item"]')).length === 1,
      {
        timeout: 5000,
        timeoutMsg: '按备注搜索后未收敛到单条记录',
      },
    );
    await ctx.recordStep('已完成备注搜索');

    await ctx.setValueByTestId('pwd-box-search-input', site);
    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="pwd-box-list-item"]')).length === 1,
      {
        timeout: 5000,
        timeoutMsg: '按网站搜索后未收敛到单条记录',
      },
    );
    await ctx.recordStep('已完成网站搜索');

    await ctx.clickTestId('pwd-box-toggle-visibility');
    await ctx.expectPageContains(password);
    await ctx.recordStep('已显示密码明文');

    const beforeEdit = await fs.readFile(passwordBoxFilePath, 'utf8').catch(() => '');
    await ctx.setValueByTestId('pwd-box-note-input', updatedNote);
    await ctx.browser.waitUntil(
      async () => {
        const content = await fs.readFile(passwordBoxFilePath, 'utf8').catch(() => '');
        // 密文内容发生变化（写已发生），且仍为密文、不含明文备注。
        return content.startsWith('v1:') && content !== beforeEdit && !content.includes(updatedNote);
      },
      {
        timeout: 5000,
        timeoutMsg: '编辑备注后，本地密文未同步更新',
      },
    );
    await ctx.recordStep('已编辑备注并同步到本地文件');

    await ctx.clickTestId('pwd-box-delete-button');
    await ctx.browser.waitUntil(
      async () => await ctx.browser.isAlertOpen(),
      {
        timeout: 5000,
        timeoutMsg: '删除确认框未出现',
      },
    );
    await ctx.browser.acceptAlert();
    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="pwd-box-list-item"]')).length === 0,
      {
        timeout: 5000,
        timeoutMsg: '删除记录后，过滤列表未在预期时间内清空',
      },
    );
    await ctx.browser.waitUntil(
      async () => {
        const content = await fs.readFile(passwordBoxFilePath, 'utf8').catch(() => '');
        return content.startsWith('v1:') && !content.includes(site);
      },
      {
        timeout: 5000,
        timeoutMsg: '删除记录后，本地密文仍保留目标网站',
      },
    );
    await ctx.recordStep('已删除记录并完成本地清理');

    await ctx.goHome();
  });
}
