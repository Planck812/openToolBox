import { invoke } from '@tauri-apps/api/core';
import type { StickyNoteData, StickySingleStatus } from './bindings';

export type { StickyNoteData, StickySingleStatus };

export const stickyCreate = (note?: StickyNoteData): Promise<void> =>
  note === undefined ? invoke('sticky_create') : invoke('sticky_create', { note });

export const stickyUpdate = (note: StickyNoteData): Promise<void> => invoke('sticky_update', { note });

export const stickyDelete = (id: string): Promise<void> => invoke('sticky_delete', { id });

export const stickyList = (): Promise<StickyNoteData[]> => invoke<StickyNoteData[]>('sticky_list');

export const stickySingleStatus = (): Promise<StickySingleStatus> => invoke<StickySingleStatus>('sticky_single_status');

export const stickySingleToggle = (): Promise<StickySingleStatus> => invoke<StickySingleStatus>('sticky_single_toggle');

export const stickyShowGroup = (group: string): Promise<number> => invoke<number>('sticky_show_group', { group });
