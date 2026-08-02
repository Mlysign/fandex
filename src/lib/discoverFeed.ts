// Live "upcoming" candidate fetchers — the raw material for the discover browse.
// One place that talks to the TMDB `discover` + RAWG `games` LIST endpoints and
// maps each result into a FeedCandidate: the client item shape PLUS the extra
// fields the personalized feed needs to taste-score a list item before deciding
// whether to hydrate it (genre names, original language, crowd-vote data).
//
// Shared by `api/discover/route.ts` (cold-start + section pagination) and
// `liveDiscover.ts` (wide multi-page pull → re-rank).

import type { MediaType, Source } from "@/types";
import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";
import { log } from "@/lib/logger";
import { tmdbGenreNames } from "@/lib/tmdbGenres";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { discoverIgdbUpcoming, igdbConfigured, igdbImageUrl, igdbReleaseDate } from "@/lib/sources/igdb";
import {
  getTraktAnticipatedMovies, getTraktAnticipatedShows,
  getTraktTrendingMovies, getTraktTrendingShows, traktConfigured,
} from "@/lib/sources/trakt";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const RAWG_KEY = process.env.RAWG_API_KEY!;

// Browse window: ~18 months forward for upcoming, ~18 months back for past.
const DAYS_WINDOW = 550;
const todayISO = () => new Date().toISOString().split("T")[0];
const offsetISO = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

export type Direction = "future" | "past";

// ── Best-effort browse fetches (2026-08-02) ──────────────────────────────────
// Every fetcher in this file feeds a BROWSE surface (discover / home / the
// calendar's popular chip). All of them are already best-effort by design —
// `if (!res.ok) return []` — but only against a returned error status. A THROW
// (a timeout, a network error, or http.ts's circuit breaker refusing a call to a
// host that's down) went straight past that guard: `fetchPages` collects these
// under one `Promise.all`, so a single throwing source rejected the whole feed
// and 500'd the route. During the 2026-08-02 RAWG outage the 522s kept that
// hidden — a 522 is a *response*, so `!res.ok` caught it, and the cost showed up
// as latency (60 s/call) rather than an error.
//
// `bestEffort` makes the degradation explicit and uniform: one dead source means
// that source contributes nothing this round, which is exactly what the ranking
// stage downstream already handles. It is scoped to THIS file on purpose — the
// sync/pull adapters must keep throwing (AGENTS.md, the prune invariant).
//
// Logged WITHOUT a stack, deliberately: during an outage this fires once per
// page per source (5 pages × 2 sources × several routes), and `errorFields`'
// full stack turns a provider being down into tens of thousands of lines of
// identical noise. The stack adds nothing here — the interesting event (which
// host, and that it's now being skipped) is logged once by the breaker itself.
async function bestEffort<T>(source: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    log.warn("discover_feed_source_skipped", { source, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** An explicit provider date range, overriding the direction-derived one. */
export interface DateRange { gte: string; lte: string }

// Date range for a direction. Past = [today-window, today]; future = [today, today+window].
export function dateWindow(direction: Direction): DateRange {
  return direction === "past"
    ? { gte: offsetISO(-DAYS_WINDOW), lte: todayISO() }
    : { gte: todayISO(), lte: offsetISO(DAYS_WINDOW) };
}

// The calendar asks providers for ONE month at a time, which the 18-month
// direction windows can't express. `month` is "YYYY-MM"; the range is inclusive
// of both the first and the last day. Built with UTC arithmetic (day 0 of the
// NEXT month = last day of this one) so it can't drift by a day across a DST
// boundary the way a local-time Date would.
export function monthWindow(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`monthWindow: bad month "${month}"`);
  }
  const iso = (d: Date) => d.toISOString().split("T")[0];
  return {
    gte: iso(new Date(Date.UTC(y, m - 1, 1))),
    lte: iso(new Date(Date.UTC(y, m, 0))),
  };
}

/** True when a window has already fully elapsed — picks past-appropriate ranking. */
export function isPastWindow(win: DateRange): boolean {
  return win.lte < todayISO();
}

// A live discover item, enriched with scoring inputs. The first block matches
// what the client already consumes; the trailing block is feed-internal and
// harmless if it reaches the client.
// H2b — the provider payload a candidate was built from, tagged with the source
// it actually CAME FROM. That tag is not redundant with `FeedCandidate.source`:
// a Trakt "anticipated" entry is labelled `source: "tmdb"` (it's keyed by its
// TMDB id so it dedupes against the TMDB pool), but the payload in hand is
// Trakt-shaped. Storing it as TMDB would run it through the TMDB projector and
// normalizer — wrong fields, no cross-ids, a corrupt link. So the payload says
// what it is, and `source`/`ids` stay the feed's business.
export interface RawPayload {
  source: Source;
  sourceId: string;
  data: any;
}

export interface FeedCandidate {
  id: string;
  rawId: number;
  source: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platforms?: string[];
  overview?: string;
  ids: Record<string, number>;
  /** The list payload to persist (H2b). Null when we hold none worth storing. */
  raw?: RawPayload | null;
  // ── scoring inputs (used by liveDiscover, ignored by the client) ──
  genreNames: string[];          // genre/tag names for the cheap pre-score
  originalLanguage: string | null;
  voteCount: number;             // crowd-vote sample size (community floor)
  voteAverage: number | null;    // 0–10 normalized crowd score
  // Each provider's OWN popularity metric, on its own scale — TMDB `popularity`,
  // RAWG `added`, IGDB `hypes`/`total_rating_count`. Comparable only against
  // other candidates from the same source; popularMonth.ts is what makes it
  // comparable across sources. Distinct from voteCount (sample size) and
  // voteAverage (quality): this is reach/attention, which is what "popular
  // releases this month" actually means.
  popularity: number | null;
}

async function rawgGamePage(page: number, direction: Direction, window?: DateRange): Promise<FeedCandidate[]> {
  // Order by popularity (`-added`) within the window so notable games surface
  // first; the personalized feed re-ranks, the client date-sorts for display.
  const { gte, lte } = window ?? dateWindow(direction);
  const res = await httpFetch(
    `https://api.rawg.io/api/games?key=${RAWG_KEY}` +
      `&dates=${gte},${lte}&ordering=-added&page_size=40&page=${page}`,
    { budgetMs: BROWSE_BUDGET_MS }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((g: any): FeedCandidate => ({
    id: `rawg-${g.id}`, rawId: g.id, source: "rawg", type: "game",
    title: g.name, releaseDate: g.released ?? null,
    posterUrl: g.background_image ?? null,
    platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p.platform.name),
    ids: { rawg: g.id },
    raw: { source: "rawg", sourceId: String(g.id), data: g },
    genreNames: [
      ...(g.genres ?? []).map((x: any) => x?.name),
      ...(g.tags ?? []).slice(0, 8).map((x: any) => x?.name),
    ].filter((n): n is string => typeof n === "string"),
    originalLanguage: null, // RAWG list carries no language; not language-relevant for games
    voteCount: g.ratings_count ?? 0,
    voteAverage: typeof g.rating === "number" && g.rating > 0 ? g.rating * 2 : null, // 0–5 → 0–10
    popularity: typeof g.added === "number" ? g.added : null, // the metric `-added` orders by
  }));
}

export function fetchGamePage(page = 1, direction: Direction = "future", window?: DateRange): Promise<FeedCandidate[]> {
  return bestEffort("rawg", () => rawgGamePage(page, direction, window));
}

async function tmdbMoviePage(page: number, direction: Direction, region: string, window?: DateRange): Promise<FeedCandidate[]> {
  // `discover` with a release-date window sorted by popularity. With `region` set,
  // TMDB filters by + returns that country's release date (T22).
  const { gte, lte } = window ?? dateWindow(direction);
  const res = await httpFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&include_adult=false&with_release_type=2|3&region=${region}` +
      `&release_date.gte=${gte}&release_date.lte=${lte}&page=${page}`,
    { budgetMs: BROWSE_BUDGET_MS }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((m: any): FeedCandidate => ({
    id: `tmdb-movie-${m.id}`, rawId: m.id, source: "tmdb", type: "movie",
    title: m.title, releaseDate: m.release_date ?? null,
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    overview: m.overview, ids: { tmdb: m.id },
    raw: { source: "tmdb", sourceId: String(m.id), data: m },
    genreNames: tmdbGenreNames(m.genre_ids, "movie"),
    originalLanguage: m.original_language ?? null,
    voteCount: m.vote_count ?? 0,
    voteAverage: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
    popularity: typeof m.popularity === "number" ? m.popularity : null,
  }));
}

export function fetchMoviePage(page = 1, direction: Direction = "future", region = DEFAULT_COUNTRY, window?: DateRange): Promise<FeedCandidate[]> {
  return bestEffort("tmdb", () => tmdbMoviePage(page, direction, region, window));
}

async function tmdbShowPage(page: number, direction: Direction, window?: DateRange): Promise<FeedCandidate[]> {
  const { gte, lte } = window ?? dateWindow(direction);
  const res = await httpFetch(
    `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&first_air_date.gte=${gte}` +
      `&first_air_date.lte=${lte}&page=${page}`,
    { budgetMs: BROWSE_BUDGET_MS }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((s: any): FeedCandidate => ({
    id: `tmdb-show-${s.id}`, rawId: s.id, source: "tmdb", type: "show",
    title: s.name, releaseDate: s.first_air_date ?? null,
    posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
    overview: s.overview, ids: { tmdb: s.id },
    raw: { source: "tmdb", sourceId: String(s.id), data: s },
    genreNames: tmdbGenreNames(s.genre_ids, "show"),
    originalLanguage: s.original_language ?? null,
    voteCount: s.vote_count ?? 0,
    voteAverage: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
    popularity: typeof s.popularity === "number" ? s.popularity : null,
  }));
}

export function fetchShowPage(page = 1, direction: Direction = "future", window?: DateRange): Promise<FeedCandidate[]> {
  return bestEffort("tmdb", () => tmdbShowPage(page, direction, window));
}

// IGDB upcoming games (second game source). Covers/genres/themes come straight
// off the list payload, so these score + render without hydration.
//
// The bare `direction === "past"` bail this used to open with was about RANKING,
// not coverage: `hypes` (pre-release follow count) is meaningless once a game is
// out, so a past pull would have returned an arbitrary slice. With an explicit
// `window` the caller wants THAT month whichever side of today it falls on, so
// pick the ranking from the window instead of refusing to answer — a past month
// ranks by how many people ended up rating the game. Only the direction-derived
// path (which spans 18 months back, all of it stale) still no-ops.
async function igdbGamePage(page: number, direction: Direction, window?: DateRange): Promise<FeedCandidate[]> {
  if (!igdbConfigured()) return [];
  if (!window && direction === "past") return [];
  const win = window ?? dateWindow(direction);
  const { gte, lte } = win;
  const gteU = Math.floor(new Date(gte).getTime() / 1000);
  const lteU = Math.floor(new Date(lte).getTime() / 1000);
  const games = await discoverIgdbUpcoming(gteU, lteU, 40, (page - 1) * 40, isPastWindow(win) ? "total_rating_count" : "hypes");
  return games.map((g: any): FeedCandidate => ({
    id: `igdb-${g.id}`, rawId: g.id, source: "igdb", type: "game",
    title: g.name, releaseDate: igdbReleaseDate(g),
    // Prefer the portrait cover; when a game has none yet (common for freshly
    // announced titles), fall back to the best landscape art available — artwork
    // (hero image) then a screenshot — so the card shows something real.
    posterUrl:
      igdbImageUrl(g.cover?.image_id, "t_cover_big") ??
      igdbImageUrl(g.artworks?.[0]?.image_id, "t_720p") ??
      igdbImageUrl(g.screenshots?.[0]?.image_id, "t_720p"),
    platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p?.name).filter(Boolean),
    ids: { igdb: g.id },
    raw: { source: "igdb", sourceId: String(g.id), data: g },
    genreNames: [
      ...(g.genres ?? []).map((x: any) => x?.name),
      ...(g.themes ?? []).map((x: any) => x?.name),
    ].filter((n): n is string => typeof n === "string"),
    originalLanguage: null,
    voteCount: g.total_rating_count ?? 0,
    voteAverage: typeof g.total_rating === "number" && g.total_rating > 0 ? g.total_rating / 10 : null, // 0–100 → 0–10
    // Mirrors the sort actually used above: anticipation ahead of release,
    // rating volume after it.
    popularity: (typeof g.hypes === "number" ? g.hypes : null) ?? (typeof g.total_rating_count === "number" ? g.total_rating_count : null),
  }));
}

export function fetchIgdbGamePage(page = 1, direction: Direction = "future", window?: DateRange): Promise<FeedCandidate[]> {
  return bestEffort("igdb", () => igdbGamePage(page, direction, window));
}

// Trakt "anticipated" → candidates keyed by their TMDB id (source "tmdb") so they
// dedupe against the TMDB discover pool and get a poster + full facets when
// hydrated (Trakt itself serves no images). Window-filtered to upcoming, like
// the other sources. Items without a tmdb id or date are dropped.
function traktToCandidate(entry: any, type: MediaType, win: { gte: string; lte: string }): FeedCandidate | null {
  const m = entry.movie ?? entry.show ?? entry;
  const tmdbId = m?.ids?.tmdb;
  if (!tmdbId) return null;
  const releaseDate: string | null = m.released ?? m.first_aired?.split("T")[0] ?? null;
  if (!releaseDate || releaseDate < win.gte || releaseDate > win.lte) return null;
  return {
    id: `tmdb-${type === "movie" ? "movie" : "show"}-${tmdbId}`, rawId: tmdbId, source: "tmdb", type,
    title: m.title, releaseDate,
    posterUrl: null, // filled by TMDB hydration
    overview: m.overview, ids: { tmdb: tmdbId, ...(m.ids?.trakt ? { trakt: m.ids.trakt } : {}) },
    // The payload is TRAKT's, even though the candidate is keyed by its tmdb id
    // (see RawPayload). Its `ids.tmdb` still reaches media_external_ids via
    // extractCrossIds, so the item stays matchable against the TMDB pool.
    raw: m.ids?.trakt != null ? { source: "trakt", sourceId: String(m.ids.trakt), data: m } : null,
    genreNames: (m.genres ?? []).filter((g: any): g is string => typeof g === "string"),
    originalLanguage: m.language ?? null,
    voteCount: m.votes ?? 0,
    voteAverage: typeof m.rating === "number" && m.rating > 0 ? m.rating : null,
    // Trakt's list is already an anticipation RANKING with no per-item reach
    // metric; there's nothing honest to put here. (Trakt is also excluded from
    // the calendar's popular pull — /movies/anticipated takes no date param.)
    popularity: null,
  };
}

export function fetchTraktMoviePage(page = 1): Promise<FeedCandidate[]> {
  return bestEffort("trakt", async () => {
    if (!traktConfigured()) return [];
    const win = dateWindow("future");
    const entries = await getTraktAnticipatedMovies(60, page);
    return entries.map((e) => traktToCandidate(e, "movie", win)).filter((c): c is FeedCandidate => !!c);
  });
}

export function fetchTraktShowPage(page = 1): Promise<FeedCandidate[]> {
  return bestEffort("trakt", async () => {
    if (!traktConfigured()) return [];
    const win = dateWindow("future");
    const entries = await getTraktAnticipatedShows(60, page);
    return entries.map((e) => traktToCandidate(e, "show", win)).filter((c): c is FeedCandidate => !!c);
  });
}

// ── TRENDING (2026-07-30) ──────────────────────────────────────────
// What's popular RIGHT NOW, released titles included. Everything above this line
// is windowed to unreleased dates, which is why Home's "Popular" rail could only
// ever show best-rated UPCOMING titles and never matched TMDB Trending / Trakt
// Trending. These fetchers are the missing input.
//
// No date window at all, deliberately: "trending" is defined by current activity,
// and filtering it to a release window is what broke the old rail. The one filter
// kept is a poster/date sanity check at the ranking stage (rankCrossSourcePopularity
// drops undated items, so an unreleased-and-undated trending entry still can't
// land on a calendar).

/** TMDB trending — `/trending/{movie,tv}/{day,week}`. Weekly is far less jumpy. */
async function tmdbTrending(
  type: "movie" | "show", page: number, window: "day" | "week"
): Promise<FeedCandidate[]> {
  const path = type === "movie" ? "movie" : "tv";
  const res = await httpFetch(
    `https://api.themoviedb.org/3/trending/${path}/${window}?api_key=${TMDB_KEY}&page=${page}`,
    { budgetMs: BROWSE_BUDGET_MS }
  );
  if (!res.ok) return [];
  const data = await res.json();
  // The trending payload mixes movie and tv shapes when called on /all; we only
  // ever call the typed endpoints, but guard anyway so a media_type mismatch
  // can't produce a candidate labelled as the wrong type.
  return (data.results ?? [])
    .filter((r: any) => !r.media_type || r.media_type === path)
    .map((m: any): FeedCandidate => ({
      id: `tmdb-${type}-${m.id}`, rawId: m.id, source: "tmdb", type,
      title: type === "movie" ? m.title : m.name,
      releaseDate: (type === "movie" ? m.release_date : m.first_air_date) ?? null,
      posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
      overview: m.overview, ids: { tmdb: m.id },
      raw: { source: "tmdb", sourceId: String(m.id), data: m },
      genreNames: tmdbGenreNames(m.genre_ids, type),
      originalLanguage: m.original_language ?? null,
      voteCount: m.vote_count ?? 0,
      voteAverage: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
      popularity: typeof m.popularity === "number" ? m.popularity : null,
    }));
}

/** TMDB trending — `/trending/{movie,tv}/{day,week}`. Weekly is far less jumpy. */
export function fetchTmdbTrending(
  type: "movie" | "show", page = 1, window: "day" | "week" = "week"
): Promise<FeedCandidate[]> {
  return bestEffort("tmdb", () => tmdbTrending(type, page, window));
}

/**
 * Trakt trending. Keyed by TMDB id (same as the anticipated path) so it dedupes
 * against the TMDB pool and picks up a poster on hydration — Trakt serves none.
 *
 * Unlike `traktToCandidate`, this keeps items regardless of release date and
 * carries `watchers` as the popularity metric.
 */
export function fetchTraktTrending(type: "movie" | "show", page = 1): Promise<FeedCandidate[]> {
  return bestEffort("trakt", async () => {
  if (!traktConfigured()) return [];
  const entries = type === "movie"
    ? await getTraktTrendingMovies(40, page)
    : await getTraktTrendingShows(40, page);
  const out: FeedCandidate[] = [];
  for (const entry of entries) {
    const m = entry.movie ?? entry.show ?? entry;
    const tmdbId = m?.ids?.tmdb;
    if (!tmdbId) continue;
    out.push({
      id: `tmdb-${type}-${tmdbId}`, rawId: tmdbId, source: "tmdb", type,
      title: m.title,
      releaseDate: m.released ?? m.first_aired?.split("T")[0] ?? null,
      posterUrl: null, // filled by TMDB hydration / the TMDB duplicate winning dedupe
      overview: m.overview,
      ids: { tmdb: tmdbId, ...(m.ids?.trakt ? { trakt: m.ids.trakt } : {}) },
      raw: m.ids?.trakt != null ? { source: "trakt", sourceId: String(m.ids.trakt), data: m } : null,
      genreNames: (m.genres ?? []).filter((g: any): g is string => typeof g === "string"),
      originalLanguage: m.language ?? null,
      voteCount: m.votes ?? 0,
      voteAverage: typeof m.rating === "number" && m.rating > 0 ? m.rating : null,
      // Live watcher count — a genuine reach metric, on Trakt's own scale.
      // rankCrossSourcePopularity normalizes it against Trakt's own median.
      popularity: typeof entry.watchers === "number" ? entry.watchers : null,
    });
  }
  return out;
  });
}

/**
 * Games have no trending endpoint anywhere. The honest equivalent is "released
 * recently, ordered by how many people added it" — RAWG's `added` is exactly a
 * reach metric, and a 60-day trailing window is what makes it *current* rather
 * than an all-time chart.
 */
export async function fetchRawgTrendingGames(page = 1, days = 60): Promise<FeedCandidate[]> {
  const win: DateRange = { gte: offsetISO(-days), lte: todayISO() };
  return fetchGamePage(page, "past", win);
}

// Fetch the first `n` popularity pages of a source in parallel, flattened.
export async function fetchPages(
  fetcher: (page: number) => Promise<FeedCandidate[]>,
  n: number
): Promise<FeedCandidate[]> {
  const pages = await Promise.all(Array.from({ length: n }, (_, i) => fetcher(i + 1)));
  return pages.flat();
}
