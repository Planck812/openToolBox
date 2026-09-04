import { invoke } from '@tauri-apps/api/core';
import type { OcrLine, OcrResult } from './bindings';

export type { OcrLine, OcrResult };

export const ocrRecognizePng = (request: { png: number[] | Uint8Array; mode: string }): Promise<OcrResult> =>
  invoke<OcrResult>('ocr_recognize_png', request);
