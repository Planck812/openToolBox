import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // 与 vite.config.ts 的 define 保持同步：本配置不继承 vite.config.ts，
  // 缺了这一项，引用 `__IS_WINDOWS__` 的模块（如 tools/registry.ts）在测试中会直接报错。
  // 测试统一以 Windows 目标运行，保证工具注册表是全集，用例不受平台裁剪影响。
  define: {
    __IS_WINDOWS__: JSON.stringify(true),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
