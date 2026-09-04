import { invoke } from '@tauri-apps/api/core';
import type {
  PipelineShortcutsSyncResponse,
  ShortcutSyncResponse,
  ToolShortcutsSyncResponse,
} from './bindings';

export type { PipelineShortcutsSyncResponse, ShortcutSyncResponse, ToolShortcutsSyncResponse };

export const syncHomeShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_home_shortcut', { shortcut });

export const syncShowShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_show_shortcut', { shortcut });

export const syncUniversalScreenshotShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_universal_screenshot_shortcut', { shortcut });

export const syncStickyShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_sticky_shortcut', { shortcut });

export const syncSingleStickyShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_single_sticky_shortcut', { shortcut });

export const syncPinRecoveryShortcut = (shortcut: string): Promise<ShortcutSyncResponse> =>
  invoke<ShortcutSyncResponse>('sync_pin_recovery_shortcut', { shortcut });

export const syncToolShortcuts = (shortcuts: Record<string, string>): Promise<ToolShortcutsSyncResponse> =>
  invoke<ToolShortcutsSyncResponse>('sync_tool_shortcuts', { shortcuts });

export const syncPipelineShortcuts = (shortcuts: Record<string, string>): Promise<PipelineShortcutsSyncResponse> =>
  invoke<PipelineShortcutsSyncResponse>('sync_pipeline_shortcuts', { shortcuts });
