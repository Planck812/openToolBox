import { afterEach } from 'vitest';
import { vi } from 'vitest';

// mock vue-i18n，避免测试环境需要真实 i18n 实例
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params && Object.keys(params).length) return `${key} ${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

// mock 全局 i18n 实例：逻辑模块（engine/runtime 等）import '@/i18n' 后，测试中
// i18n.global.t() 返回键本身，断言消息时改为断言键。
vi.mock('@/i18n', () => ({
  default: {
    global: {
      t: (key: string, params?: Record<string, any>) => {
        if (params && Object.keys(params).length) return `${key} ${JSON.stringify(params)}`;
        return key;
      },
    },
  },
}));

// mock @tauri-apps/plugin-log：测试环境无 __TAURI_INTERNALS__，真实调用会触发
// 未处理的 reject（读取 undefined.invoke），导致 vitest 报 Unhandled Rejection。
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

afterEach(async () => {
  const mod: any = await import('@tauri-apps/plugin-global-shortcut');
  if (typeof mod.__reset === 'function') {
    mod.__reset();
  }
});

// 为 node/jsdom 双环境兼容补齐 getClientRects。
if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
  Element.prototype.getClientRects = function () {
    return [
      {
        bottom: 0,
        top: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON() {
          return this;
        },
      },
    ] as any;
  };
}
