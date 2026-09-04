import { invoke } from '@tauri-apps/api/core';
import type { DetectedElement, PhysicalDesktopPointI32 } from './bindings';

export type { DetectedElement, PhysicalDesktopPointI32 };

/** Windows-only：截图覆盖层「悬停控件识别」，返回指针下元素矩形（无则为 null）。 */
export const elementFromPoint = (point: PhysicalDesktopPointI32): Promise<DetectedElement | null> =>
  invoke<DetectedElement | null>('element_from_point', { point });
