import { writeText as tauriWriteText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Checks if the given path or current platform represents Windows.
 */
export function isWindowsPath(path: string): boolean {
  const p = (path || '').trim();
  if (!p) {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || navigator.platform || '')) {
      return true;
    }
    return false;
  }
  // Explicit unix root path
  if (p.startsWith('/')) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(p) || p.includes('\\')) {
    return true;
  }
  if (typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || navigator.platform || '')) {
    return true;
  }
  return false;
}

/**
 * Builds an absolute path from a repository base path and a relative path.
 * - On Windows: returns "C:\path\to\repo\file" (starts with drive letter, uses '\').
 * - On Unix/Linux/macOS: returns "/path/to/repo/file" (starts with '/', uses '/').
 */
export function formatAbsolutePath(repoPath: string, relPath: string): string {
  const cleanBase = (repoPath || '').trim().replace(/[/\\]+$/, '');
  const cleanRel = (relPath || '').trim().replace(/^[/\\]+/, '');

  if (!cleanBase) {
    return cleanRel;
  }

  const isWin = isWindowsPath(cleanBase);
  const combined = cleanRel ? `${cleanBase}/${cleanRel}` : cleanBase;

  if (isWin) {
    return combined.replace(/\//g, '\\');
  }
  return combined.replace(/\\/g, '/');
}

/**
 * Robustly copies text to the system clipboard:
 * 1. Tries Tauri native clipboard manager plugin (works without webview focus);
 * 2. Falls back to web API navigator.clipboard.writeText;
 * 3. Falls back to document.execCommand('copy') with hidden textarea.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await tauriWriteText(text);
    return true;
  } catch {
    // Tauri plugin failed or running in test/browser
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Navigator clipboard failed (e.g. document unfocused)
  }

  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const success = document.execCommand('copy');
      document.body.removeChild(ta);
      return success;
    }
  } catch {
    // All methods failed
  }

  return false;
}
