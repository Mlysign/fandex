import { describe, expect, it } from 'vitest';
import { hasPlayStore, LAUNCH_PAGES, launchLinks } from './launch';
import { WHATS_NEW } from './whatsNew';

describe('the launch switch', () => {
  it('links the launch pages only once launched', () => {
    expect(launchLinks(false)).toEqual([]);
    expect(launchLinks(true).map((p) => p.path)).toEqual(['/app', '/whats-new', '/press', '/delete-account']);
  });

  it('shows Google Play only for a real address', () => {
    expect(hasPlayStore('')).toBe(false);
    expect(hasPlayStore('  ')).toBe(false);
    expect(hasPlayStore('https://play.google.com/store/apps/details?id=org.fandex.app')).toBe(true);
  });

  it('every launch page has an address a file can hold', () => {
    for (const p of LAUNCH_PAGES) expect(p.path).toMatch(/^\/[a-z-]+$/);
  });
});

describe("What's new", () => {
  it('is newest first, with 1 to 3 lines and a real date each', () => {
    const num = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
    WHATS_NEW.forEach((e, i) => {
      expect(e.lines.length).toBeGreaterThanOrEqual(1);
      expect(e.lines.length).toBeLessThanOrEqual(3);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.date))).toBe(false);
      if (i > 0) expect(num(e.version)).toBeLessThan(num(WHATS_NEW[i - 1].version));
    });
  });
});

// The copy itself (dashes, banned words, exclamation marks) is checked in the
// site's suite, which can read files: src/lib/launchPagesCopy.test.ts.
