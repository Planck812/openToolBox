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
  { id: 'aurora', name: 'skin.aurora.name', description: 'skin.aurora.description', accent: '#0D9488', accent2: '#2DD4BF', accent3: '#6366F1', panel: '#F0FDFA', background: 'linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 52%, #E6FFFA 100%)', recommendedMode: 'light' },
  { id: 'sky-glass', name: 'skin.sky-glass.name', description: 'skin.sky-glass.description', accent: '#2F80FF', accent2: '#60A5FA', accent3: '#0284C7', panel: '#EEF7FF', background: 'linear-gradient(135deg, #EEF7FF 0%, #FFFFFF 52%, #E8F4FF 100%)', recommendedMode: 'light' },
  { id: 'mint-tech', name: 'skin.mint-tech.name', description: 'skin.mint-tech.description', accent: '#059669', accent2: '#10B981', accent3: '#34D399', panel: '#ECFDF5', background: 'linear-gradient(135deg, #F0FDF4 0%, #FFFFFF 52%, #DCFCE7 100%)', recommendedMode: 'light' },
  { id: 'glow-purple', name: 'skin.glow-purple.name', description: 'skin.glow-purple.description', accent: '#A855F7', accent2: '#EC4899', accent3: '#6366F1', panel: '#190E2E', background: '#0B0517', recommendedMode: 'dark' },
  { id: 'coral-pop', name: 'skin.coral-pop.name', description: 'skin.coral-pop.description', accent: '#F43F5E', accent2: '#FB923C', accent3: '#E11D48', panel: '#FFF1F2', background: 'linear-gradient(135deg, #FFF5F5 0%, #FFFFFF 52%, #FFE4E6 100%)', recommendedMode: 'light' },
  { id: 'sunset-orange', name: 'skin.sunset-orange.name', description: 'skin.sunset-orange.description', accent: '#EA580C', accent2: '#F59E0B', accent3: '#9A3412', panel: '#FFF7ED', background: 'linear-gradient(135deg, #FFF8F1 0%, #FFFFFF 52%, #FFEDD5 100%)', recommendedMode: 'light' },
  { id: 'lime-cyan', name: 'skin.lime-cyan.name', description: 'skin.lime-cyan.description', accent: '#16A34A', accent2: '#14B8A6', accent3: '#84CC16', panel: '#F0FDF4', background: 'linear-gradient(135deg, #F4FAF5 0%, #FFFFFF 52%, #E8F5E9 100%)', recommendedMode: 'light' },
  { id: 'sakura-mist', name: 'skin.sakura-mist.name', description: 'skin.sakura-mist.description', accent: '#E11D48', accent2: '#FB7185', accent3: '#C084FC', panel: '#FFF1F5', background: 'linear-gradient(135deg, #FFF5F7 0%, #FFFFFF 52%, #FCE7F3 100%)', recommendedMode: 'light' },
  { id: 'desert-khaki', name: 'skin.desert-khaki.name', description: 'skin.desert-khaki.description', accent: '#B45309', accent2: '#D97706', accent3: '#78350F', panel: '#FAF6F0', background: 'linear-gradient(135deg, #FAF7F2 0%, #FFFFFF 52%, #F5EDE0 100%)', recommendedMode: 'light' },
  { id: 'deep-sea', name: 'skin.deep-sea.name', description: 'skin.deep-sea.description', accent: '#00D2FF', accent2: '#2563EB', accent3: '#0D9488', panel: '#08162E', background: '#010614', recommendedMode: 'dark' },
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
