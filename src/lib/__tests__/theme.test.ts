import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyThemeMode,
  DEFAULT_THEME_SKIN_ID,
  getThemeSkin,
  readStoredThemeMode,
  readStoredThemeSkinId,
  THEME_SKINS,
  THEME_SKIN_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

describe('theme helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-skin');
  });

  it('未命中存储值时默认返回浅色主题', () => {
    expect(readStoredThemeMode()).toBe('light');
  });

  it('应用深色主题时会同步根节点 class 与 data-theme', () => {
    applyThemeMode('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('命中合法存储值时会返回对应主题', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    expect(readStoredThemeMode()).toBe('dark');
  });

  it('未命中配色存储值时默认使用黑金主题', () => {
    expect(DEFAULT_THEME_SKIN_ID).toBe('black-gold');
    expect(readStoredThemeSkinId()).toBe('black-gold');
    expect(getThemeSkin(DEFAULT_THEME_SKIN_ID).recommendedMode).toBe('dark');
  });

  it('提供截图风格的晴空玻璃配色方案并允许持久化读取', () => {
    const skyGlassSkin = THEME_SKINS.find((skin) => skin.id === 'sky-glass');

    expect(skyGlassSkin).toMatchObject({
      name: 'skin.sky-glass.name',
      recommendedMode: 'light',
      accent: '#2F80FF',
    });

    localStorage.setItem(THEME_SKIN_STORAGE_KEY, 'sky-glass');
    expect(readStoredThemeSkinId()).toBe('sky-glass');

    applyThemeMode('light', 'sky-glass');
    expect(document.documentElement.dataset.skin).toBe('sky-glass');
  });
});
