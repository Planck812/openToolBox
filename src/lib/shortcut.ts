/**
 * 将键盘事件转换为 Tauri 全局快捷键字符串（如 Ctrl+Alt+K）。
 * 输入框按组合键不再包含修饰键本体时返回 null（等待继续组合）。
 * @param e 键盘事件
 */
export const formatGlobalShortcutFromKeyboardEvent = (e: KeyboardEvent): string | null => {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Meta');

  const rawKey = e.key;
  const lower = rawKey.toLowerCase();
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta') return null;

  const key =
    rawKey === ' ' || rawKey === 'Spacebar'
      ? 'Space'
      : rawKey.length === 1
        ? rawKey.toUpperCase()
        : rawKey;

  return [...modifiers, key].join('+');
};
