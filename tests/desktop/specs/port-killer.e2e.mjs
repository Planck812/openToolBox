import { once } from 'node:events';
import { spawn } from 'node:child_process';

async function startListeningChild() {
  const bootstrap = "const net=require('node:net');const server=net.createServer(()=>{});server.listen(0,'127.0.0.1',()=>{const address=server.address();process.stdout.write(JSON.stringify({port:address.port})+'\\n');});setInterval(()=>{},1000);";
  const child = spawn(
    process.execPath,
    [
      '-e',
      bootstrap,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const data = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('端口测试子进程未在预期时间内输出端口号')), 5000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const line = buffer.split(/\r?\n/).find(Boolean);
      if (!line) {
        return;
      }
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`端口测试子进程提前退出: ${code}`));
    });
  });

  return { child, port: data.port };
}

/**
 * 验证端口工具的扫描与结束进程主链路。
 * @param {ReturnType<import('../support/session.mjs').createDesktopSession>} ctx
 */
export async function runDesktopSpec(ctx) {
  const { child, port } = await startListeningChild();

  try {
    await ctx.openTool('port-killer');
    await ctx.recordStep('已打开端口清理工具');

    await ctx.setValueByTestId('port-killer-port-input', String(port));
    await ctx.clickTestId('port-killer-scan-button');
    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="port-killer-entry-item"]')).length > 0,
      {
        timeout: 10000,
        timeoutMsg: '端口扫描结果未在预期时间内出现',
      },
    );

    await ctx.expectPageContains(`PID ${child.pid}`);
    await ctx.recordStep('已扫描到测试端口占用');

    await ctx.clickTestId('port-killer-kill-one-button');
    await once(child, 'exit');
    await ctx.browser.waitUntil(
      async () => (await ctx.browser.$$('[data-testid="port-killer-entry-item"]')).length === 0,
      {
        timeout: 10000,
        timeoutMsg: '结束测试进程后端口列表未清空',
      },
    );
    await ctx.recordStep('已结束测试端口进程并刷新列表');

    await ctx.goHome();
  } finally {
    if (!child.killed) {
      child.kill();
    }
  }
}
