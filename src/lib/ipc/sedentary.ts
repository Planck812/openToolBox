import { invoke } from '@tauri-apps/api/core';
import type { QuietPeriod, SedentaryGetConfigResponse, SedentaryGetStateResponse } from './bindings';

export type { QuietPeriod, SedentaryGetConfigResponse, SedentaryGetStateResponse };

/** Set-config request. Parameter names match the Rust `sedentary_set_config` command. */
export type SedentarySetConfigRequest = {
  remindMinutes: number;
  idleResetMinutes: number;
  message: string;
  videoEnabled: boolean;
  quietPeriods: QuietPeriod[];
};

export const sedentaryGetConfig = (): Promise<SedentaryGetConfigResponse> =>
  invoke<SedentaryGetConfigResponse>('sedentary_get_config');

export const sedentarySetConfig = (request: SedentarySetConfigRequest): Promise<void> =>
  invoke('sedentary_set_config', request);

export const sedentaryGetState = (): Promise<SedentaryGetStateResponse> =>
  invoke<SedentaryGetStateResponse>('sedentary_get_state');

export const sedentaryRemindAction = (action: string): Promise<void> => invoke('sedentary_remind_action', { action });

export const sedentaryToggle = (enabled: boolean): Promise<void> => invoke('sedentary_toggle', { enabled });

export const sedentaryPreview = (): Promise<void> => invoke('sedentary_preview');

export const sedentarySetUserVideo = (sourcePath: string): Promise<string> =>
  invoke<string>('sedentary_set_user_video', { sourcePath });

export const sedentaryResetUserVideo = (): Promise<string> => invoke<string>('sedentary_reset_user_video');
