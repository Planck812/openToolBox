import { ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { logToFile } from '@/lib/logger';
import { isTauriEnvironment } from '@/lib/tauri-env';

// 窗口状态在单个 webview 内是单例；模块级 ref 保证 App.vue 与 useShortcutSync 共享同一实例
// （useShortcutSync 的 onResized 刷新时需更新模板绑定的同一 ref）。
const isWindowMaximized = ref(false);
const isWindowAlwaysOnTop = ref(false);

/**
 * 最大化状态查询的冷却时长（毫秒）。用于切断 macOS 无边框窗口下
 * `resize → isMaximized() → setStyleMask → resize` 的自激循环，
 * 详见 `refreshWindowMaximizedState` 的注释。
 */
const MAXIMIZED_QUERY_COOLDOWN_MS = 300;
/** 冷却截止时刻（模块级：与 isWindowMaximized 同为单 webview 内单例）。 */
let maximizedQuerySuppressedUntil = 0;

/**
 * 判断是否运行在 Tauri 环境
 */
const isTauriRuntime = () => isTauriEnvironment();

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
   *
   * macOS 自激循环防护：本应用主窗口为 `decorations: false`（无边框），而 tao 在
   * macOS 上实现 `is_maximized()` 时，因 `isZoomed` 对无边框窗口失效，会临时把
   * styleMask 切成 Titled|Resizable 读完再切回（tao `window.rs` 的 `is_zoomed()`）。
   * 每次 `setStyleMask:` 都会让 AppKit 重建 NSThemeFrame 并再次派发 resize 事件，
   * 而 resize 回调里又会调用本函数 —— 于是形成
   * `resize → isMaximized() → setStyleMask ×2 → resize ×2 → …` 的指数级自激循环，
   * 主线程被打满后窗口无法拖动、标题栏按钮与快捷面板全部失去响应（macOS 实测复现）。
   *
   * 因此这里做冷却节流：一次查询后的 COOLDOWN 窗口内直接跳过。由查询自身引发的
   * 那两个 resize 事件落在冷却窗口内被丢弃，不再触发新的查询，循环即被切断；
   * 真实的用户缩放仍能在冷却结束后正常刷新状态。
   */
  const refreshWindowMaximizedState = async (options?: { force?: boolean }) => {
    const appWindow = getTauriWindow();
    if (!appWindow) return;
    // force：用户显式操作（如点最大化按钮）后的刷新，必须拿到最新状态，不受冷却限制。
    if (!options?.force && Date.now() < maximizedQuerySuppressedUntil) return;

    try {
      isWindowMaximized.value = await appWindow.isMaximized();
    } catch (e) {
      console.warn('Failed to refresh window maximize state:', e);
    } finally {
      // 冷却起点放在查询「之后」：styleMask 回切引发的 resize 事件晚于查询到达。
      maximizedQuerySuppressedUntil = Date.now() + MAXIMIZED_QUERY_COOLDOWN_MS;
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
    if (!appWindow) {
      isWindowMaximized.value = !isWindowMaximized.value;
      return;
    }

    await appWindow.toggleMaximize();
    window.setTimeout(() => {
      // 用户主动切换，强制读取真实状态（toggleMaximize 自身产生的 resize 事件
      // 可能刚把冷却窗口顶起来，不 force 会读不到新状态、图标不翻转）。
      refreshWindowMaximizedState({ force: true });
    }, 80);
  };

  /**
   * 切换窗口是否固定显示在最前面
   */
  const toggleWindowAlwaysOnTop = async () => {
    const appWindow = getTauriWindow();
    const nextValue = !isWindowAlwaysOnTop.value;
    if (appWindow) {
      await appWindow.setAlwaysOnTop(nextValue);
    }
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
