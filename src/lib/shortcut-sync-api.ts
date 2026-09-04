/**
 * 快捷键同步业务层（从 useShortcutSync 拆分）。
 *
 * 职责：把单个/批量快捷键配置同步到 Rust 后端真实注册，统一错误诊断状态与日志；
 * useShortcutSync（composable）只负责 watch / listen 编排。
 * 底层命令调用统一走 `@/lib/ipc/shortcuts`（命令名唯一），本文件不直接 invoke。
 */
import { logToFile } from '@/lib/logger';
import {
  syncHomeShortcut as ipcSyncHomeShortcut,
  syncPinRecoveryShortcut as ipcSyncPinRecoveryShortcut,
  syncPipelineShortcuts as ipcSyncPipelineShortcuts,
  syncShowShortcut as ipcSyncShowShortcut,
  syncSingleStickyShortcut as ipcSyncSingleStickyShortcut,
  syncStickyShortcut as ipcSyncStickyShortcut,
  syncToolShortcuts as ipcSyncToolShortcuts,
  syncUniversalScreenshotShortcut as ipcSyncUniversalScreenshotShortcut,
  type ShortcutSyncResponse,
} from '@/lib/ipc/shortcuts';

export type HomeShortcutSyncResult = ShortcutSyncResponse;

export type HomeShortcutTriggeredPayload = {
  shortcut: string;
  triggeredAt: number;
};

/** 快捷键诊断状态（模块级，不暴露到 window——避免生产环境残留调试后门）。 */
export type ShortcutDiagnostics = {
  isTauri: boolean;
  homeShortcut: string | null;
  showShortcut: string | null;
  registeredShortcut: string | null;
  registeredShowShortcut: string | null;
  lastError: string | null;
  lastShowError: string | null;
  lastScreenshotError: string | null;
  lastTriggeredAt: number | null;
};

export type ShortcutDebugStatePartial = Partial<ShortcutDiagnostics>;

const shortcutDebugState: ShortcutDiagnostics = {
  isTauri: false,
  homeShortcut: null,
  showShortcut: null,
  registeredShortcut: null,
  registeredShowShortcut: null,
  lastError: null,
  lastShowError: null,
  lastScreenshotError: null,
  lastTriggeredAt: null,
};

export const getShortcutDebugState = (): ShortcutDiagnostics => shortcutDebugState;

export const syncShortcutDebugState = (partial: ShortcutDebugStatePartial) => {
  Object.assign(shortcutDebugState, partial);
};

let registeredHomeShortcut: string | null = null;
let registeredShowShortcut: string | null = null;
let lastRegistrationError: string | null = null;
let lastShowRegistrationError: string | null = null;

/**
 * 同步单个快捷键到 Rust 后端，返回是否注册成功。
 * 各快捷键的差异（更新注册状态/诊断信息）通过 hooks 注入，消除重复。
 * @param run 执行注册的底层命令封装（来自 ipc/shortcuts）
 * @param shortcut 快捷键字符串
 * @param label 日志标签
 * @param hooks 可选的注册成功/失败回调
 */
const syncShortcut = async (
  run: (shortcut: string) => Promise<ShortcutSyncResponse>,
  shortcut: string,
  label: string,
  hooks?: {
    onRegistered?: (registered: string | null, error: string | null) => void;
    onError?: (error: string) => void;
  },
): Promise<boolean> => {
  const normalized = shortcut.trim();
  if (!normalized) return false;

  try {
    await logToFile('info', `${label} - requested shortcut: ${normalized}`);

    const result = await run(normalized);
    await logToFile('info', `${label} - backend result`, result);

    if (!result.success || result.registeredShortcut !== normalized) {
      throw new Error(result.error ?? `Shortcut ${normalized} failed to sync`);
    }

    hooks?.onRegistered?.(result.registeredShortcut, result.error);
    await logToFile('info', `${label} - ✅ registered shortcut: ${normalized}`);
    return true;
  } catch (e) {
    const message = (e as { message?: string })?.message ?? String(e);
    await logToFile('error', `${label} - failed to sync ${normalized}`, e);
    hooks?.onError?.(message);
    return false;
  }
};

/**
 * 同步主页快捷键到 Rust 后端，由后端负责真实注册和触发。
 */
export const syncHomeShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncHomeShortcut, shortcut, 'syncHomeShortcut', {
    onRegistered: (registered, error) => {
      registeredHomeShortcut = registered;
      lastRegistrationError = error;
      syncShortcutDebugState({ registeredShortcut: registered, lastError: error });
    },
    onError: (error) => {
      registeredHomeShortcut = null;
      lastRegistrationError = error;
      syncShortcutDebugState({ registeredShortcut: null, lastError: error });
    },
  });

/**
 * 同步窗口唤起快捷键到 Rust 后端；该快捷键只拉起当前页面。
 */
export const syncShowShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncShowShortcut, shortcut, 'syncShowShortcut', {
    onRegistered: (registered, error) => {
      registeredShowShortcut = registered;
      lastShowRegistrationError = error;
      syncShortcutDebugState({ registeredShowShortcut: registered, lastShowError: error });
    },
    onError: (error) => {
      registeredShowShortcut = null;
      lastShowRegistrationError = error;
      syncShortcutDebugState({ registeredShowShortcut: null, lastShowError: error });
    },
  });

/**
 * 同步全平台截图快捷键到 Rust 后端，由后端负责真实注册和触发。
 */
export const syncUniversalScreenshotShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncUniversalScreenshotShortcut, shortcut, 'syncUniversalScreenshotShortcut');

export const syncStickyShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncStickyShortcut, shortcut, 'syncStickyShortcut');

export const syncSingleStickyShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncSingleStickyShortcut, shortcut, 'syncSingleStickyShortcut');

export const syncPinRecoveryShortcut = (shortcut: string) =>
  syncShortcut(ipcSyncPinRecoveryShortcut, shortcut, 'syncPinRecoveryShortcut');

/**
 * 初始化诊断状态（读取模块内私有已注册值）。
 * 由 useShortcutSync 在挂载时调用。
 */
export const initShortcutDiagnostics = (deps: {
  isTauri: boolean;
  homeShortcut: string;
  showShortcut: string;
}) => {
  syncShortcutDebugState({
    isTauri: deps.isTauri,
    homeShortcut: deps.homeShortcut,
    showShortcut: deps.showShortcut,
    registeredShortcut: registeredHomeShortcut,
    registeredShowShortcut,
    lastError: lastRegistrationError,
    lastShowError: lastShowRegistrationError,
    lastTriggeredAt: null,
  });
};

/**
 * 卸载时清空模块内已注册状态（防止跨会话残留）。
 */
export const resetShortcutRegistrationState = () => {
  registeredHomeShortcut = null;
  registeredShowShortcut = null;
};

/**
 * 同步工具级拉起快捷键到 Rust 后端，由后端负责真实注册与冲突校验。
 * @param shortcuts toolId -> 快捷键 映射（空串/缺省视为无）
 */
export const syncToolShortcuts = async (shortcuts: Record<string, string>) => {
  try {
    return await ipcSyncToolShortcuts(shortcuts);
  } catch (e) {
    await logToFile('error', 'syncToolShortcuts - invoke failed:', e);
    return { success: false, error: String(e), errors: {} };
  }
};

/**
 * 同步文本管线拉起快捷键到 Rust 后端（target -> 快捷键 映射）。
 * @param shortcuts target -> 快捷键；空串/缺省视为无
 */
export const syncPipelineShortcuts = async (shortcuts: Record<string, string>) => {
  try {
    return await ipcSyncPipelineShortcuts(shortcuts);
  } catch (e) {
    await logToFile('error', 'syncPipelineShortcuts - invoke failed:', e);
    return { success: false, error: String(e), errors: {} };
  }
};
