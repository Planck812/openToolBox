import { useRouter, useRoute } from 'vue-router';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * 判断元素是否为文本输入类控件
 * @param el 元素
 */
const isTextInputLike = (el: Element | null) => {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;

  const tagName = el.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (el.getAttribute('role') === 'textbox') return true;

  return false;
};

/**
 * 判断当前 ESC 是否来自文本输入场景
 * @param e 键盘事件
 */
const isEscapeFromTextInput = (e: KeyboardEvent) => {
  const target = e.target instanceof Element ? e.target : null;
  const active = document.activeElement;

  if (isTextInputLike(active)) return true;
  if (isTextInputLike(target)) return true;

  if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return true;

  return false;
};

/**
 * 判断元素是否可见
 * @param el 元素
 */
const isVisible = (el: Element | null) => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return el.getClientRects().length > 0;
};

/**
 * 判断当前是否存在打开的浮层组件（对话框、菜单等）
 */
const hasOpenOverlay = () => {
  const overlaySelectors = [
    '[aria-modal="true"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="menu"]',
    '[role="listbox"]',
  ];

  return overlaySelectors.some((selector) => {
    const el = document.querySelector(selector);
    return isVisible(el);
  });
};

/**
 * 全局键盘事件处理（拆分自 App.vue）。
 * 只负责判定与动作，keydown 监听由 App.vue 注册/卸载（capture 监听与现有行为逐字一致）。
 */
export function useGlobalKeyboard() {
  const router = useRouter();
  const route = useRoute();

  const handleKeydown = async (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (e.defaultPrevented) return;
    if (isEscapeFromTextInput(e)) return;
    if (hasOpenOverlay()) return;

    if (route.name === 'tool') {
      router.push('/');
      return;
    }

    try {
      const appWindow = getCurrentWindow();
      if (appWindow) {
        await appWindow.hide();
      }
    } catch (e) {
      console.error('Error hiding window:', e);
    }
  };

  return { handleKeydown };
}
