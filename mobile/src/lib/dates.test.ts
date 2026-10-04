import { describe, expect, it } from 'vitest';
import { compactCount, currentMonth, dayLabel, longDate, monthLabel, shiftMonth, todayIso } from './dates';

describe('months', () => {
  it('shifts across a year boundary in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 6)).toBe('2027-04');
    expect(shiftMonth('2026-10', -24)).toBe('2024-10');
  });

  it('labels a month', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
  });

  it('reads the current month off the local clock, zero-padded', () => {
    expect(currentMonth(new Date(2026, 0, 31))).toBe('2026-01');
    expect(todayIso(new Date(2026, 9, 4))).toBe('2026-10-04');
  });
});

describe('days', () => {
  it('names the weekday of a calendar date without drifting a day', () => {
    // 2026-03-29 is the day the clocks change in Europe. A local-time Date
    // built from this string can land on the 28th.
    expect(dayLabel('2026-03-29')).toBe('Sun 29');
    expect(dayLabel('2026-11-19')).toBe('Thu 19');
  });

  it('formats a long date, and answers null for none or nonsense', () => {
    expect(longDate('2026-11-19')).toBe('19 Nov 2026');
    expect(longDate('1999-06-17T00:00:00.000Z')).toBe('17 Jun 1999');
    expect(longDate(null)).toBeNull();
    expect(longDate('soon')).toBeNull();
  });
});

describe('compact counts', () => {
  it('keeps small numbers exact and rounds large ones', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(5400)).toBe('5.4k');
    expect(compactCount(54_321)).toBe('54k');
    expect(compactCount(879_000)).toBe('879k');
    expect(compactCount(2_340_000)).toBe('2.3M');
  });
});
