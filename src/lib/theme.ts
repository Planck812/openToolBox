export type ThemeMode = 'light' | 'dark';
export type ThemeSkinId =
  | 'aurora'
  | 'sky-glass'
  | 'mint-tech'
  | 'glow-purple'
  | 'coral-pop'
  | 'sunset-orange'
  | 'lime-cyan'
  | 'sakura-mist'
  | 'desert-khaki'
  | 'deep-sea'
  | 'black-gold';

export const THEME_STORAGE_KEY = 'settings.themeMode';
export const THEME_SKIN_STORAGE_KEY = 'settings.themeSkinId';

export type ThemeSkinDefinition = {
  id: ThemeSkinId;
  name: string;
  description: string;
  accent: string;
  accent2: string;
  accent3: string;
  panel: string;
  background: string;
  recommendedMode: ThemeMode;
};

export const THEME_SKINS: ThemeSkinDefinition[] = [
  { id: 'aurora', name: 'skin.aurora.name', description: 'skin.aurora.description', accent: '#06B6D4', accent2: '#14B8A6', accent3: '#0F172A', panel: '#E0F2FE', background: '#F8FBFF', recommendedMode: 'light' },
  { id: 'sky-glass', name: 'skin.sky-glass.name', description: 'skin.sky-glass.description', accent: '#2F80FF', accent2: '#6BB7FF', accent3: '#173B66', panel: '#EEF7FF', background: 'linear-gradient(135deg, #EEF7FF 0%, #FFFFFF 52%, #E8F6FF 100%)', recommendedMode: 'light' },
  { id: 'mint-tech', name: 'skin.mint-tech.name', description: 'skin.mint-tech.description', accent: '#10B981', accent2: '#06D6A0', accent3: '#22D3EE', panel: '#DCFDF4', background: '#F6FFFB', recommendedMode: 'light' },
  { id: 'glow-purple', name: 'skin.glow-purple.name', description: 'skin.glow-purple.description', accent: '#6366F1', accent2: '#A78BFA', accent3: '#8B5CF6', panel: '#F5F3FF', background: '#FBF9FF', recommendedMode: 'light' },
  { id: 'coral-pop', name: 'skin.coral-pop.name', description: 'skin.coral-pop.description', accent: '#FF6B6B', accent2: '#FF9F7F', accent3: '#FFB7C5', panel: '#FFF4F2', background: '#FFF9F8', recommendedMode: 'light' },
  { id: 'sunset-orange', name: 'skin.sunset-orange.name', description: 'skin.sunset-orange.description', accent: '#FB923C', accent2: '#F97316', accent3: '#FBBF24', panel: '#FFF3E6', background: '#FFF9F2', recommendedMode: 'light' },
  { id: 'lime-cyan', name: 'skin.lime-cyan.name', description: 'skin.lime-cyan.description', accent: '#84CC16', accent2: '#E3F53C', accent3: '#22C55E', panel: '#F7FEE7', background: '#FBFFF3', recommendedMode: 'light' },
  { id: 'sakura-mist', name: 'skin.sakura-mist.name', description: 'skin.sakura-mist.description', accent: '#F472B6', accent2: '#FB7185', accent3: '#D946EF', panel: '#FFF1F7', background: '#FFF7F9', recommendedMode: 'light' },
  { id: 'desert-khaki', name: 'skin.desert-khaki.name', description: 'skin.desert-khaki.description', accent: '#D4A373', accent2: '#C26E3D', accent3: '#8B5E3C', panel: '#FDF2E3', background: '#FFF9F3', recommendedMode: 'light' },
  { id: 'deep-sea', name: 'skin.deep-sea.name', description: 'skin.deep-sea.description', accent: '#0B1220', accent2: '#1E40AF', accent3: '#22D3EE', panel: '#0F172A', background: '#020617', recommendedMode: 'dark' },
  { id: 'black-gold', name: 'skin.black-gold.name', description: 'skin.black-gold.description', accent: '#0D1117', accent2: '#F2C94C', accent3: '#B08D57', panel: '#111827', background: '#030712', recommendedMode: 'dark' },
];

export const DEFAULT_THEME_SKIN_ID: ThemeSkinId = 'black-gold';

/**
 * 读取本地存储的主题模式，仅接受 light / dark 两种合法值
 */
export const readStoredThemeMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

/**
 * 读取本地存储的配色皮肤，仅接受预设皮肤 ID
 */
export const readStoredThemeSkinId = (): ThemeSkinId => {
  try {
    const value = localStorage.getItem(THEME_SKIN_STORAGE_KEY);
    return THEME_SKINS.some((skin) => skin.id === value) ? (value as ThemeSkinId) : DEFAULT_THEME_SKIN_ID;
  } catch {
    return DEFAULT_THEME_SKIN_ID;
  }
};

/**
 * 根据皮肤 ID 获取皮肤定义
 * @param skinId 皮肤 ID
 */
export const getThemeSkin = (skinId: ThemeSkinId) =>
  THEME_SKINS.find((skin) => skin.id === skinId) ?? THEME_SKINS[0];

/**
 * 将主题模式同步到根节点，供 Tailwind 变量与原生样式共同消费
 * @param mode 目标主题
 * @param root 根节点，默认使用 html
 */
export const applyThemeMode = (
  mode: ThemeMode,
  skinId: ThemeSkinId = DEFAULT_THEME_SKIN_ID,
  root: HTMLElement = document.documentElement
) => {
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
  root.dataset.skin = skinId;
};
