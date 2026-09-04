import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { remote } from 'webdriverio';
import { download as downloadEdgeDriver } from 'edgedriver';
import { createDesktopSession } from './support/session.mjs';
import { writeDesktopRunReport } from './support/report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const artifactsDir = path.resolve(projectRoot, 'tests', 'desktop', 'artifacts');
const tauriDriverPath = process.env.TAURI_DRIVER_PATH || path.join(process.env.USERPROFILE || '', '.cargo', 'bin', 'tauri-driver.exe');
const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.resolve(projectRoot, 'src-tauri', 'target');
const requestedSpec = parseSelectedSpec();
const runningStandardSuite = process.env.DESKTOP_TEST_INTERNAL_SKIP_ENV_SETTER === '1';
const desktopBuildProfile = requestedSpec === 'env-setter' ? 'debug' : 'release';
const appExecutablePath = path.resolve(cargoTargetDir, desktopBuildProfile, 'open-toolbox.exe');
const tauriDriverPort = 4444;
const nativeDriverPort = 4445;
const buildWatchPaths = [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tailwind.config.js',
  'postcss.config.js',
  'public',
  'src',
  'src-tauri',
];

const specs = [
  {
    name: 'app-launch',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'app-launch.e2e.mjs'),
  },
  {
    name: 'calculator',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'calculator.e2e.mjs'),
  },
  {
    name: 'env-setter',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'env-setter.e2e.mjs'),
  },
  {
    name: 'image-base64',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'image-base64.e2e.mjs'),
  },
  {
    name: 'json-diff',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'json-diff.e2e.mjs'),
  },
  {
    name: 'json-viewer',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'json-viewer.e2e.mjs'),
  },
  {
    name: 'jwt',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'jwt.e2e.mjs'),
  },
  {
    name: 'memo',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'memo.e2e.mjs'),
  },
  {
    name: 'password-box',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'password-box.e2e.mjs'),
  },
  {
    name: 'mermaid-preview',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'mermaid-preview.e2e.mjs'),
  },
  {
    name: 'port-killer',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'port-killer.e2e.mjs'),
  },
  {
    name: 'qrcode-gen',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'qrcode-gen.e2e.mjs'),
  },
  {
    name: 'text-dedup',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'text-dedup.e2e.mjs'),
  },
  {
    name: 'text-diff',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'text-diff.e2e.mjs'),
  },
  {
    name: 'text-join',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'text-join.e2e.mjs'),
  },
  {
    name: 'text-processor',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'text-processor.e2e.mjs'),
  },
  {
    name: 'text-split',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'text-split.e2e.mjs'),
  },
  {
    name: 'timestamp',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'timestamp.e2e.mjs'),
  },
  {
    name: 'uuid-generator',
    modulePath: path.resolve(projectRoot, 'tests', 'desktop', 'specs', 'uuid-generator.e2e.mjs'),
  },
];

function parseSelectedSpec() {
  const specFlagIndex = process.argv.indexOf('--spec');
  if (specFlagIndex === -1) {
    return null;
  }

  return process.argv[specFlagIndex + 1] || null;
}

async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
}

async function getLatestMtime(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      return stats.mtimeMs;
    }

    const children = await fs.readdir(targetPath, { withFileTypes: true });
    let latestMtime = stats.mtimeMs;
    for (const child of children) {
      const childPath = path.join(targetPath, child.name);
      latestMtime = Math.max(latestMtime, await getLatestMtime(childPath));
    }
    return latestMtime;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

async function shouldBuildDesktopApp() {
  if (process.env.DESKTOP_TEST_SKIP_BUILD === '1') {
    return false;
  }

  if (process.env.DESKTOP_TEST_FORCE_BUILD === '1') {
    return true;
  }

  // The executable alone does not record Vite compile-time flags. Rebuild this
  // one debug-only spec so its hidden test bridge cannot be stale or accidental.
  if (requestedSpec === 'env-setter') {
    return true;
  }

  try {
    const executableStats = await fs.stat(appExecutablePath);
    let latestSourceMtime = 0;

    for (const relativeTarget of buildWatchPaths) {
      const targetPath = path.resolve(projectRoot, relativeTarget);
      latestSourceMtime = Math.max(latestSourceMtime, await getLatestMtime(targetPath));
    }

    return latestSourceMtime > executableStats.mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

function createDesktopBuildEnv() {
  const buildEnv = {
    ...process.env,
    // 桌面自动化在 Windows release 构建阶段会偶发 Node/Rust OOM，限制并发并提高 Node 堆上限以稳定构建。
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '1',
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
  };

  // Never inherit a caller's Vite test flag into a normal desktop build.
  delete buildEnv.VITE_DESKTOP_E2E;
  if (desktopBuildProfile === 'debug') {
    buildEnv.VITE_DESKTOP_E2E = '1';
  }

  return buildEnv;
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/C', command, ...args], {
          cwd: projectRoot,
          env: options.env ?? process.env,
          stdio: 'inherit',
        })
      : spawn(command, args, {
          cwd: projectRoot,
          env: options.env ?? process.env,
          stdio: 'inherit',
        });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`命令失败: ${command} ${args.join(' ')} (exit ${code})`));
    });
  });
}

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isOpen = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });

      socket.on('error', () => {
        resolve(false);
      });
    });

    if (isOpen) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`端口 ${port} 在 ${timeoutMs}ms 内未就绪`);
}

async function waitForChildExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function stopTauriDriver(child) {
  if (child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    // Target only the runner-owned tauri-driver PID and its children (the native
    // driver/application); never search for or terminate processes by image name.
    await runCommand('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {
      child.kill();
    });
  } else {
    child.kill();
  }

  if (!(await waitForChildExit(child))) {
    child.kill();
    if (!(await waitForChildExit(child))) {
      throw new Error('tauri-driver 未能在清理后退出');
    }
  }
}

async function startTauriDriver(nativeDriverPath) {
  const args = [
    '--native-driver',
    nativeDriverPath,
    '--port',
    String(tauriDriverPort),
    '--native-port',
    String(nativeDriverPort),
  ];

  const child = spawn(tauriDriverPath, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('[desktop-test] tauri-driver 启动失败', error);
  });

  try {
    await waitForPort(tauriDriverPort);
    return child;
  } catch (error) {
    try {
      await stopTauriDriver(child);
    } catch (shutdownError) {
      throw new AggregateError(
        [error, shutdownError],
        'Tauri driver startup and cleanup both failed',
      );
    }
    throw error;
  }
}

async function createBrowserSession() {
  return remote({
    hostname: '127.0.0.1',
    port: tauriDriverPort,
    path: '/',
    logLevel: 'error',
    connectionRetryCount: 1,
    capabilities: {
      'tauri:options': {
        application: appExecutablePath,
      },
    },
  });
}

async function main() {
  if (requestedSpec === null && !runningStandardSuite) {
    console.log('[desktop-test] 将 env-setter 放入独立 debug E2E 进程，其余 spec 使用 release 构建。');
    await runCommand('node', [__filename, '--spec', 'env-setter']);
    await runCommand('node', [__filename], {
      env: {
        ...process.env,
        DESKTOP_TEST_INTERNAL_SKIP_ENV_SETTER: '1',
      },
    });
    return;
  }

  await ensureArtifactsDir();
  const runState = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    error: null,
    specs: [],
  };
  let browser;
  let ctx;
  let tauriDriver;
  let primaryError = null;
  const shutdownErrors = [];
  let reportError = null;

  try {
    const selectedSpec = requestedSpec;
    const runnableSpecs = selectedSpec
      ? specs.filter((spec) => spec.name === selectedSpec)
      : specs.filter((spec) => !runningStandardSuite || spec.name !== 'env-setter');

    if (runnableSpecs.length === 0) {
      throw new Error(`未找到匹配的 spec: ${selectedSpec}`);
    }

    const needsBuild = await shouldBuildDesktopApp();
    if (needsBuild) {
      console.log(`[desktop-test] 构建 ${desktopBuildProfile} 桌面应用...`);
      const buildArgs = desktopBuildProfile === 'debug'
        ? ['run', 'tauri', 'build', '--', '--no-bundle', '--debug']
        : ['run', 'tauri', 'build', '--', '--no-bundle'];
      await runCommand('npm', buildArgs, {
        env: createDesktopBuildEnv(),
      });
    } else {
      console.log(`[desktop-test] 复用已有桌面构建: ${appExecutablePath}`);
    }

    console.log('[desktop-test] 准备 Edge WebDriver...');
    const nativeDriverPath = await downloadEdgeDriver();

    console.log('[desktop-test] 启动 tauri-driver...');
    tauriDriver = await startTauriDriver(nativeDriverPath);

    console.log('[desktop-test] 创建 WebDriver 会话...');
    browser = await createBrowserSession();
    ctx = createDesktopSession(browser, artifactsDir);

    for (const spec of runnableSpecs) {
      const specState = {
        name: spec.name,
        status: 'running',
        screenshots: [],
        error: null,
      };
      runState.specs.push(specState);
      ctx.setCurrentSpec(specState);
      console.log(`[desktop-test] 开始执行: ${spec.name}`);
      try {
        const module = await import(pathToFileURL(spec.modulePath).href);
        await module.runDesktopSpec(ctx);
        const screenshotPath = ctx.canTakeAutomaticScreenshot()
          ? await ctx.takeSuccessScreenshot(spec.name)
          : null;
        specState.status = 'passed';
        console.log(`[desktop-test] 通过: ${spec.name}`);
        if (screenshotPath) {
          console.log(`[desktop-test] 通过截图: ${screenshotPath}`);
        } else {
          console.log('[desktop-test] 自动截图已由 spec 安全策略跳过');
        }
      } catch (error) {
        let screenshotPath = null;
        let screenshotError = null;
        if (ctx.canTakeAutomaticScreenshot()) {
          try {
            screenshotPath = await ctx.takeFailureScreenshot(spec.name);
          } catch (failureScreenshotError) {
            screenshotError = failureScreenshotError;
            console.error('[desktop-test] 失败截图保存失败', failureScreenshotError);
          }
        }
        specState.status = 'failed';
        specState.error = error instanceof Error ? error.stack || error.message : String(error);
        runState.status = 'failed';
        if (screenshotPath) {
          console.error(`[desktop-test] 失败截图: ${screenshotPath}`);
        } else {
          console.error('[desktop-test] 失败自动截图已由 spec 安全策略跳过或保存失败');
        }
        if (screenshotError) {
          throw new AggregateError(
            [error, screenshotError],
            'Desktop spec execution and failure screenshot capture both failed',
          );
        }
        throw error;
      } finally {
        ctx.setCurrentSpec(null);
      }
    }
  } catch (error) {
    primaryError = error;
    runState.status = 'failed';
    runState.error = error instanceof Error ? error.stack || error.message : String(error);
  }

  if (browser) {
    try {
      await browser.deleteSession();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }

  if (tauriDriver) {
    try {
      await stopTauriDriver(tauriDriver);
    } catch (error) {
      shutdownErrors.push(error);
    }
  }

  runState.finishedAt = new Date().toISOString();
  if (runState.status === 'running') {
    runState.status = shutdownErrors.length === 0 ? 'passed' : 'failed';
  }
  if (runState.error === null && shutdownErrors.length > 0) {
    const shutdownError = shutdownErrors[0];
    runState.error = shutdownError instanceof Error
      ? shutdownError.stack || shutdownError.message
      : String(shutdownError);
  }

  try {
    const reportPath = await writeDesktopRunReport({
      artifactDir: artifactsDir,
      run: runState,
    });
    console.log(`[desktop-test] 测试报告: ${reportPath}`);
  } catch (error) {
    reportError = error;
    console.error('[desktop-test] 写入测试报告失败', error);
  }

  const errors = [primaryError, ...shutdownErrors, reportError].filter((error) => error !== null);
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Desktop test execution, shutdown, or report writing failed',
    );
  }
}

main().catch((error) => {
  console.error('[desktop-test] 执行失败');
  console.error(error);
  process.exitCode = 1;
});
