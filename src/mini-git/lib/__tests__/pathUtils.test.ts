import { describe, it, expect, vi } from 'vitest';
import { formatAbsolutePath, isWindowsPath, copyToClipboard } from '../pathUtils';

describe('pathUtils', () => {
  describe('isWindowsPath', () => {
    it('detects Windows drive letter paths', () => {
      expect(isWindowsPath('C:/ws/openToolBox')).toBe(true);
      expect(isWindowsPath('c:\\repos\\app')).toBe(true);
      expect(isWindowsPath('D:/project')).toBe(true);
    });

    it('detects backslash paths', () => {
      expect(isWindowsPath('some\\path')).toBe(true);
    });

    it('returns false for unix paths', () => {
      expect(isWindowsPath('/home/user/project')).toBe(false);
      expect(isWindowsPath('/Users/dev/repo')).toBe(false);
    });
  });

  describe('formatAbsolutePath', () => {
    it('formats Windows paths starting from drive letter with backslashes', () => {
      const res = formatAbsolutePath('C:/ws/openToolBox', 'src/components/FileTree.vue');
      expect(res).toBe('C:\\ws\\openToolBox\\src\\components\\FileTree.vue');
    });

    it('handles trailing slash on base path and leading slash on rel path', () => {
      const res = formatAbsolutePath('C:\\ws\\openToolBox\\', '/src/components/FileTree.vue');
      expect(res).toBe('C:\\ws\\openToolBox\\src\\components\\FileTree.vue');
    });

    it('formats Unix/Linux/macOS paths starting from / with forward slashes', () => {
      const res = formatAbsolutePath('/Users/dev/openToolBox', 'src/components/FileTree.vue');
      expect(res).toBe('/Users/dev/openToolBox/src/components/FileTree.vue');
    });

    it('falls back to relPath if basePath is empty', () => {
      const res = formatAbsolutePath('', 'src/components/FileTree.vue');
      expect(res).toBe('src/components/FileTree.vue');
    });

    it('returns formatted basePath when relPath is empty', () => {
      const res = formatAbsolutePath('C:/ws/openToolBox', '');
      expect(res).toBe('C:\\ws\\openToolBox');
    });
  });

  describe('copyToClipboard', () => {
    it('copies text to clipboard', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      const success = await copyToClipboard('test text');
      expect(success).toBe(true);
    });
  });
});
