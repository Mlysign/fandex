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

import { sharedCache } from "@/lib/boundedCache";
import { readMonthSnapshot } from "@/lib/calendarSnapshot";
import { rankCrossSourcePopularity, POPULAR_PER_MONTH } from "@/lib/popularMonth";
import type { FeedCandidate } from "@/lib/discoverFeed";
import {
  monthWindow, fetchMoviePage, fetchShowPage, fetchIgdbGamePage,
} from "@/lib/discoverFeed";

// Past months never change and future months move slowly, so a 6h TTL is
// generous. `max` holds a few years of months across a couple of regions.
const POPULAR_TTL_MS = 6 * 60 * 60 * 1000;
const _monthCache = sharedCache<string, FeedCandidate[]>("popularMonthFeed", { max: 120, ttlMs: POPULAR_TTL_MS });

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
 *
 * ── THREE LAYERS, AND EACH ONE ANSWERS A DIFFERENT QUESTION (2026-08-26) ────
 *
 *   1. the in-memory cache:  "have I already PARSED this month?"
 *   2. `calendar_snapshot`:  "has the SERVER already fetched it today?"
 *   3. the provider fan-out: the only layer that costs quota.
 *
 * The table did not replace the cache and the cache does not make the table
 * redundant. The cache dies on every deploy (docs/scalability.md §3.6) and prod
 * deploys often, so on its own it overstates how cached this really was; the
 * table survives that and drops the fan-out to twelve months once a day, no
 * matter how many people page the calendar or how many crawlers walk
 * `/calendar/{YYYY-MM}`. But a stored month is ~103 KB of JSON, so reading it on
 * every request would trade a network call for a parse on the request path. Hence
 * both, in this order.
 *
 * ⚠️ Layer 3 stays. A month outside the snapshot window is still SERVABLE
 * (`SERVABLE_PAST_MONTHS`/`SERVABLE_FUTURE_MONTHS` reach ±12 against the
 * snapshot's -5..+6), and a shared link into one of those must not rot. Those
 * months are `noindex` and linked from nowhere, so the crawl volume that reaches
 * them is small, but do not "simplify" this into snapshot-only, or every one of
 * them renders empty.
 */
export async function candidatesForMonth(month: string, region: string): Promise<FeedCandidate[]> {
  const key = `${month}:${region}`;
  const hit = _monthCache.get(key);
  if (hit) return hit;

  // Layer 2. Populates the memory cache so the parse happens once per process.
  const stored = readMonthSnapshot(month, region);
  if (stored) {
    _monthCache.set(key, stored);
    return stored;
  }

  return fetchMonthCandidates(month, region);
}

/**
 * Layer 3: the actual provider fan-out, ranked and memory-cached.
 *
 * Split out from `candidatesForMonth` so the daily builder has a way to reach
 * the providers without recursing back through its own snapshot. **Nothing on a
 * request path should call this directly**. Go through `candidatesForMonth`,
 * which tries the two cheap layers first.
 */
export async function fetchMonthCandidates(month: string, region: string): Promise<FeedCandidate[]> {
  const key = `${month}:${region}`;
  const win = monthWindow(month);
  // Page 1 of each source is enough: each is already sorted by its own
  // popularity, so page 2 holds items that could never place in a top-15.
  // `.catch` per source, not one shared await — one provider being down should
  // cost its own titles, not the whole month.
  // ⚠️ Games are IGDB alone since 2026-09-02 (RAWG retired). The RAWG entry that
  // used to lead this list is gone, and with it the note about RAWG winning a
  // duplicate on richer poster data — there is no duplicate to resolve now.
  const [igdbGames, movies, shows] = await Promise.all([
    fetchIgdbGamePage(1, "future", win).catch(() => []),
    fetchMoviePage(1, "future", region, win).catch(() => []),
    fetchShowPage(1, "future", win).catch(() => []),
  ]);

  const ranked = rankCrossSourcePopularity([...igdbGames, ...movies, ...shows], MONTH_POOL_DEPTH);
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
