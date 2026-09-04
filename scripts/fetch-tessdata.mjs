#!/usr/bin/env node
// 幂等下载 Tesseract 语言包（tessdata）到 src-tauri/tessdata 与 src-tauri/tessdata_fast。
// 来源：tesseract-ocr 官方 GitHub 仓库（Apache-2.0），构建/开发命令会自动调用本脚本。
// 用法：node scripts/fetch-tessdata.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcTauriDir = path.resolve(__dirname, '..', 'src-tauri');

// dir: 落盘目录（相对 src-tauri）；file: 模型文件名；repo: tesseract-ocr 下的仓库名。
const MODELS = [
  { dir: 'tessdata', file: 'chi_sim.traineddata', repo: 'tessdata' },
  { dir: 'tessdata', file: 'chi_sim_vert.traineddata', repo: 'tessdata' },
  { dir: 'tessdata', file: 'eng.traineddata', repo: 'tessdata' },
  { dir: 'tessdata_fast', file: 'chi_sim.traineddata', repo: 'tessdata_fast' },
  { dir: 'tessdata_fast', file: 'eng.traineddata', repo: 'tessdata_fast' },
];

const BASE = 'https://github.com/tesseract-ocr';

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  let fetched = 0;
  let skipped = 0;
  for (const { dir, file, repo } of MODELS) {
    const dirPath = path.join(srcTauriDir, dir);
    const dest = path.join(dirPath, file);
    await mkdir(dirPath, { recursive: true });
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log(`[fetch-tessdata] skip ${dir}/${file} (exists)`);
      skipped++;
      continue;
    }
    const url = `${BASE}/${repo}/raw/main/${file}`;
    console.log(`[fetch-tessdata] downloading ${dir}/${file} ...`);
    await download(url, dest);
    fetched++;
  }
  console.log(`[fetch-tessdata] done: ${fetched} downloaded, ${skipped} skipped.`);
  if (fetched + skipped !== MODELS.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[fetch-tessdata] FAILED: ${err.message}`);
  process.exit(1);
});
