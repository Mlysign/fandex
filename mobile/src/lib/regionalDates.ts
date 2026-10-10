// The day YOUR films open in the country you chose.
//
// The device's catalog holds one date per title, the worldwide one. The popular
// half of the calendar comes from the Worker already dated for your country, so
// a film on your wishlist used to sit on one day from your list and on another
// from the popular feed (Digger: 28 September and 1 October in Germany). Here
// the Worker is asked which of your films open on another day where you live,
// and the calendar places them by that day.
//
// Only films are asked about: a show and a game have one date everywhere.

import { api } from '~/lib/api';
import { shiftMonth } from '~/lib/dates';

/** The Worker's cap on ids per request. */
const CHUNK = 200;
const TTL_MS = 6 * 60 * 60 * 1000;
/**
 * How far before the month a film's one date may lie and still be asked about.
 * A country's cinema date trails the worldwide one by days as a rule and by
 * months now and then (Hokum: eight). A film more than a year late stays where
 * the device has it.
 */
const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 1;

/** Per country: the date of every film already asked about, or null where the device's date stands. */
const known = new Map<string, { at: number; dates: Map<string, string | null> }>();

type Ask = (region: string, ids: string[]) => Promise<{ dates: Record<string, string> }>;

/** The stretch of device dates a month's own titles are read from: `[from, to)`. */
export function ownWindow(month: string): { from: string; to: string } {
  return { from: `${shiftMonth(month, -MONTHS_BEFORE)}-01`, to: `${shiftMonth(month, MONTHS_AFTER + 1)}-01` };
}

/**
 * The date in `region` of each of these films that has one of its own. Asks
 * the Worker only about films it has not answered for yet. Throws when the
 * Worker cannot be reached, and remembers nothing from a failed call: the
 * caller falls back to the device's dates, and the next look asks again.
 */
export async function regionalDates(region: string, ids: string[], ask: Ask = api.releaseDates): Promise<Map<string, string>> {
  let entry = known.get(region);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    entry = { at: Date.now(), dates: new Map() };
    known.set(region, entry);
  }
  const { dates } = entry;
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !dates.has(id));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const answer = await ask(region, chunk);
    for (const id of chunk) dates.set(id, answer.dates[id] ?? null);
  }
  const out = new Map<string, string>();
  for (const id of unique) {
    const date = dates.get(id);
    if (date) out.set(id, date);
  }
  return out;
}

/**
 * Rows read from the window, each with the date it has where you live, cut down
 * to the ones that fall in `month`.
 */
export function placeInMonth<T extends { id: string; release_date: string | null }>(
  rows: T[], dates: Map<string, string>, month: string,
): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const date = dates.get(r.id) ?? r.release_date;
    if (date?.startsWith(month)) out.push(date === r.release_date ? r : { ...r, release_date: date });
  }
  return out;
}

/** For tests. */
export function forgetRegionalDates(): void {
  known.clear();
}
