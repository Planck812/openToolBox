import { defineStore } from 'pinia';
import { ref, computed, type Ref } from 'vue';
import { tools } from '@/tools/registry';
import {
  DEFAULT_THEME_SKIN_ID,
  THEME_SKIN_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getThemeSkin,
  readStoredThemeSkinId,
  type ThemeMode,
  type ThemeSkinId,
} from '@/lib/theme';
import { CONFIG_KEYS } from '@/lib/config-keys';
import { safeGetJson, safeGetString, safeRemove, safeSetJson, safeSetString } from '@/lib/config';
import { filterTools as filterToolsFor, recommendTools as recommendToolsFor } from '@/lib/tool-search';
import { logContext, logIfEnabled } from '@/lib/logger';

type ToastType = 'success' | 'warning' | 'error' | 'info';

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
  durationMs: number;
};

export const useAppStore = defineStore('app', () => {
  const searchQuery = ref('');
  const inputContent = ref('');
  const activeToolId = ref<string | null>(null);
  /** 滚动截图完成后的待展示预览 token（App.vue 全局监听写入，截图工具页消费）。 */
  const pendingScrollPreviewToken = ref<string | null>(null);
  const toasts = ref<ToastItem[]>([]);
  const initialThemeSkinId = readStoredThemeSkinId();
  const themeSkinId = ref<ThemeSkinId>(initialThemeSkinId);
  const themeMode = ref<ThemeMode>(getThemeSkin(initialThemeSkinId).recommendedMode);
  type AppBackgroundMode = 'default' | 'custom' | 'none';
  const appBackgroundMode = ref<AppBackgroundMode>('default');
  const appBackgroundImage = ref('');
  const homeMotionEnabled = ref(false);

  const DEFAULT_HOME_SHORTCUT = 'Ctrl+Alt+Q';
  const DEFAULT_SHOW_SHORTCUT = 'Alt+Space';
  const DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT = 'Ctrl+Shift+S';
  const DEFAULT_STICKY_SHORTCUT = 'Ctrl+Shift+T';
  const DEFAULT_SINGLE_STICKY_SHORTCUT = 'Ctrl+Shift+E';
  const DEFAULT_PIN_RECOVERY_SHORTCUT = 'Ctrl+Shift+P';
  const RECENT_TOOL_LIMIT = 12;

  /** 首页「强力工具」默认入口；用户可在首页自定义覆盖。 */
  const DEFAULT_STRONG_TOOL_IDS = ['text-processor', 'memo', 'pwd-box', 'prompt-manager'];

  const DEFAULT_TOAST_DURATION_MS = 2400;

  /**
   * 从本地存储读取工具 ID 列表，并过滤已下线的工具
   * @param storageKey 本地存储键名
   */
  const readStoredToolIds = (storageKey: string) => {
    const ids = safeGetJson<unknown>(storageKey, []);
    if (!Array.isArray(ids)) return [];

    return ids.filter((id): id is string =>
      typeof id === 'string' && tools.some((tool) => tool.metadata.id === id)
    );
  };

  const persistToolIds = (storageKey: string, ids: string[]) => {
    safeSetJson(storageKey, ids);
  };

  const readStoredAppBackgroundImage = () => safeGetString(CONFIG_KEYS.appBackgroundImage, '');
  const readStoredAppBackgroundMode = (): AppBackgroundMode => {
    const value = safeGetString(CONFIG_KEYS.appBackgroundMode, 'default');
    return value === 'custom' || value === 'none' || value === 'default' ? value : 'default';
  };
  appBackgroundMode.value = readStoredAppBackgroundMode();
  appBackgroundImage.value = readStoredAppBackgroundImage();
  homeMotionEnabled.value = safeGetString(CONFIG_KEYS.homeMotionEnabled, 'false') === 'true';

  const readStoredShortcutPair = () => {
    const migrated = safeGetString(CONFIG_KEYS.shortcutRoleMigrated, '') === '1';
    const storedHome = safeGetString(CONFIG_KEYS.homeShortcut, '').trim();
    const storedShow = safeGetString(CONFIG_KEYS.showShortcut, '').trim();

    if (!migrated) {
      const home = !storedHome || storedHome === 'Alt+Space' ? DEFAULT_HOME_SHORTCUT : storedHome;
      const show = !storedShow || storedShow === 'Ctrl+Alt+Q' ? DEFAULT_SHOW_SHORTCUT : storedShow;

      safeSetString(CONFIG_KEYS.homeShortcut, home);
      safeSetString(CONFIG_KEYS.showShortcut, show);
      safeSetString(CONFIG_KEYS.homeShortcutMigratedAltSpace, '1');
      safeSetString(CONFIG_KEYS.shortcutRoleMigrated, '1');
      return { home, show };
    }

    return {
      home: storedHome || DEFAULT_HOME_SHORTCUT,
      show: storedShow || DEFAULT_SHOW_SHORTCUT,
    };
  };

  const shortcutPair = readStoredShortcutPair();
  const homeShortcut = ref(shortcutPair.home);
  const showShortcut = ref(shortcutPair.show);
  const readStoredUniversalScreenshotShortcut = () =>
    safeGetString(CONFIG_KEYS.universalScreenshotShortcut, '').trim() || DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT;
  const universalScreenshotShortcut = ref(readStoredUniversalScreenshotShortcut());
  const readStoredStickyShortcut = () =>
    safeGetString(CONFIG_KEYS.stickyShortcut, '').trim() || DEFAULT_STICKY_SHORTCUT;
  const stickyShortcut = ref(readStoredStickyShortcut());
  const readStoredSingleStickyShortcut = () =>
    safeGetString(CONFIG_KEYS.singleStickyShortcut, '').trim() || DEFAULT_SINGLE_STICKY_SHORTCUT;
  const singleStickyShortcut = ref(readStoredSingleStickyShortcut());
  const readStoredPinRecoveryShortcut = () =>
    safeGetString(CONFIG_KEYS.pinRecoveryShortcut, '').trim() || DEFAULT_PIN_RECOVERY_SHORTCUT;
  const pinRecoveryShortcut = ref(readStoredPinRecoveryShortcut());
  const readStoredToolShortcuts = (): Record<string, string> => {
    const parsed = safeGetJson<unknown>(CONFIG_KEYS.toolShortcuts, {});
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  };
  const toolShortcuts = ref<Record<string, string>>(readStoredToolShortcuts());
  const readStoredPipelineShortcuts = (): Record<string, string> => {
    const parsed = safeGetJson<unknown>(CONFIG_KEYS.pipelineShortcuts, {});
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  };
  const pipelineShortcuts = ref<Record<string, string>>(readStoredPipelineShortcuts());
  const favoriteToolIds = ref<string[]>(readStoredToolIds(CONFIG_KEYS.favoriteToolIds));
  const recentToolIds = ref<string[]>(readStoredToolIds(CONFIG_KEYS.recentToolIds));
  const homeToolOrderIds = ref<string[]>(readStoredToolIds(CONFIG_KEYS.homeToolOrderIds));

  /**
   * 读取用户自定义的强力工具 ID；从未配置过时回退到默认入口，
   * 已配置过则原样使用（允许清空），并过滤已下线的工具。
   */
  const readStoredStrongToolIds = (): string[] => {
    const stored = safeGetJson<unknown>(CONFIG_KEYS.strongToolIds, null);
    if (!Array.isArray(stored)) return [...DEFAULT_STRONG_TOOL_IDS];

    return stored.filter((id): id is string =>
      typeof id === 'string' && tools.some((tool) => tool.metadata.id === id)
    );
  };
  const strongToolIds = ref<string[]>(readStoredStrongToolIds());

  // Smart matching logic based on search box (top hero search only)
  // 工具推荐只由顶部搜索框驱动：inputContent 是主输入框（快速处理），不参与工具推荐。
  // 推荐/过滤逻辑为纯函数，见 src/lib/tool-search.ts。
  const matchedTools = computed(() => {
    const startTime = performance.now();
    const result = recommendToolsFor(tools, searchQuery.value);
    const duration = performance.now() - startTime;
    if (duration > 50) {
      logIfEnabled('warn', `[PERF] Tool matching slow: query="${searchQuery.value}" matched=${result.length} tools duration=${duration.toFixed(2)}ms`);
    } else if (duration > 20) {
      logIfEnabled('debug', `[PERF] Tool matching: query="${searchQuery.value}" matched=${result.length} tools duration=${duration.toFixed(2)}ms`);
    }
    return result;
  });

  // Search logic based on search bar
  const filteredTools = computed(() => {
    const startTime = performance.now();
    const result = filterToolsFor(tools, searchQuery.value);
    const duration = performance.now() - startTime;
    if (duration > 50) {
      logIfEnabled('warn', `[PERF] Tool filtering slow: query="${searchQuery.value}" filtered=${result.length} tools duration=${duration.toFixed(2)}ms`);
    } else if (duration > 20) {
      logIfEnabled('debug', `[PERF] Tool filtering: query="${searchQuery.value}" filtered=${result.length} tools duration=${duration.toFixed(2)}ms`);
    }
    return result;
  });

  const setActiveTool = (id: string | null) => {
    const startTime = performance.now();
    const previousId = activeToolId.value;
    activeToolId.value = id;
    const duration = performance.now() - startTime;
    logContext('info', 'store', 'setActiveTool', `from=${previousId} to=${id} duration=${duration.toFixed(2)}ms`);
  };

  /**
   * 设置全局主题模式并持久化
   * @param mode 主题模式
   */
  const setThemeMode = (mode: ThemeMode) => {
    themeMode.value = mode;
    safeSetString(THEME_STORAGE_KEY, mode);
  };

  /**
   * 在浅色 / 深色主题之间切换
   */
  const toggleThemeMode = () => {
    setThemeMode(themeMode.value === 'dark' ? 'light' : 'dark');
  };

  /**
   * 设置界面配色方案并持久化
   * @param skinId 皮肤 ID
   */
  const setThemeSkin = (skinId: ThemeSkinId) => {
    themeSkinId.value = skinId;
    themeMode.value = getThemeSkin(skinId).recommendedMode;
    safeSetString(THEME_SKIN_STORAGE_KEY, skinId);
    safeSetString(THEME_STORAGE_KEY, themeMode.value);
  };

  /**
   * 恢复默认界面配色方案
   */
  const resetThemeSkin = () => {
    setThemeSkin(DEFAULT_THEME_SKIN_ID);
  };

  /**
   * 设置全局背景图片（Data URL）
   * @param imageDataUrl 图片数据 URL
   */
  const setAppBackgroundImage = (imageDataUrl: string) => {
    appBackgroundImage.value = imageDataUrl;
    appBackgroundMode.value = imageDataUrl ? 'custom' : 'default';
    if (imageDataUrl) {
      safeSetString(CONFIG_KEYS.appBackgroundImage, imageDataUrl);
    } else {
      safeRemove(CONFIG_KEYS.appBackgroundImage);
    }
    safeSetString(CONFIG_KEYS.appBackgroundMode, appBackgroundMode.value);
  };

  const setAppBackgroundMode = (mode: AppBackgroundMode) => {
    appBackgroundMode.value = mode;
    safeSetString(CONFIG_KEYS.appBackgroundMode, mode);
  };

  const setHomeMotionEnabled = (enabled: boolean) => {
    homeMotionEnabled.value = enabled;
    safeSetString(CONFIG_KEYS.homeMotionEnabled, String(enabled));
  };

  /**
   * 判断工具是否在首页「强力工具」入口中
   * @param toolId 工具 ID
   */
  const isStrongTool = (toolId: string) => strongToolIds.value.includes(toolId);

  /**
   * 切换工具的「强力工具」入口状态并持久化
   * @param toolId 工具 ID
   */
  const toggleStrongTool = (toolId: string) => {
    if (!tools.some((tool) => tool.metadata.id === toolId)) return;

    strongToolIds.value = isStrongTool(toolId)
      ? strongToolIds.value.filter((id) => id !== toolId)
      : [toolId, ...strongToolIds.value];

    persistToolIds(CONFIG_KEYS.strongToolIds, strongToolIds.value);
  };

  /**
   * 批量设置强力工具入口并持久化；顺序即展示顺序
   * @param ids 工具 ID 列表
   */
  const setStrongToolIds = (ids: string[]) => {
    const validIds = ids.filter((id) => tools.some((tool) => tool.metadata.id === id));
    strongToolIds.value = Array.from(new Set(validIds));
    persistToolIds(CONFIG_KEYS.strongToolIds, strongToolIds.value);
  };

  /**
   * 恢复强力工具为默认入口
   */
  const resetStrongToolIds = () => {
    strongToolIds.value = [...DEFAULT_STRONG_TOOL_IDS];
    persistToolIds(CONFIG_KEYS.strongToolIds, strongToolIds.value);
  };

  /**
   * 判断工具是否已收藏
   * @param toolId 工具 ID
   */
  const isFavoriteTool = (toolId: string) => favoriteToolIds.value.includes(toolId);
  /**
   * 切换工具收藏状态并持久化
   * @param toolId 工具 ID
   */
  const toggleFavoriteTool = (toolId: string) => {
    if (!tools.some((tool) => tool.metadata.id === toolId)) return;

    favoriteToolIds.value = isFavoriteTool(toolId)
      ? favoriteToolIds.value.filter((id) => id !== toolId)
      : [toolId, ...favoriteToolIds.value];

    persistToolIds(CONFIG_KEYS.favoriteToolIds, favoriteToolIds.value);
  };

  /**
   * 记录最近使用工具，重复使用时置顶
   * @param toolId 工具 ID
   */
  const addRecentTool = (toolId: string) => {
    if (!tools.some((tool) => tool.metadata.id === toolId)) return;

    recentToolIds.value = [
      toolId,
      ...recentToolIds.value.filter((id) => id !== toolId),
    ].slice(0, RECENT_TOOL_LIMIT);

    persistToolIds(CONFIG_KEYS.recentToolIds, recentToolIds.value);
  };

  /**
   * 设置首页所有工具的自定义排序；该顺序优先于收藏置顶规则
   * @param ids 用户拖拽后的工具 ID 顺序
   */
  const setHomeToolOrder = (ids: string[]) => {
    const validToolIds = tools.map((tool) => tool.metadata.id);
    const uniqueIds = Array.from(new Set(ids)).filter((id) => validToolIds.includes(id));
    homeToolOrderIds.value = [
      ...uniqueIds,
      ...validToolIds.filter((id) => !uniqueIds.includes(id)),
    ];
    persistToolIds(CONFIG_KEYS.homeToolOrderIds, homeToolOrderIds.value);
  };

  /**
   * 创建「单值快捷键」的 set / reset 绑定，收敛六组几乎相同的样板逻辑。
   * @param target 目标快捷键 ref
   * @param storageKey 持久化 key
   * @param fallback 默认值（输入为空或全空白时回退到它）
   */
  const bindShortcut = (target: Ref<string>, storageKey: string, fallback: string) => {
    const set = (shortcut: string) => {
      const normalized = shortcut.trim() || fallback;
      target.value = normalized;
      safeSetString(storageKey, normalized);
    };
    return {
      set,
      reset: () => set(fallback),
    };
  };

  const { set: setHomeShortcut, reset: resetHomeShortcut } = bindShortcut(
    homeShortcut,
    CONFIG_KEYS.homeShortcut,
    DEFAULT_HOME_SHORTCUT,
  );
  const { set: setShowShortcut, reset: resetShowShortcut } = bindShortcut(
    showShortcut,
    CONFIG_KEYS.showShortcut,
    DEFAULT_SHOW_SHORTCUT,
  );
  const { set: setUniversalScreenshotShortcut, reset: resetUniversalScreenshotShortcut } = bindShortcut(
    universalScreenshotShortcut,
    CONFIG_KEYS.universalScreenshotShortcut,
    DEFAULT_UNIVERSAL_SCREENSHOT_SHORTCUT,
  );
  const { set: setStickyShortcut, reset: resetStickyShortcut } = bindShortcut(
    stickyShortcut,
    CONFIG_KEYS.stickyShortcut,
    DEFAULT_STICKY_SHORTCUT,
  );
  const { set: setSingleStickyShortcut, reset: resetSingleStickyShortcut } = bindShortcut(
    singleStickyShortcut,
    CONFIG_KEYS.singleStickyShortcut,
    DEFAULT_SINGLE_STICKY_SHORTCUT,
  );
  const { set: setPinRecoveryShortcut, reset: resetPinRecoveryShortcut } = bindShortcut(
    pinRecoveryShortcut,
    CONFIG_KEYS.pinRecoveryShortcut,
    DEFAULT_PIN_RECOVERY_SHORTCUT,
  );

  /**
   * 设置某工具的拉起快捷键（写入本地存储，空串则清除）。
   * @param toolId 工具 id
   * @param shortcut 快捷键字符串（如 Ctrl+Alt+1）；空串表示清除
   */
  const setToolShortcut = (toolId: string, shortcut: string) => {
    const normalized = shortcut.trim();
    const next = { ...toolShortcuts.value };
    if (normalized) next[toolId] = normalized;
    else delete next[toolId];
    toolShortcuts.value = next;
    safeSetJson(CONFIG_KEYS.toolShortcuts, next);
  };

  /**
   * 清除某工具的拉起快捷键
   * @param toolId 工具 id
   */
  const clearToolShortcut = (toolId: string) => setToolShortcut(toolId, '');

  /**
   * 设置某文本管线的拉起快捷键（写入本地存储，空串则清除）。
   * @param target 管线 target（`preset:<op>` 或已存管线名）
   * @param shortcut 快捷键字符串；空串表示清除
   */
  const setPipelineShortcut = (target: string, shortcut: string) => {
    const normalized = shortcut.trim();
    const next = { ...pipelineShortcuts.value };
    if (normalized) next[target] = normalized;
    else delete next[target];
    pipelineShortcuts.value = next;
    safeSetJson(CONFIG_KEYS.pipelineShortcuts, next);
  };

  /**
   * 清除某文本管线的拉起快捷键
   */
  const clearPipelineShortcut = (target: string) => setPipelineShortcut(target, '');

  /**
   * 显示一个 Toast 提示
   * @param message 提示内容
   * @param options 配置项
   */
  const showToast = (message: string, options?: Partial<Pick<ToastItem, 'type' | 'durationMs'>>) => {
    const toast: ToastItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message,
      type: options?.type ?? 'info',
      durationMs: options?.durationMs ?? DEFAULT_TOAST_DURATION_MS,
    };

    toasts.value = [...toasts.value, toast];

    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== toast.id);
    }, toast.durationMs);
  };

  return {
    searchQuery,
    inputContent,
    recommendTools: (input: string) => recommendToolsFor(tools, input),
    pendingScrollPreviewToken,
    themeMode,
    themeSkinId,
    appBackgroundImage,
    appBackgroundMode,
    homeMotionEnabled,
    homeShortcut,
    showShortcut,
    universalScreenshotShortcut,
    stickyShortcut,
    singleStickyShortcut,
    pinRecoveryShortcut,
    toolShortcuts,
    pipelineShortcuts,
    favoriteToolIds,
    recentToolIds,
    homeToolOrderIds,
    strongToolIds,
    activeToolId,
    matchedTools,
    filteredTools,
    setActiveTool,
    setThemeMode,
    toggleThemeMode,
    setThemeSkin,
    resetThemeSkin,
    setAppBackgroundImage,
    setAppBackgroundMode,
    setHomeMotionEnabled,
    isFavoriteTool,
    toggleFavoriteTool,
    isStrongTool,
    toggleStrongTool,
    setStrongToolIds,
    resetStrongToolIds,
    addRecentTool,
    setHomeToolOrder,
    setHomeShortcut,
    resetHomeShortcut,
    setShowShortcut,
    resetShowShortcut,
    setUniversalScreenshotShortcut,
    resetUniversalScreenshotShortcut,
    setStickyShortcut,
    resetStickyShortcut,
    setSingleStickyShortcut,
    resetSingleStickyShortcut,
    setPinRecoveryShortcut,
    resetPinRecoveryShortcut,
    setToolShortcut,
    clearToolShortcut,
    setPipelineShortcut,
    clearPipelineShortcut,
    toasts,
    showToast,
  };
});
