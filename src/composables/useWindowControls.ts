import { ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { logToFile } from '@/lib/logger';

// 窗口状态在单个 webview 内是单例；模块级 ref 保证 App.vue 与 useShortcutSync 共享同一实例
// （useShortcutSync 的 onResized 刷新时需更新模板绑定的同一 ref）。
const isWindowMaximized = ref(false);
const isWindowAlwaysOnTop = ref(false);

/**
 * 判断是否运行在 Tauri 环境
 */
const isTauriRuntime = () => {
  const tauriGlobal = window as unknown as Record<string, unknown>;
  return Boolean(tauriGlobal.__TAURI_INTERNALS__ || tauriGlobal.__TAURI__ || tauriGlobal.__TAURI_IPC__);
};

/**
 * 获取当前 Tauri 窗口；浏览器预览环境直接返回空，避免调试时报错
 */
const getTauriWindow = () => (isTauriRuntime() ? getCurrentWindow() : null);

/**
 * 确保窗口被显示并聚焦，单步失败也不中断后续步骤
 */
const ensureWindowActivated = async (source: string) => {
  const appWindow = getCurrentWindow();
  await logToFile('info', `${source} - Got window: ${appWindow ? 'YES' : 'NO'}`);

  if (!appWindow) {
    await logToFile('error', `${source} - ❌ Failed to get main window`);
    return null;
  }

  const steps: Array<{ name: string; action: () => Promise<void> }> = [
    { name: 'show', action: () => appWindow.show() },
    { name: 'unminimize', action: () => appWindow.unminimize() },
    { name: 'setFocus', action: () => appWindow.setFocus() },
  ];

  for (const step of steps) {
    try {
      await logToFile('debug', `${source} - ${step.name} start`);
      await step.action();
      await logToFile('debug', `${source} - ${step.name} done`);
    } catch (err) {
      await logToFile('warn', `${source} - ${step.name} failed`, err);
    }
  }

  return appWindow;
};

/**
 * 窗口状态与标题栏交互（拆分自 App.vue）。
 */
export function useWindowControls() {
  const store = useAppStore();
  const { t } = useI18n();

  /**
   * 同步窗口最大化状态，用于切换标题栏按钮图标与提示
   */
  const refreshWindowMaximizedState = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;

    try {
      isWindowMaximized.value = await appWindow.isMaximized();
    } catch (e) {
      console.warn('Failed to refresh window maximize state:', e);
    }
  };

  /**
   * 同步窗口置顶状态，用于标题栏固定按钮高亮
   */
  const refreshWindowAlwaysOnTopState = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;

    try {
      isWindowAlwaysOnTop.value = await appWindow.isAlwaysOnTop();
    } catch (e) {
      console.warn('Failed to refresh window always-on-top state:', e);
    }
  };

  /**
   * 最小化当前窗口
   */
  const minimizeWindow = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;
    await appWindow.minimize();
  };

  /**
   * 最大化/还原当前窗口
   */
  const toggleWindowMaximize = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;

    await appWindow.toggleMaximize();
    window.setTimeout(() => {
      refreshWindowMaximizedState();
    }, 80);
  };

  /**
   * 切换窗口是否固定显示在最前面
   */
  const toggleWindowAlwaysOnTop = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;

    const nextValue = !isWindowAlwaysOnTop.value;
    await appWindow.setAlwaysOnTop(nextValue);
    isWindowAlwaysOnTop.value = nextValue;
    store.showToast(nextValue ? t('app.window_pinned') : t('app.window_unpinned'), { type: 'success' });
  };

  /**
   * 关闭当前窗口
   */
  const closeWindow = async () => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;
    await appWindow.close();
  };

  /**
   * 鼠标按下标题栏空白区域时开始拖拽窗口，按钮区域会阻止冒泡
   * @param e 鼠标事件
   */
  const handleTitlebarMouseDown = async (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (e.detail > 1) return;

    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[data-window-control]')) return;

    const appWindow = getTauriWindow();
    if (!appWindow) return;
    try {
      await appWindow.startDragging();
    } catch (err) {
      console.warn('Failed to start window dragging:', err);
    }
  };

  /**
   * 双击自定义标题栏时切换最大化，避开右侧窗口控制按钮
   * @param e 鼠标事件
   */
  const handleTitlebarDoubleClick = async (e: MouseEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[data-window-control]')) return;
    await toggleWindowMaximize();
  };

  return {
    isWindowMaximized,
    isWindowAlwaysOnTop,
    ensureWindowActivated,
    refreshWindowMaximizedState,
    refreshWindowAlwaysOnTopState,
    minimizeWindow,
    toggleWindowMaximize,
    toggleWindowAlwaysOnTop,
    closeWindow,
    handleTitlebarMouseDown,
    handleTitlebarDoubleClick,
    isTauriRuntime,
    getTauriWindow,
  };
}
