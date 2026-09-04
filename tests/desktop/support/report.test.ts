import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error 桌面测试报告模块当前以 mjs 形式提供运行时实现
import { writeDesktopRunReport } from './report.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe('writeDesktopRunReport', () => {
  it('会按 spec 和步骤生成可回看的 markdown 图集报告', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-report-'));
    tempDirs.push(artifactDir);

    await fs.writeFile(path.join(artifactDir, 'step-1.png'), 'fake-image');
    await fs.writeFile(path.join(artifactDir, 'step-2.png'), 'fake-image');

    const reportPath = await writeDesktopRunReport({
      artifactDir,
      run: {
        startedAt: '2026-04-01T11:00:00.000Z',
        finishedAt: '2026-04-01T11:03:00.000Z',
        status: 'passed',
        specs: [
          {
            name: 'jwt',
            status: 'passed',
            screenshots: [
              {
                title: '打开 JWT 工具',
                filePath: path.join(artifactDir, 'step-1.png'),
                kind: 'step',
                timestamp: '2026-04-01T11:01:00.000Z',
              },
              {
                title: '签发完成',
                filePath: path.join(artifactDir, 'step-2.png'),
                kind: 'success',
                timestamp: '2026-04-01T11:02:00.000Z',
              },
            ],
          },
        ],
      },
    });

    const content = await fs.readFile(reportPath, 'utf8');
    expect(content).toContain('# Desktop Test Report');
    expect(content).toContain('状态：passed');
    expect(content).toContain('## jwt');
    expect(content).toContain('### 1. 打开 JWT 工具');
    expect(content).toContain('### 2. 签发完成');
    expect(content).toContain('![打开 JWT 工具](./step-1.png)');
    expect(content).toContain('![签发完成](./step-2.png)');
  });
});
