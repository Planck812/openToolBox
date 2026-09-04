import { invoke } from '@tauri-apps/api/core';
import type {
  Alarm,
  AlertPayload,
  Countdown,
  CountdownPreset,
  HistoryEntry,
  PomodoroConfig,
  PomodoroPersist,
  PomodoroState,
} from './bindings';

export type {
  Alarm,
  AlertPayload,
  Countdown,
  CountdownPreset,
  HistoryEntry,
  PomodoroConfig,
  PomodoroPersist,
  PomodoroState,
};

/** Add-alarm request. Parameter names match the Rust `timer_add_alarm` command. */
export type AddAlarmRequest = {
  label: string;
  hour: number;
  minute: number;
  repeatDays: number[];
};

/** Start-countdown request. Parameter names match the Rust `timer_start_countdown` command. */
export type StartCountdownRequest = {
  name: string;
  totalSeconds: number;
};

export const timerGetAlarms = (): Promise<Alarm[]> => invoke<Alarm[]>('timer_get_alarms');

export const timerAddAlarm = (request: AddAlarmRequest): Promise<void> => invoke('timer_add_alarm', request);

export const timerUpdateAlarm = (alarm: Alarm): Promise<void> => invoke('timer_update_alarm', { alarm });

export const timerDeleteAlarm = (id: string): Promise<void> => invoke('timer_delete_alarm', { id });

export const timerGetCountdown = (): Promise<Countdown | null> => invoke<Countdown | null>('timer_get_countdown');

export const timerStartCountdown = (request: StartCountdownRequest): Promise<Countdown> =>
  invoke<Countdown>('timer_start_countdown', request);

export const timerPauseCountdown = (): Promise<void> => invoke('timer_pause_countdown');

export const timerResumeCountdown = (): Promise<void> => invoke('timer_resume_countdown');

export const timerCancelCountdown = (): Promise<void> => invoke('timer_cancel_countdown');

export const timerGetPomodoro = (): Promise<PomodoroPersist> => invoke<PomodoroPersist>('timer_get_pomodoro');

export const timerSetPomodoroConfig = (config: PomodoroConfig): Promise<void> =>
  invoke('timer_set_pomodoro_config', {
    workMinutes: config.workMinutes,
    shortBreakMinutes: config.shortBreakMinutes,
    longBreakMinutes: config.longBreakMinutes,
    intervalForLongBreak: config.intervalForLongBreak,
  });

export const timerStartPomodoro = (): Promise<void> => invoke('timer_start_pomodoro');

export const timerPausePomodoro = (): Promise<void> => invoke('timer_pause_pomodoro');

export const timerSkipPhase = (): Promise<void> => invoke('timer_skip_phase');

export const timerResetPomodoro = (): Promise<void> => invoke('timer_reset_pomodoro');

export const timerGetPresets = (): Promise<CountdownPreset[]> => invoke<CountdownPreset[]>('timer_get_presets');

export const timerAddPreset = (request: { seconds: number; name: string }): Promise<void> =>
  invoke('timer_add_preset', request);

export const timerRemovePreset = (id: string): Promise<void> => invoke('timer_remove_preset', { id });

export const timerGetChime = (): Promise<boolean> => invoke<boolean>('timer_get_chime');

export const timerSetChime = (enabled: boolean): Promise<void> => invoke('timer_set_chime', { enabled });

export const timerGetHistory = (): Promise<HistoryEntry[]> => invoke<HistoryEntry[]>('timer_get_history');

export const timerClearHistory = (): Promise<void> => invoke('timer_clear_history');

export const timerGetAlert = (request: { kind: string; id: string }): Promise<AlertPayload> =>
  invoke<AlertPayload>('timer_get_alert', request);

export const timerAlertAction = (request: { kind: string; action: string; id: string }): Promise<void> =>
  invoke('timer_alert_action', request);
