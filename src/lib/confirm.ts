import { isTauriEnvironment } from '@/lib/tauri-env';
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';

/**
 * 统一的确认对话框封装：
 * 在真实 Tauri 桌面环境下使用系统原生确认弹窗（带警告图标与标题），
 * 在单元测试与纯浏览器环境下使用 window.confirm。
 */
export async function askConfirm(message: string, title?: string): Promise<boolean> {
  if (isTauriEnvironment() && !process.env.VITEST) {
    try {
      return await tauriConfirm(message, {
        title: title || '提示',
        kind: 'warning',
      });
    } catch {
      return window.confirm(message);
    }
  }

  return window.confirm(message);
}
