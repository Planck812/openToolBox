import fs from 'node:fs/promises';
import path from 'node:path';

function toRelativeMarkdownPath(artifactDir, filePath) {
  return `./${path.relative(artifactDir, filePath).replace(/\\/g, '/')}`;
}

function sanitizeTimestampForFileName(value) {
  return value.replace(/[:.]/g, '-');
}

export async function writeDesktopRunReport({ artifactDir, run }) {
  const startedAt = run.startedAt || new Date().toISOString();
  const reportFileName = `desktop-test-report-${sanitizeTimestampForFileName(startedAt)}.md`;
  const reportPath = path.join(artifactDir, reportFileName);

  const lines = [
    '# Desktop Test Report',
    '',
    `- 开始时间：${run.startedAt || ''}`,
    `- 结束时间：${run.finishedAt || ''}`,
    `- 状态：${run.status || 'unknown'}`,
    '',
  ];

  for (const spec of run.specs || []) {
    lines.push(`## ${spec.name}`);
    lines.push('');
    lines.push(`- 状态：${spec.status}`);
    if (spec.error) {
      lines.push(`- 错误：${spec.error}`);
    }
    lines.push('');

    const screenshots = spec.screenshots || [];
    if (screenshots.length === 0) {
      lines.push('- 无截图');
      lines.push('');
      continue;
    }

    screenshots.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.title}`);
      lines.push('');
      lines.push(`- 类型：${item.kind}`);
      lines.push(`- 时间：${item.timestamp}`);
      lines.push('');
      lines.push(`![${item.title}](${toRelativeMarkdownPath(artifactDir, item.filePath)})`);
      lines.push('');
    });
  }

  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}
