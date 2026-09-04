import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 桌面测试会直接复用 mjs 运行时 helper
import { createDesktopSession } from './session.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe('createDesktopSession', () => {
  it('会把步骤截图登记到当前 spec 结果中', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-session-'));
    tempDirs.push(artifactDir);

    const saveScreenshot = vi.fn(async (filePath: string) => {
      await fs.writeFile(filePath, 'fake-image');
    });

    const browser = {
      saveScreenshot,
    } as any;

    const ctx = createDesktopSession(browser, artifactDir);
    const specState = {
      name: 'memo',
      status: 'running',
      screenshots: [],
    } as any;

    ctx.setCurrentSpec(specState);
    const filePath = await ctx.recordStep('已打开备忘录');

    expect(saveScreenshot).toHaveBeenCalledTimes(1);
    expect(filePath).toContain('step');
    expect(specState.screenshots).toHaveLength(1);
    expect(specState.screenshots[0]).toMatchObject({
      title: '已打开备忘录',
      kind: 'step',
      filePath,
    });
  });
});
