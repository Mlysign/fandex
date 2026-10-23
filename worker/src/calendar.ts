// The release calendar: one month of popular releases for one region.
//
// The same three provider pages and the same cross-source ranking the site's
// calendar used (src/lib/popularMonthFeed.ts), with D1 in place of its two
// cache layers. A month is fetched from the providers at most once per TTL, no
// matter how many devices page through the calendar.
//
// Who builds a month:
//
//   • THE CRON keeps the window around today fresh, one month per run.
//   • A REQUEST builds only a month that has never been built (a deep link, or
//     the first day of a new region). A month that merely went stale is served
//     as it is and left for the cron: a provider fan-out on a request path gets
//     handed to whichever client arrives first, and it costs most of a
//     request's CPU allowance.
//
// What is stored is the ranked CARDS, not the provider payloads. The site kept
// the payloads so it could create catalog rows for every title shown; here a
// card carries its provider id and the client resolves the one somebody opens.
// 40 cards are ~20 KB against the ~100 KB the site stored per month.

import {
  fetchIgdbGamePage, fetchMoviePage, fetchShowPage, monthWindow, type FeedCandidate,
} from "@/lib/discoverFeed";
import { rankCrossSourcePopularity } from "@/lib/popularMonth";
import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";
import { capFrom, kvGet, kvSet, spend } from "./budget";
import { all, first, run } from "./d1";
import type { Env } from "./env";
import { useSharedIgdbToken } from "./catalog/resolve";
import { upcomingOpenLibrary } from "@/lib/sources/openlibrary";
import { mergeBookCards, type BookCard } from "@/lib/sources/bookPure";
import { upcomingHardcover } from "@/lib/sources/hardcover";
import { hardcoverHalf } from "./hardcover";

/** How deep a stored month goes. The calendar shows 15; the rest is room to filter. */
export const MONTH_POOL_DEPTH = 40;
/** At least this many of a month's books, when the month has them, whatever the ranking says (see buildMonth). */
export const BOOK_FLOOR = 5;
/** How far from the current month a request may ask. Wider than the cron's window on purpose. */
export const SERVABLE_MONTHS = 24;
/** The window the cron keeps fresh: the site's snapshot window, -5 .. +6. */
export const WINDOW_PAST = 5;
export const WINDOW_FUTURE = 6;

const DAY = 86_400;
/** A month still ahead of us, or under way, moves as release dates do. */
const TTL_OPEN = DAY;
/** A month that has fully elapsed does not change. */
const TTL_PAST = 30 * DAY;
/** A build where a provider contributed nothing is retried soon: empty may have meant "down". */
const TTL_PARTIAL = 3600;
/** Month builds allowed per UTC day. Three provider calls and one row write each. */
const DEFAULT_DAILY_CALENDAR_CAP = 150;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface CalendarCard {
  source: string;
  sourceId: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platforms?: string[];
  overview?: string;
  genres: string[];
  voteCount: number;
  voteAverage: number | null;
  popularity: number | null;
}

interface StoredMonth {
  partial: boolean;
  items: CalendarCard[];
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + by, 1)));
}

/** Months between two "YYYY-MM" keys, signed. */
function monthDistance(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function validMonth(month: string, now = new Date()): boolean {
  if (!MONTH_RE.test(month)) return false;
  return Math.abs(monthDistance(monthKey(now), month)) <= SERVABLE_MONTHS;
}

const seconds = (d: Date): number => Math.floor(d.getTime() / 1000);

function ttlFor(month: string, partial: boolean, now: Date): number {
  if (partial) return TTL_PARTIAL;
  return monthWindow(month).lte < now.toISOString().slice(0, 10) ? TTL_PAST : TTL_OPEN;
}

/**
 * A book card as a calendar candidate. An Open Library card's reach (readers
 * who shelved it) is what ranks it among the month's books; a Hardcover card
 * has no such number (a count of readers is theirs, not ours), so its bucket
 * keeps Hardcover's own order.
 */
function bookCandidate(b: BookCard): FeedCandidate {
  return {
    id: `${b.source}:${b.sourceId}`, rawId: 0, sourceId: b.sourceId, source: b.source, type: "book",
    title: b.title, releaseDate: b.releaseDate, posterUrl: b.posterUrl, ids: {},
    genreNames: b.genres, originalLanguage: null, voteCount: b.votes,
    voteAverage: b.rating != null ? b.rating / 10 : null, popularity: b.popularity,
  } as FeedCandidate;
}

function toCard(c: FeedCandidate): CalendarCard {
  return {
    source: c.source,
    sourceId: c.sourceId ?? String(c.rawId),
    type: c.type,
    title: c.title,
    releaseDate: c.releaseDate,
    posterUrl: c.posterUrl,
    ...(c.platforms?.length ? { platforms: c.platforms } : {}),
    ...(c.overview ? { overview: c.overview.slice(0, 280) } : {}),
    genres: c.genreNames.slice(0, 6),
    voteCount: c.voteCount,
    voteAverage: c.voteAverage,
    popularity: c.popularity,
  };
}

/**
 * Only the candidates whose date falls in the month. TMDB's regional discover
 * matches a film on ANY release in the window, a re-release included, and then
 * answers with the film's original date: a 2014 film came back for October
 * 2026. Its re-release day is not in the payload, so it cannot be placed, and
 * it is dropped before the ranking so it does not take a slot.
 */
export function inWindow(candidates: FeedCandidate[], win: { gte: string; lte: string }): FeedCandidate[] {
  return candidates.filter((c) => !!c.releaseDate && c.releaseDate >= win.gte && c.releaseDate <= win.lte);
}

/**
 * Fetch and rank one month. Returns null when EVERY source came back empty,
 * which is treated as "the providers are down" and never stored: an empty
 * month cached for a day would pin an outage in place.
 */
export async function buildMonth(env: Env, month: string, region: string): Promise<StoredMonth | null> {
  useSharedIgdbToken(env);
  const win = monthWindow(month);
  // Page 1 of each source is enough: each is already sorted by its own
  // popularity, so page 2 holds titles that could never place. Each fetcher
  // degrades to [] on its own, so one provider being down costs its own titles.
  const [games, movies, shows, olBooks, hcBooks] = await Promise.all([
    // "card": card fields only. Forty full IGDB payloads are ~200 KB to parse,
    // which was most of a build's CPU, and nothing here stores them.
    fetchIgdbGamePage(1, "future", win, "card").catch(() => [] as FeedCandidate[]),
    fetchMoviePage(1, "future", region, win).catch(() => [] as FeedCandidate[]),
    fetchShowPage(1, "future", win).catch(() => [] as FeedCandidate[]),
    // Books (2026-10-17): the month's most wanted first publications. Board
    // games have only a year from BGG, so none is placed on a day.
    // A cover and at least three readers who shelved it: what Open Library calls
    // 2026 also holds self-published leaflets nobody has seen.
    upcomingOpenLibrary(month).then((cards) => cards.filter((b) => b.posterUrl && b.popularity >= 3)).catch(() => [] as BookCard[]),
    // Hardcover (2026-10-17): the books due that month it knows and Open
    // Library does not, most shelved there first. Merged behind Open Library's
    // by ISBN or title and author, so a book both know counts once, as Open
    // Library's. A cover and an author: what separates a book from a listing.
    hardcoverHalf(env, "calendar", 1, () => upcomingHardcover(month)).then((cards) => cards.filter((b) => b.posterUrl && b.authors.length)),
  ]);
  const books = mergeBookCards(olBooks, hcBooks).map(bookCandidate);
  const ranked = rankCrossSourcePopularity(inWindow([...games, ...movies, ...shows, ...books], win), MONTH_POOL_DEPTH);
  if (!ranked.length) return null;
  // A floor for books (2026-10-18). The ranking measures "standout for its
  // medium", and a book's reach (readers who shelved it, usually single
  // digits) is a tiny bucket with a tiny median, so no book placed in any
  // month and Home's Upcoming rail never showed one (Nils). The ranking is
  // kept as it is for the three screen types (docs/decisions, 2026-07-28: a
  // month is not re-balanced into quotas); the month's best books are added
  // after it, up to BOOK_FLOOR, in the month's own order of reach.
  const placed = new Set(ranked.map((c) => c.id));
  const extraBooks = inWindow(books, win).filter((b) => !placed.has(b.id)).slice(0, Math.max(0, BOOK_FLOOR - ranked.filter((c) => c.type === "book").length));
  ranked.push(...extraBooks);
  // Books are not in `partial`: a month a year out often has none, and that is an answer.
  return { partial: !games.length || !movies.length || !shows.length, items: ranked.map(toCard) };
}

// `at` is the caller's clock, the same one staleness is judged against. Stamping
// with a second clock made "is this month due" depend on which one was ahead.
async function storeMonth(db: D1Database, region: string, month: string, built: StoredMonth, at: Date): Promise<void> {
  await run(
    db,
    `INSERT INTO calendar_month (region, month, built_at, payload) VALUES (?, ?, ?, ?)
     ON CONFLICT(region, month) DO UPDATE SET built_at = excluded.built_at, payload = excluded.payload`,
    [region, month, seconds(at), JSON.stringify(built)],
  );
}

export type MonthResult =
  | { ok: true; body: string }
  | { ok: false; reason: "bad-request" | "rate-limited" | "budget" | "provider" };

function envelope(month: string, region: string, builtAt: number, payload: string, stale: boolean): string {
  // `payload` is the stored JSON object. Spliced in, not parsed.
  return `{"month":${JSON.stringify(month)},"region":${JSON.stringify(region)},"builtAt":${builtAt},"stale":${stale},"data":${payload}}`;
}

/**
 * A stored month older than this is built again in the background when asked
 * for. The cron refreshes only the regions saved by signed-in users, so any
 * other region was built once and then served as it was: France still had its
 * 10 October build on the 23rd, without the books added on the 18th.
 */
const STALE_REBUILD_SECONDS = 3 * 24 * 3600;

/**
 * One month for one region, as a JSON string. `mayFetch` is the caller's rate
 * limiter, asked only when a provider fetch is actually about to happen.
 * `defer` (ctx.waitUntil) lets a long-stale month be rebuilt after the answer.
 */
export async function calendarMonth(
  env: Env,
  monthRaw: string,
  regionRaw: string | null,
  mayFetch?: () => Promise<boolean>,
  now = new Date(),
  defer?: (p: Promise<unknown>) => void,
): Promise<MonthResult> {
  if (!validMonth(monthRaw, now)) return { ok: false, reason: "bad-request" };
  const region = normalizeCountry(regionRaw) ?? DEFAULT_COUNTRY;

  const row = await first<{ built_at: number; payload: string }>(
    env.DB,
    "SELECT built_at, payload FROM calendar_month WHERE region = ? AND month = ?",
    [region, monthRaw],
  );
  if (row) {
    // Served whatever its age. `stale` tells the client it may be a day behind;
    // the cron refreshes the window, and a stale month beats a slow one.
    const partial = row.payload.startsWith('{"partial":true');
    const stale = seconds(now) - row.built_at > ttlFor(monthRaw, partial, now);
    // Long stale: answer with what is stored, and build it again after the answer,
    // under the same limiter and daily cap as a first build.
    if (defer && seconds(now) - row.built_at > STALE_REBUILD_SECONDS) {
      defer((async () => {
        if (mayFetch && !(await mayFetch())) return;
        if (!(await spend(env.DB, "calendar", capFrom(env.DAILY_CALENDAR_CAP, DEFAULT_DAILY_CALENDAR_CAP)))) return;
        const built = await buildMonth(env, monthRaw, region);
        if (built) await storeMonth(env.DB, region, monthRaw, built, new Date());
      })().catch((e) => console.warn("calendar_rebuild_failed", { region, month: monthRaw, error: e instanceof Error ? e.message : String(e) })));
    }
    return { ok: true, body: envelope(monthRaw, region, row.built_at, row.payload, stale) };
  }

  if (mayFetch && !(await mayFetch())) return { ok: false, reason: "rate-limited" };
  if (!(await spend(env.DB, "calendar", capFrom(env.DAILY_CALENDAR_CAP, DEFAULT_DAILY_CALENDAR_CAP)))) {
    return { ok: false, reason: "budget" };
  }
  const built = await buildMonth(env, monthRaw, region);
  if (!built) return { ok: false, reason: "provider" };
  await storeMonth(env.DB, region, monthRaw, built, now);
  return { ok: true, body: envelope(monthRaw, region, seconds(now), JSON.stringify(built), false) };
}

// ── The cron's half ──────────────────────────────────────────────────────────

/** Regions somebody actually uses, plus the default. Capped: each one is 12 months of builds a day. */
const MAX_REGIONS = 6;
const CALENDAR_BACKOFF_KEY = "calendar_backoff";
const CALENDAR_BACKOFF_SECONDS = 1800;

export async function regionsInUse(db: D1Database): Promise<string[]> {
  const rows = await all<{ country: string }>(
    db,
    "SELECT country FROM users WHERE country IS NOT NULL GROUP BY country ORDER BY COUNT(*) DESC LIMIT ?",
    [MAX_REGIONS],
  );
  const set = new Set<string>([DEFAULT_COUNTRY]);
  for (const r of rows) {
    const c = normalizeCountry(r.country);
    if (c) set.add(c);
  }
  return [...set].slice(0, MAX_REGIONS);
}

/**
 * Refresh ONE month: the most overdue (or never built) in the window, across
 * the regions in use. A failed build keeps the old row: replacing a good month
 * with nothing is how an outage becomes an empty calendar.
 */
export async function runCalendarStep(env: Env, now = new Date()): Promise<{ built: string | null; failed?: boolean }> {
  // After a failed build, stand down for a while. The most overdue month is
  // picked first, so without this a month the providers cannot serve would be
  // retried on every run and starve the eleven behind it.
  if (await kvGet(env.DB, CALENDAR_BACKOFF_KEY)) return { built: null };

  const here = monthKey(now);
  const months: string[] = [];
  for (let i = -WINDOW_PAST; i <= WINDOW_FUTURE; i++) months.push(shiftMonth(here, i));
  const regions = await regionsInUse(env.DB);

  const stored = await all<{ region: string; month: string; built_at: number; partial: number }>(
    env.DB,
    `SELECT region, month, built_at, payload LIKE '{"partial":true%' partial
       FROM calendar_month WHERE month >= ? AND month <= ?`,
    [months[0], months[months.length - 1]],
  );
  const byKey = new Map(stored.map((r) => [`${r.region}:${r.month}`, r]));

  const nowS = seconds(now);
  let pick: { region: string; month: string; overdue: number } | null = null;
  for (const region of regions) {
    for (const month of months) {
      const row = byKey.get(`${region}:${month}`);
      // Never built outranks everything; otherwise by how far past its TTL it is.
      const overdue = row ? nowS - row.built_at - ttlFor(month, !!row.partial, now) : Number.MAX_SAFE_INTEGER;
      if (overdue > 0 && (!pick || overdue > pick.overdue)) pick = { region, month, overdue };
    }
  }
  if (!pick) return { built: null };

  if (!(await spend(env.DB, "calendar", capFrom(env.DAILY_CALENDAR_CAP, DEFAULT_DAILY_CALENDAR_CAP)))) {
    return { built: null };
  }
  const built = await buildMonth(env, pick.month, pick.region);
  if (!built) {
    await kvSet(env.DB, CALENDAR_BACKOFF_KEY, "1", CALENDAR_BACKOFF_SECONDS);
    return { built: `${pick.region}:${pick.month}`, failed: true };
  }
  await storeMonth(env.DB, pick.region, pick.month, built, now);
  return { built: `${pick.region}:${pick.month}` };
}
