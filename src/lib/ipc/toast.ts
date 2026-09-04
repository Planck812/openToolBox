import { invoke } from '@tauri-apps/api/core';
import type { ToastPayload } from './bindings';

export type { ToastPayload };

export const toastShow = (request: { message: string; isError?: boolean }): Promise<void> =>
  invoke('toast_show', request);

export const toastGet = (): Promise<ToastPayload | null> => invoke<ToastPayload | null>('toast_get');
