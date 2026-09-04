import { invoke } from '@tauri-apps/api/core';
import type { HistoryRecordSummary } from '@/tools/screenshot-universal/shared/history-model';
import type {
  HistoryImageVariant,
  HistoryQuotaSettings,
  HistoryRecordDetail,
  HistorySaveAsResult,
  OverlayInitInfo,
  PhysicalDesktopRectI32,
  PinCreateResult,
  PinState,
  ScrollProgress,
  ScrollPublishResult,
  ScrollStartResult,
  ScrollStopResult,
  StartOverlaySession,
  TrashReceipt,
} from './bindings';

export type {
  HistoryImageVariant,
  HistoryQuotaSettings,
  HistoryRecordDetail,
  HistorySaveAsResult,
  OverlayInitInfo,
  PhysicalDesktopRectI32,
  PinCreateResult,
  PinState,
  ScrollProgress,
  ScrollPublishResult,
  ScrollStartResult,
  ScrollStopResult,
  StartOverlaySession,
  TrashReceipt,
};

export const screenshotUniversalStart = (): Promise<StartOverlaySession> =>
  invoke<StartOverlaySession>('screenshot_universal_start');

export const screenshotUniversalOverlayInit = (): Promise<OverlayInitInfo> =>
  invoke<OverlayInitInfo>('screenshot_universal_overlay_init', {});

export const screenshotUniversalCancel = (request: { sessionId: string | undefined }): Promise<void> =>
  invoke('screenshot_universal_cancel', request);

export const screenshotUniversalFinish = (request: {
  sessionId: string | undefined;
  originalPng: number[];
  finalPng: number[];
  action: string;
}): Promise<void> => invoke('screenshot_universal_finish', request);

export const scrollCaptureStart = (request: { selection: PhysicalDesktopRectI32 }): Promise<ScrollStartResult> =>
  invoke<ScrollStartResult>('scroll_capture_start', request);

export const scrollCaptureNext = (): Promise<ScrollProgress> => invoke<ScrollProgress>('scroll_capture_next');

export const scrollCaptureStop = (): Promise<ScrollStopResult> => invoke<ScrollStopResult>('scroll_capture_stop');

export const scrollCaptureCancel = (): Promise<void> => invoke('scroll_capture_cancel');

export const scrollCaptureFinish = (request: { action: string }): Promise<void> =>
  invoke('scroll_capture_finish', request);

export const scrollCapturePublish = (): Promise<ScrollPublishResult> =>
  invoke<ScrollPublishResult>('scroll_capture_publish');

export const scrollCaptureHasResult = (): Promise<string | null> => invoke<string | null>('scroll_capture_has_result');

export const pinCreateFromHistory = (request: { recordId: string; variant: HistoryImageVariant }): Promise<PinCreateResult> =>
  invoke<PinCreateResult>('pin_create_from_history', request);

export const pinGetState = (request: { pinId: string }): Promise<PinState> => invoke<PinState>('pin_get_state', request);

export const pinStartDrag = (request: { pinId: string }): Promise<void> => invoke('pin_start_drag', request);

export const pinClose = (request: { pinId: string }): Promise<void> => invoke('pin_close', request);

export const pinSetZoom = (request: { pinId: string; zoomPercent: number }): Promise<PinState> =>
  invoke<PinState>('pin_set_zoom', request);

export const pinSetRotation = (request: { pinId: string; rotation: number }): Promise<PinState> =>
  invoke<PinState>('pin_set_rotation', request);

export const pinSetFlip = (request: { pinId: string; horizontal: boolean; vertical: boolean }): Promise<PinState> =>
  invoke<PinState>('pin_set_flip', request);

export const pinSetGroup = (request: { pinId: string; group: number }): Promise<PinState> =>
  invoke<PinState>('pin_set_group', request);

export const pinSetOpacity = (request: { pinId: string; opacityPercent: number }): Promise<PinState> =>
  invoke<PinState>('pin_set_opacity', request);

export const pinReset = (request: { pinId: string }): Promise<PinState> => invoke<PinState>('pin_reset', request);

export const pinSetClickThrough = (request: { pinId: string; enabled: boolean }): Promise<PinState> =>
  invoke<PinState>('pin_set_click_through', request);

export const historyReadThumbnail = (request: { recordId: string }): Promise<number[]> =>
  invoke<number[]>('history_read_thumbnail', request);

export const historyReadImageToken = (request: { token: string }): Promise<number[]> =>
  invoke<number[]>('history_read_image_token', request);

export const historyGetRecord = (request: { recordId: string }): Promise<HistoryRecordDetail> =>
  invoke<HistoryRecordDetail>('history_get_record', request);

export const historyListRecords = (): Promise<HistoryRecordSummary[]> => invoke<HistoryRecordSummary[]>('history_list_records');

export const historySaveAs = (request: { recordId: string; variant: HistoryImageVariant }): Promise<HistorySaveAsResult> =>
  invoke<HistorySaveAsResult>('history_save_as', request);

export const historyDeleteRecord = (request: {
  recordId: string;
}): Promise<TrashReceipt> =>
  invoke<TrashReceipt>('history_delete_record', request);

export const historyClearAll = (): Promise<number> => invoke<number>('history_clear_all');

export const historyGetQuotaSettings = (): Promise<HistoryQuotaSettings> => invoke<HistoryQuotaSettings>('history_get_quota_settings');

export const historySetQuotaSettings = (request: { quotaBytes: number }): Promise<HistoryQuotaSettings> =>
  invoke<HistoryQuotaSettings>('history_set_quota_settings', request);
