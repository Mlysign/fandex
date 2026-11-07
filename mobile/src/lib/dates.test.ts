import { describe, expect, it } from 'vitest';
import { cardDate, compactCount, currentMonth, dayLabel, longDate, monthLabel, shiftMonth, todayIso } from './dates';

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

describe('a date that names only a year or a month', () => {
  it('is said as such, never as the 1st of January', async () => {
    const { longDate, monthYear, shortDate } = await import('./dates');
    expect(longDate('1976')).toBe('1976');
    expect(monthYear('1976')).toBe('1976');
    expect(shortDate('1976')).toBe('1976');
    expect(longDate('1976-04')).toBe('Apr 1976');
    expect(longDate('1976-04-02')).toBe('2 Apr 1976');
  });
});

describe('a poster card date (cardDate)', () => {
  const today = '2026-11-07';
  it('names the day for a release within two months either side', () => {
    expect(cardDate('2026-11-05', today)).toBe('05 Nov');
    expect(cardDate('2026-12-18', today)).toBe('18 Dec');
    expect(cardDate('2026-09-18', today)).toBe('18 Sep');
    expect(cardDate('2027-01-07', today)).toBe('07 Jan');
    expect(cardDate('2026-09-07', today)).toBe('07 Sep');
  });
  it('keeps month and year further off', () => {
    expect(cardDate('2027-01-08', today)).toBe('Jan 2027');
    expect(cardDate('2026-09-06', today)).toBe('Sep 2026');
    expect(cardDate('2021-02-02', today)).toBe('Feb 2021');
  });
  it('says a year or month alone as such, and TBA for none', () => {
    expect(cardDate('2026-11', today)).toBe('Nov 2026');
    expect(cardDate('2027', today)).toBe('2027');
    expect(cardDate(null, today)).toBe('TBA');
  });
});
