import { describe, expect, it } from 'vitest';
import { byPrefix, isoWeek, multiMedia, perDay, perWeek, retention, share, total, weekOfDay } from './usageReport';

// The Usage page's sums. A number with no row is null and shows as a dash.

const c = (day: string, key: string, n: number) => ({ day, key, n });

describe('isoWeek', () => {
  it('matches the server, year edges included', () => {
    expect(weekOfDay('2026-11-22')).toBe('2026-W47'); // a Sunday
    expect(weekOfDay('2026-11-23')).toBe('2026-W48'); // the Monday after
    expect(weekOfDay('2027-01-01')).toBe('2026-W53');
    expect(weekOfDay('2021-01-03')).toBe('2020-W53');
    expect(isoWeek(Date.UTC(2025, 11, 29) / 1000)).toBe('2026-W01');
  });
});

describe('sums', () => {
  const rows = [
    c('2026-11-16', 'active', 3), c('2026-11-18', 'active', 2), c('2026-11-23', 'active', 4),
    c('2026-11-16', 'app:screen:home', 5), c('2026-11-17', 'app:screen:calendar', 7), c('2026-11-18', 'app:screen:home', 1),
  ];

  it('gives null for a key with no row, never zero', () => {
    expect(total(rows, 'app:day')).toBeNull();
    expect(total(rows, 'active')).toBe(9);
    expect(share(null, 4)).toBe('-');
    expect(share(1, 0)).toBe('-');
    expect(share(1, 4)).toBe('25%');
  });

  it('sums a prefix, biggest first', () => {
    expect(byPrefix(rows, 'app:screen:')).toEqual([{ label: 'calendar', count: 7 }, { label: 'home', count: 6 }]);
  });

  it('sums per ISO week and fills the day chart between the first and last day', () => {
    expect(perWeek(rows, 'active')).toEqual([{ week: '2026-W47', n: 5 }, { week: '2026-W48', n: 4 }]);
    const days = perDay(rows, 'active');
    expect(days).toHaveLength(8);
    expect(days[1]).toEqual({ day: '2026-11-17', n: 0 });
    expect(perDay([], 'active')).toEqual([]);
  });
});

describe('returning accounts', () => {
  it('is a table of signup week against the weeks that follow', () => {
    const r = retention([
      c('2026-11-10', 'ret:2026-W46', 4),
      c('2026-11-16', 'ret:2026-W46', 2), c('2026-11-17', 'ret:2026-W46', 1),
      c('2026-11-17', 'ret:2026-W47', 3),
    ]);
    expect(r.weeks).toEqual(['2026-W46', '2026-W47']);
    expect(r.rows).toEqual([
      { signup: '2026-W46', cells: [4, 3] },
      { signup: '2026-W47', cells: [null, 3] },
    ]);
  });
});

describe('the media mix', () => {
  it('counts accounts in two types or more', () => {
    expect(multiMedia([{ types: 1, accounts: 6 }, { types: 2, accounts: 3 }, { types: 3, accounts: 1 }])).toEqual({ many: 4, all: 10 });
    expect(multiMedia([])).toEqual({ many: null, all: null });
  });
});
