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
import { all, first, nowSeconds, run } from "./d1";
import type { Env } from "./env";
import { useSharedIgdbToken } from "./catalog/resolve";

/** How deep a stored month goes. The calendar shows 15; the rest is room to filter. */
export const MONTH_POOL_DEPTH = 40;
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

function ttlFor(month: string, partial: boolean, now: Date): number {
  if (partial) return TTL_PARTIAL;
  return monthWindow(month).lte < now.toISOString().slice(0, 10) ? TTL_PAST : TTL_OPEN;
}

function toCard(c: FeedCandidate): CalendarCard {
  return {
    source: c.source,
    sourceId: String(c.rawId),
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
  const [games, movies, shows] = await Promise.all([
    // "card": card fields only. Forty full IGDB payloads are ~200 KB to parse,
    // which was most of a build's CPU, and nothing here stores them.
    fetchIgdbGamePage(1, "future", win, "card").catch(() => [] as FeedCandidate[]),
    fetchMoviePage(1, "future", region, win).catch(() => [] as FeedCandidate[]),
    fetchShowPage(1, "future", win).catch(() => [] as FeedCandidate[]),
  ]);
  const ranked = rankCrossSourcePopularity([...games, ...movies, ...shows], MONTH_POOL_DEPTH);
  if (!ranked.length) return null;
  return { partial: !games.length || !movies.length || !shows.length, items: ranked.map(toCard) };
}

async function storeMonth(db: D1Database, region: string, month: string, built: StoredMonth): Promise<void> {
  await run(
    db,
    `INSERT INTO calendar_month (region, month, built_at, payload) VALUES (?, ?, ?, ?)
     ON CONFLICT(region, month) DO UPDATE SET built_at = excluded.built_at, payload = excluded.payload`,
    [region, month, nowSeconds(), JSON.stringify(built)],
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
 * One month for one region, as a JSON string. `mayFetch` is the caller's rate
 * limiter, asked only when a provider fetch is actually about to happen.
 */
export async function calendarMonth(
  env: Env,
  monthRaw: string,
  regionRaw: string | null,
  mayFetch?: () => Promise<boolean>,
  now = new Date(),
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
    const stale = nowSeconds() - row.built_at > ttlFor(monthRaw, partial, now);
    return { ok: true, body: envelope(monthRaw, region, row.built_at, row.payload, stale) };
  }

  if (mayFetch && !(await mayFetch())) return { ok: false, reason: "rate-limited" };
  if (!(await spend(env.DB, "calendar", capFrom(env.DAILY_CALENDAR_CAP, DEFAULT_DAILY_CALENDAR_CAP)))) {
    return { ok: false, reason: "budget" };
  }
  const built = await buildMonth(env, monthRaw, region);
  if (!built) return { ok: false, reason: "provider" };
  await storeMonth(env.DB, region, monthRaw, built);
  return { ok: true, body: envelope(monthRaw, region, nowSeconds(), JSON.stringify(built), false) };
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

  const nowS = Math.floor(now.getTime() / 1000);
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
  await storeMonth(env.DB, pick.region, pick.month, built);
  return { built: `${pick.region}:${pick.month}` };
}
