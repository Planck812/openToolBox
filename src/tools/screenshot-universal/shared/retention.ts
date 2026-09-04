/** Retention window for screenshots: 24 hours. */
export const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ScreenshotLike = {
  path: string;
  createdAt: number;
  name?: string;
};

/**
 * Keep only screenshots whose createdAt is within the last 24 hours.
 * Pure helper used by tests and optional client-side filtering.
 */
export function filterRecentScreenshots<T extends ScreenshotLike>(
  items: T[],
  nowMs: number = Date.now(),
  maxAgeMs: number = SCREENSHOT_MAX_AGE_MS,
): T[] {
  return items.filter((item) => {
    if (!Number.isFinite(item.createdAt)) return false;
    return nowMs - item.createdAt <= maxAgeMs;
  });
}

/**
 * Count how many items would be purged as older than max age.
 */
export function countExpiredScreenshots(
  items: ScreenshotLike[],
  nowMs: number = Date.now(),
  maxAgeMs: number = SCREENSHOT_MAX_AGE_MS,
): number {
  return items.length - filterRecentScreenshots(items, nowMs, maxAgeMs).length;
}

/**
 * Format a byte size for display.
 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format epoch millis into a local locale string.
 */
export function formatCreatedAt(createdAt: number, locale = 'zh-CN'): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return '-';
  try {
    return new Date(createdAt).toLocaleString(locale);
  } catch {
    return String(createdAt);
  }
}
