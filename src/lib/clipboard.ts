import { writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * 复制文本到剪贴板（多级兜底），返回是否成功：
 * 1. Tauri 插件 `writeText`（桌面首选）
 * 2. `navigator.clipboard.writeText`（标准 Web API）
 * 3. 隐藏 textarea + `execCommand('copy')`（旧 WebView 兜底）
 *
 * 各工具此前各自内联实现同样的三段式，统一收敛到此处。
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await writeText(text);
    return true;
  } catch {
    // 非 Tauri 环境或插件失败，走 Web API 兜底。
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 标准 API 也失败，走 execCommand 兜底。
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};
