import { describe, expect, it } from 'vitest';
import {
  SCREENSHOT_MAX_AGE_MS,
  countExpiredScreenshots,
  filterRecentScreenshots,
  formatBytes,
  formatCreatedAt,
} from '../retention';

describe('screenshot retention helpers', () => {
  const now = 1_700_000_000_000;

  it('keeps items within 24 hours', () => {
    const items = [
      { path: 'a.png', createdAt: now - SCREENSHOT_MAX_AGE_MS + 1 },
      { path: 'b.png', createdAt: now - SCREENSHOT_MAX_AGE_MS - 1 },
      { path: 'c.png', createdAt: now },
    ];

    const recent = filterRecentScreenshots(items, now);
    expect(recent.map((item) => item.path)).toEqual(['a.png', 'c.png']);
    expect(countExpiredScreenshots(items, now)).toBe(1);
  });

  it('treats non-finite timestamps as expired', () => {
    const items = [
      { path: 'bad.png', createdAt: Number.NaN },
      { path: 'ok.png', createdAt: now - 1000 },
    ];
    expect(filterRecentScreenshots(items, now)).toHaveLength(1);
  });

  it('formats bytes and timestamps', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatCreatedAt(0)).toBe('-');
    expect(formatCreatedAt(now)).toContain('2023');
  });
});
