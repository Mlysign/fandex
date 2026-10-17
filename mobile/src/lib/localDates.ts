// Every film's date is the one in YOUR country, on every screen.
//
// The catalog holds one date per film, TMDB's worldwide one, and a film opens
// on another day in most countries (136 of 200 pool films in Germany, usually
// one to three days later, now and then months). The calendar used to be the
// only screen that asked; Discover, the Wishlist, the Library, the tag and
// person pages and Profile showed the worldwide day (Nils, 2026-10-17: "always
// use the user settings country everywhere in the app").
//
// How: the worldwide date moves to `catalog.world_date`, and `catalog.release_date`,
// which every screen already reads, holds the date in the country this device
// is set to. `regional_date` keeps what the Worker answered per country, so a
// change of country back and forth costs no request. The catalog sync writes a
// row's `release_date` through the same table (catalogSync.ts, `storePage`),
// so a re-synced film keeps its local date.
//
// Only films: a show and a game have one date everywhere.

import type { SQLiteDatabase } from 'expo-sqlite';
import { api, ApiError } from '~/lib/api';
import { inTransaction } from '~/lib/db';

/** The `meta` key naming the country `catalog.release_date` is in. */
export const DATE_REGION_KEY = 'date_region';
/** The Worker's cap on ids per request. */
const CHUNK = 200;
/**
 * Requests per run. The route allows 30 a minute per address and the calendar
 * shares it; 1,376 films (2026-10-17) is seven.
 */
const MAX_REQUESTS = 10;
const DAY = 86_400;
/** A film out for a year has its date settled. One still to come, or just out, can move. */
const TTL_SETTLED = 30 * DAY;
const TTL_MOVING = 3 * DAY;

type Ask = (region: string, ids: string[]) => Promise<{ dates: Record<string, string> }>;

/** The country `release_date` currently holds, or null before the first switch. */
export async function dateRegion(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [DATE_REGION_KEY]);
  return row?.value ?? null;
}

/**
 * Point `release_date` at `region`: what is known for it already, the worldwide
 * date for the rest. Returns whether anything moved. Cheap enough to run on
 * every start: one UPDATE over the films.
 */
export async function pointDatesAt(db: SQLiteDatabase, region: string): Promise<boolean> {
  if ((await dateRegion(db)) === region) return false;
  await inTransaction(db, async () => {
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [DATE_REGION_KEY, region]);
    await applyDates(db, region);
  });
  return true;
}

async function applyDates(db: SQLiteDatabase, region: string, ids?: string[]): Promise<void> {
  const only = ids ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';
  await db.runAsync(
    `UPDATE catalog
        SET release_date = COALESCE((SELECT r.date FROM regional_date r WHERE r.region = ? AND r.media_item_id = catalog.id), world_date)
      WHERE type = 'movie'${only}`,
    [region, ...(ids ?? [])],
  );
}

/** The films whose date in `region` is unknown or due another look, newest first. Pure SQL, exported for its test. */
export async function filmsToAsk(db: SQLiteDatabase, region: string, now: number, limit: number): Promise<string[]> {
  const yearAgo = new Date((now - 365 * DAY) * 1000).toISOString().slice(0, 10);
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM catalog c
       LEFT JOIN regional_date r ON r.region = ? AND r.media_item_id = c.id
      WHERE c.type = 'movie'
        AND (r.checked_at IS NULL
             OR r.checked_at < ? - (CASE WHEN c.world_date IS NOT NULL AND c.world_date < ? THEN ? ELSE ? END))
      ORDER BY c.world_date IS NULL, c.world_date DESC
      LIMIT ?`,
    [region, now, yearAgo, TTL_SETTLED, TTL_MOVING, limit],
  );
  return rows.map((r) => r.id);
}

/**
 * Ask the Worker for the films whose date in `region` is unknown or stale, and
 * store the answers. Returns how many films changed their date on screen.
 * A refusal (rate limit, no connection) ends the run with what landed so far;
 * the next run carries on. Nothing is ever deleted, so a failed run leaves the
 * dates as they were.
 */
export async function fillRegionalDates(db: SQLiteDatabase, region: string, ask: Ask = api.releaseDates): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const ids = await filmsToAsk(db, region, now, CHUNK * MAX_REQUESTS);
  let moved = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let answer: { dates: Record<string, string> };
    try {
      answer = await ask(region, chunk);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'rate-limited' || e.code === 'offline')) break;
      throw e;
    }
    await inTransaction(db, async () => {
      const put = await db.prepareAsync('INSERT OR REPLACE INTO regional_date (region, media_item_id, date, checked_at) VALUES (?, ?, ?, ?)');
      try {
        for (const id of chunk) await put.executeAsync([region, id, answer.dates[id] ?? null, now]);
      } finally {
        await put.finalizeAsync();
      }
      // Only the country on screen changes what the lists show.
      if ((await dateRegion(db)) === region) {
        const before = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) n FROM catalog c JOIN regional_date r ON r.region = ? AND r.media_item_id = c.id
            WHERE c.id IN (${chunk.map(() => '?').join(',')}) AND c.release_date IS NOT COALESCE(r.date, c.world_date)`,
          [region, ...chunk],
        );
        moved += before?.n ?? 0;
        await applyDates(db, region, chunk);
      }
    });
  }
  return moved;
}
