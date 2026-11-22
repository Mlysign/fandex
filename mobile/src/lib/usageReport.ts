// The admin Usage page's sums (app/(tabs)/dev/usage.tsx), from the counters
// GET /v1/admin/usage answers with (worker/src/usage.ts). Pure, so it has tests.
//
// A number with no row behind it is null, never 0: the page shows a dash for
// it, so "not measured yet" never reads as a measurement.

import type { UsageSnapshot } from '~/lib/api';

type Counter = UsageSnapshot['counters'][number];

/** The ISO week a moment falls in, as `2027-W07`. A copy of worker/src/usage.ts `isoWeek`: keep the two the same. */
export function isoWeek(seconds: number): string {
  const d = new Date(seconds * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0
  // The Thursday of this week decides the year the week belongs to.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime() + (firstDay - 3) * 86_400_000) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The ISO week of a UTC day, `2026-11-22`. */
export function weekOfDay(day: string): string {
  return isoWeek(Date.parse(`${day}T00:00:00Z`) / 1000);
}

/** One key summed over the range; null when it has no row at all. */
export function total(counters: Counter[], key: string): number | null {
  let sum: number | null = null;
  for (const c of counters) if (c.key === key) sum = (sum ?? 0) + c.n;
  return sum;
}

/** Every key under a prefix, summed over the range, the prefix taken off, biggest first. */
export function byPrefix(counters: Counter[], prefix: string): { label: string; count: number }[] {
  const sums = new Map<string, number>();
  for (const c of counters) if (c.key.startsWith(prefix)) sums.set(c.key.slice(prefix.length), (sums.get(c.key.slice(prefix.length)) ?? 0) + c.n);
  return [...sums.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** A share as a whole percent, or a dash when either side has no data. */
export function share(part: number | null, whole: number | null): string {
  if (part == null || whole == null || whole <= 0) return '-';
  return `${Math.round((part / whole) * 100)}%`;
}

/** One key summed per ISO week, oldest first. Only weeks with a row. */
export function perWeek(counters: Counter[], key: string): { week: string; n: number }[] {
  const weeks = new Map<string, number>();
  for (const c of counters) if (c.key === key) weeks.set(weekOfDay(c.day), (weeks.get(weekOfDay(c.day)) ?? 0) + c.n);
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, n]) => ({ week, n }));
}

/** One key per day, from the first day any counter has to the last, for the day chart. Empty when nothing was counted. */
export function perDay(counters: Counter[], key: string): { day: string; n: number }[] {
  if (!counters.length) return [];
  const days = counters.map((c) => c.day).sort();
  const byDay = new Map<string, number>();
  for (const c of counters) if (c.key === key) byDay.set(c.day, (byDay.get(c.day) ?? 0) + c.n);
  const out: { day: string; n: number }[] = [];
  for (let t = Date.parse(`${days[0]}T00:00:00Z`), end = Date.parse(`${days[days.length - 1]}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, n: byDay.get(day) ?? 0 });
  }
  return out;
}

export interface Retention {
  /** The calendar weeks of the range that have any `ret:` row, oldest first. */
  weeks: string[];
  /** Per signup week, the accounts of it active in each of `weeks`; null before the signup week or with no row. */
  rows: { signup: string; cells: (number | null)[] }[];
}

/**
 * Returning accounts per signup week: `ret:<signup week>` summed over the days
 * of each calendar week. The server counts an account once per ISO week under
 * its signup week, so a cell is the distinct accounts of that signup week seen
 * that week.
 */
export function retention(counters: Counter[]): Retention {
  const cells = new Map<string, Map<string, number>>();
  const weekSet = new Set<string>();
  for (const c of counters) {
    if (!c.key.startsWith('ret:')) continue;
    const signup = c.key.slice(4);
    const week = weekOfDay(c.day);
    weekSet.add(week);
    const row = cells.get(signup) ?? new Map<string, number>();
    row.set(week, (row.get(week) ?? 0) + c.n);
    cells.set(signup, row);
  }
  const weeks = [...weekSet].sort();
  const rows = [...cells.keys()].sort().map((signup) => ({
    signup,
    cells: weeks.map((w) => (w < signup ? null : cells.get(signup)?.get(w) ?? null)),
  }));
  return { weeks, rows };
}

/** Accounts that rated in two media types or more, and all accounts with a rating. Nulls when nobody has rated. */
export function multiMedia(mix: UsageSnapshot['mediaMix']): { many: number | null; all: number | null } {
  const all = mix.reduce((a, m) => a + m.accounts, 0);
  if (!all) return { many: null, all: null };
  return { many: mix.filter((m) => m.types >= 2).reduce((a, m) => a + m.accounts, 0), all };
}
