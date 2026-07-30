// "The month's biggest releases, straight from the providers" — one month per
// call, cached.
//
// Extracted from api/calendar/popular/route.ts (2026-07-30) so Home's Upcoming
// rail can use it. That matters beyond code reuse: Nils's ask was that Home's
// Upcoming use "the same algorithm the calendar page uses" — and the only way for
// that to STAY true is for there to be one implementation. It also means the two
// surfaces share the 6h cache, so opening Home and then the calendar costs one
// set of provider calls, not two.
//
// Trakt is deliberately absent from the source list: /movies/anticipated and
// /shows/anticipated take no date parameter, so they can't answer "this month"
// and can never answer a month in the past.

import { BoundedCache } from "@/lib/boundedCache";
import { rankCrossSourcePopularity, POPULAR_PER_MONTH } from "@/lib/popularMonth";
import type { FeedCandidate } from "@/lib/discoverFeed";
import {
  monthWindow, fetchGamePage, fetchMoviePage, fetchShowPage, fetchIgdbGamePage,
} from "@/lib/discoverFeed";

// Past months never change and future months move slowly, so a 6h TTL is
// generous. `max` holds a few years of months across a couple of regions.
const POPULAR_TTL_MS = 6 * 60 * 60 * 1000;
const _monthCache = new BoundedCache<string, FeedCandidate[]>({ max: 120, ttlMs: POPULAR_TTL_MS });

/**
 * How deep the cached ranking goes. Deliberately deeper than POPULAR_PER_MONTH:
 * the calendar shows the top 15, but Home's Upcoming rail filters this pool down
 * to future-only dates and then rotates within it. Ranking to 15 up front left
 * Home with ~13 candidates for a 15-slot rail — no room to rotate, so the rail
 * was still identical every day even after the algorithm swap. Same cache, same
 * ranking, one slice per consumer.
 */
const MONTH_POOL_DEPTH = 40;

/**
 * The top releases of `month` ("YYYY-MM") for `region`, ranked across sources,
 * best first, up to MONTH_POOL_DEPTH. Callers slice to what they show.
 *
 * Returns provider candidates — the caller decorates, persists and annotates
 * them (a session-gated step, so it can't live here).
 */
export async function candidatesForMonth(month: string, region: string): Promise<FeedCandidate[]> {
  const key = `${month}:${region}`;
  const hit = _monthCache.get(key);
  if (hit) return hit;

  const win = monthWindow(month);
  // Page 1 of each source is enough: each is already sorted by its own
  // popularity, so page 2 holds items that could never place in a top-15.
  // `.catch` per source, not one shared await — one provider being down should
  // cost its own titles, not the whole month.
  const [games, igdbGames, movies, shows] = await Promise.all([
    fetchGamePage(1, "future", win).catch(() => []),
    fetchIgdbGamePage(1, "future", win).catch(() => []),
    fetchMoviePage(1, "future", region, win).catch(() => []),
    fetchShowPage(1, "future", win).catch(() => []),
  ]);

  // RAWG before IGDB: on a duplicate game, rankCrossSourcePopularity keeps the
  // first seen, and RAWG's list payload carries the richer poster/platform data.
  const ranked = rankCrossSourcePopularity([...games, ...igdbGames, ...movies, ...shows], MONTH_POOL_DEPTH);
  _monthCache.set(key, ranked);
  return ranked;
}

/** What the calendar shows for a month: the top POPULAR_PER_MONTH of the pool. */
export async function popularForMonth(month: string, region: string): Promise<FeedCandidate[]> {
  return (await candidatesForMonth(month, region)).slice(0, POPULAR_PER_MONTH);
}

/** "YYYY-MM" for a date, and for the month after it. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function nextMonthKey(d: Date): string {
  return monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}
