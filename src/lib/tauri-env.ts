import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

/**
 * 判断是否运行在真实 Tauri 桌面环境（排除纯浏览器 dev 调试模式）
 */
export const isTauriEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const tauri = window as unknown as Record<string, unknown>;
  const internals = tauri.__TAURI_INTERNALS__ as Record<string, unknown> | undefined;
  if (internals?.__IS_BROWSER_MOCK__ && !process.env.VITEST) {
    return false;
  }
  return Boolean(tauri.__TAURI_IPC__ || tauri.__TAURI_INTERNALS__ || tauri.__TAURI__);
};

// 在纯浏览器环境（如 vite dev standalone）下自动安装 mock，确保窗口/事件不报错，界面正常渲染
if (typeof window !== 'undefined') {
  const tauri = window as unknown as Record<string, unknown>;
  if (!tauri.__TAURI_IPC__ && !tauri.__TAURI_INTERNALS__) {
    mockWindows('main');
    const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as Record<string, unknown>;
    if (internals) {
      internals.__IS_BROWSER_MOCK__ = true;
    }
    mockIPC((cmd) => {
      switch (cmd) {
        case 'plugin:window|is_maximized':
        case 'plugin:window|is_minimized':
        case 'plugin:window|is_fullscreen':
        case 'plugin:window|is_always_on_top':
          return false;
        case 'plugin:window|inner_size':
        case 'plugin:window|outer_size':
          return { width: window.innerWidth, height: window.innerHeight };
        case 'plugin:window|scale_factor':
          return window.devicePixelRatio || 1;
        case 'plugin:event|listen':
          return 1;
        case 'plugin:event|unlisten':
          return null;
        case 'plugin:store|get':
        case 'plugin:store|set':
        case 'plugin:store|has':
          return null;
        default:
          return null;
      }
    });
  }
}
