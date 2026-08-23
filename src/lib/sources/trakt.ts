import type { HttpFetchInit } from "@/lib/http";
import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";

const BASE = "https://api.trakt.tv";
const CLIENT_ID = process.env.TRAKT_CLIENT_ID!;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET!;
const REDIRECT_URI = process.env.TRAKT_REDIRECT_URI || "http://localhost:3000/api/auth/trakt/callback";

const HEADERS = {
  "Content-Type": "application/json",
  "trakt-api-version": "2",
  "trakt-api-key": CLIENT_ID,
  "User-Agent": "Fandex/2.0",
};

export function getTraktAuthUrl(state: string): string {
  const p = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
  return `https://trakt.tv/oauth/authorize?${p}`;
}

export async function exchangeTraktCode(code: string) {
  const res = await httpFetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  if (!res.ok) { const b = await res.text(); throw new Error(`Trakt token exchange failed: ${res.status} ${b}`); }
  return res.json();
}

export async function refreshTraktToken(refreshToken: string) {
  const res = await httpFetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Trakt refresh failed: ${res.status}`);
  return res.json();
}

async function traktGet(endpoint: string, accessToken: string) {
  const res = await httpFetch(`${BASE}${endpoint}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
  return res.json();
}

// Trakt paginates its /sync list endpoints (watched / ratings / watchlist) at
// 100 items per page and returns ONLY the first page unless you follow the
// `X-Pagination-Page-Count` header — so a user with >100 watched/rated titles
// silently lost everything past the first 100 (the whole library appeared capped
// at 100). This walks every page and concatenates the results. Endpoints that
// aren't paginated report no page-count header → treated as a single page, so
// this is a safe drop-in for any list GET. Pages are fetched sequentially to
// avoid bursting Trakt's rate limit on very large libraries.
async function traktGetAllPages(endpoint: string, accessToken: string, limit = 100): Promise<any[]> {
  const headers = { ...HEADERS, Authorization: `Bearer ${accessToken}` };
  const sep = endpoint.includes("?") ? "&" : "?";
  const out: any[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const res = await httpFetch(`${BASE}${endpoint}${sep}page=${page}&limit=${limit}`, { headers });
    if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
    pageCount = Number(res.headers.get("x-pagination-page-count")) || 1;
    const data = await res.json();
    if (Array.isArray(data)) out.push(...data);
    page++;
  } while (page <= pageCount);
  return out;
}

// ── Public (catalog) API — client-id auth only, no user token ─────
// Summary/search endpoints are public; extended=full carries runtime,
// certification, rating+votes, tagline, status, country, network, trailer.

export function traktConfigured(): boolean {
  return !!CLIENT_ID;
}

// `init` exists for ONE reason (G3, 2026-08-02): the four browse-feed callers
// below pass `BROWSE_BUDGET_MS` so a Trakt outage costs a discover/home request
// seconds instead of the full 20s × 3 retry ladder. It is deliberately opt-in
// per caller rather than applied here, because this same helper also serves
// `getTrakt*Summary` and `searchTraktPublic`, which run during ENRICHMENT — and
// enrichment would rather wait than lose an item's metadata. Sync paths must
// never inherit a browse budget.
async function traktGetPublic(endpoint: string, init: HttpFetchInit = {}) {
  const res = await httpFetch(`${BASE}${endpoint}`, { headers: HEADERS, appScopedAuth: true, ...init });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
  return res.json();
}

/** The budget the browse-feed callers below use. See http.ts. */
const BROWSE: HttpFetchInit = { budgetMs: BROWSE_BUDGET_MS };

// idOrSlug accepts a numeric trakt id or a slug.
export async function getTraktMovieSummary(idOrSlug: string): Promise<any | null> {
  try { return await traktGetPublic(`/movies/${idOrSlug}?extended=full`); }
  catch { return null; }
}

export async function getTraktShowSummary(idOrSlug: string): Promise<any | null> {
  try { return await traktGetPublic(`/shows/${idOrSlug}?extended=full`); }
  catch { return null; }
}

/**
 * A show's SEASONS + EPISODES — the catalog half of episode tracking, from
 * Trakt rather than TMDB (MB14 follow-up, 2026-08-16).
 *
 * Why this exists even though TMDB already serves it: Trakt is the only
 * provider that knows what you have WATCHED, but `/sync/watched/shows` returns
 * only the episodes you've seen — it can't say that season 2 has twelve. So the
 * "n of total" and "what's next" both need a full list, and a show with no TMDB
 * link had no way to get one. For a Trakt-only user that meant a blank section
 * on a show Trakt knows everything about.
 *
 * `extended=full,episodes` returns every season WITH its episodes in ONE call —
 * cheaper than TMDB, which needs one call per season. No stills (Trakt serves no
 * images), which is why TMDB stays the preferred source when a link exists.
 *
 * Public endpoint: client-id only, NO user token. It is catalog metadata, not
 * anybody's watch history. Throws like the other catalog fetches; the caller in
 * lib/episodes.ts degrades to whatever is stored.
 */
export async function getTraktShowSeasons(idOrSlug: string): Promise<any[]> {
  const data = await traktGetPublic(`/shows/${idOrSlug}/seasons?extended=full,episodes`);
  return Array.isArray(data) ? data : [];
}

export async function searchTraktPublic(query: string, type: "movie" | "show", limit = 5): Promise<any[]> {
  try {
    return (await traktGetPublic(`/search/${type}?query=${encodeURIComponent(query)}&limit=${limit}&extended=full`)) ?? [];
  } catch { return []; }
}

// Most-anticipated unreleased titles (public; client-id only). Each entry is
// `{ list_count, movie|show: {...} }`; extended=full carries genres, language,
// rating/votes, overview, released/first_aired and ids (including tmdb — which
// the discover feed needs to render + dedupe against TMDB). This is Trakt's
// unique contribution: a crowd-anticipation ranking TMDB's popularity sort lacks.
export async function getTraktAnticipatedMovies(limit = 60, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/movies/anticipated?extended=full&limit=${limit}&page=${page}`, BROWSE)) ?? []; }
  catch { return []; }
}

export async function getTraktAnticipatedShows(limit = 60, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/shows/anticipated?extended=full&limit=${limit}&page=${page}`, BROWSE)) ?? []; }
  catch { return []; }
}

// TRENDING — what people are watching RIGHT NOW (2026-07-30). Distinct from
// `anticipated` above in the way that matters for Home: anticipated is
// unreleased-only, trending is dominated by titles that are OUT. Home's
// "Popular" rail was built on upcoming-only data and therefore could never match
// what Nils sees on Trakt's own Trending page, which is what he was comparing
// against.
//
// Each entry is `{ watchers, movie|show: {...} }`. `watchers` (live viewers) is a
// real per-item reach metric, which `anticipated` genuinely lacks — so unlike the
// anticipated candidates, these can carry a `popularity` value for cross-source
// ranking instead of a null.
export async function getTraktTrendingMovies(limit = 40, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/movies/trending?extended=full&limit=${limit}&page=${page}`, BROWSE)) ?? []; }
  catch { return []; }
}

export async function getTraktTrendingShows(limit = 40, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/shows/trending?extended=full&limit=${limit}&page=${page}`, BROWSE)) ?? []; }
  catch { return []; }
}

export async function getTraktUserInfo(accessToken: string) {
  return traktGet("/users/me", accessToken);
}

function getStartDate(daysPast: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysPast);
  return d.toISOString().split("T")[0];
}

// ── /sync pulls (drive the prune) ─────────────────────────────────
// These MUST throw on failure rather than return []. `syncProvider` prunes any
// local entry whose id is absent from the pull, so a swallowed error becomes an
// empty pull becomes "the user deleted their whole library" — a transient Trakt
// 500/429/401 would wipe every Trakt row and log it as status=ok. Throwing lets
// syncProvider's catch log a real error and return BEFORE the prune runs.
// An empty pull must therefore mean "upstream really is empty", never "the call
// failed". Non-pruning readers below (calendar/public) may still catch → [].

export async function getTraktWatchlistMovies(accessToken: string) {
  // Use /sync/watchlist/movies – returns the actual watchlist, not the calendar
  return traktGetAllPages("/sync/watchlist/movies?extended=full", accessToken);
}

export async function getTraktWatchlistShows(accessToken: string) {
  return traktGetAllPages("/sync/watchlist/shows?extended=full", accessToken);
}

// ── Watched + ratings (for the Library / history page) ────────────

// extended=full so stored raw_data carries overview/released/genres/trailer —
// without it Trakt returns bare {title, year, ids} and the merge gets nothing.
export async function getTraktWatchedMovies(accessToken: string) {
  return traktGetAllPages("/sync/watched/movies?extended=full", accessToken);
}

// ⚠️ THIS RESPONSE CARRIES NO EPISODES. Do not try to read `seasons` off it
// again — the answer is measured, not inferred, and it is final.
//
// Trakt documents seasons as returned by default for this endpoint (only
// `extended=noseasons` suppresses them). MB14 shipped on that reading and
// attached zero episodes. A run-time fallback was then added to graft seasons
// from the plain call; it fired and found nothing either. `/api/dev/trakt-shape`
// against the live account on 2026-08-16 settled it — 280 entries, `seasons`
// **absent** (not empty: absent) on all 280, in BOTH variants:
//
//   withExtended  entries 280  seasons {absent: 280, nonEmptyArray: 0}
//   plain         entries 280  seasons {absent: 280, nonEmptyArray: 0}
//
// The bulk episode source is `/sync/history/episodes` (below); the per-show one
// is `/shows/{id}/progress/watched`. This call is now purely what it always
// should have been: show-level library metadata.
export async function getTraktWatchedShows(accessToken: string) {
  return traktGetAllPages("/sync/watched/shows?extended=full", accessToken);
}

// MB14's actual bulk episode source. One entry PER PLAY — a rewatch appears
// twice — shaped {id, watched_at, action, type, episode:{season, number, ids},
// show:{ids, title}}. Verified 2026-08-16: 100 entries on the first page with
// real season/episode numbers.
//
// Paginated, and walked in full: this drives the prune, so a partial read would
// look like "the user un-watched everything after page 3". traktGetAllPages
// throws on any page failing, which is what keeps that from happening.
export async function getTraktEpisodeHistory(accessToken: string) {
  return traktGetAllPages("/sync/history/episodes", accessToken);
}

// The per-show view of the same state, used where one show's exact progress
// matters more than breadth. Returns {aired, completed, seasons:[{number,
// aired, completed, episodes:[{number, completed, last_watched_at}]}]}.
//
// ⚠️ It lists EVERY aired episode, watched or not — only `completed: true`
// counts. Reading mere presence would mark a whole show watched on sight, and
// since the result feeds a prune, the inverse mistake deletes real history.
export async function getTraktShowWatchedProgress(accessToken: string, traktId: number) {
  return traktGet(`/shows/${traktId}/progress/watched?specials=true&count_specials=false`, accessToken);
}

export async function getTraktRatingsMovies(accessToken: string) {
  return traktGetAllPages("/sync/ratings/movies?extended=full", accessToken);
}

export async function getTraktRatingsShows(accessToken: string) {
  return traktGetAllPages("/sync/ratings/shows?extended=full", accessToken);
}

// Calendar endpoint – used separately for episode-level data
export async function getTraktCalendarMovies(accessToken: string, daysPast = 365, daysFuture = 365) {
  const start = getStartDate(daysPast);
  const total = daysPast + daysFuture;
  try {
    return await traktGet(`/calendars/my/movies/${start}/${total}`, accessToken);
  } catch { return []; }
}

export async function getTraktCalendarShows(accessToken: string, daysPast = 365, daysFuture = 365) {
  const start = getStartDate(daysPast);
  const total = daysPast + daysFuture;
  try {
    return await traktGet(`/calendars/my/shows/${start}/${total}`, accessToken);
  } catch { return []; }
}

// PL2 (2026-08-23) — Trakt's ACCOUNT LIMITS, made legible.
//
// Trakt caps a free account's watchlist, its ratings and its number of personal
// lists, and it signals a cap with its own status code: **420, "Account Limit
// Exceeded"**, alongside an `X-Upgrade-URL` header pointing at VIP. Every write
// helper below already threw on a non-ok response, so this was never a silent
// failure at THIS layer. It became one a level up, where /api/watchlist caught
// the throw, logged it and answered `{ ok: true }` anyway — so the item vanished
// from the user's Trakt watchlist while Fandex said it had been added.
//
// ⚠️ Deliberately no number in the message. The cap is not one value: Trakt has
// published different limits for new members, existing members and VIP, and has
// changed them. Quoting "250" here would be wrong for most accounts and would
// rot silently. Say the list is full, hand over Trakt's own upgrade URL, and let
// Trakt state its own numbers.
export const TRAKT_ACCOUNT_LIMIT = 420;

export async function traktWriteError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  if (res.status === TRAKT_ACCOUNT_LIMIT) {
    const upgrade = res.headers.get("x-upgrade-url");
    return new Error(
      `Your Trakt account is at its limit, so ${what} did not save there. ` +
      `Trakt caps watchlists, ratings and lists on free accounts` +
      (upgrade ? `. Raise the cap at ${upgrade}` : "") + ".",
    );
  }
  return new Error(`Trakt: ${what} failed (${res.status}) ${body}`.trim());
}

// Write-back: add movie to Trakt watchlist
export async function addMovieToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await httpFetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "adding this film to your watchlist");
}

export async function removeMovieFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await httpFetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "removing this film from your watchlist");
}

export async function removeShowFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await httpFetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "removing this show from your watchlist");
}

export async function addShowToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await httpFetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "adding this show to your watchlist");
}

// Look up Trakt ID by TMDB ID
export async function getTraktIdByTmdb(tmdbId: number, type: "movie" | "show", accessToken: string): Promise<number | null> {
  try {
    const endpoint = type === "movie" ? `/search/tmdb/${tmdbId}?type=movie` : `/search/tmdb/${tmdbId}?type=show`;
    const results = await traktGet(endpoint, accessToken);
    const item = results?.[0];
    if (!item) return null;
    return type === "movie" ? item.movie?.ids?.trakt : item.show?.ids?.trakt;
  } catch {
    return null;
  }
}

// Search Trakt for movies or shows
export async function searchTrakt(query: string, type: "movie" | "show", accessToken: string): Promise<any[]> {
  try {
    const results = await traktGet(`/search/${type}?query=${encodeURIComponent(query)}&limit=8`, accessToken);
    return results ?? [];
  } catch {
    return [];
  }
}

// ── Write-back: rate + mark watched ───────────────────────────────

// POST rating (1-10) to Trakt /sync/ratings
export async function rateTraktItem(
  accessToken: string,
  type: "movie" | "show",
  traktId: number,
  rating: number  // 1-10 integer
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await httpFetch(`${BASE}/sync/ratings`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ rating, ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "saving this rating");
}

// POST to Trakt /sync/history to mark a movie/show as watched
export async function markTraktWatched(
  accessToken: string,
  type: "movie" | "show",
  traktId: number,
  watchedAt?: string  // ISO timestamp; defaults to now
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const item: Record<string, any> = { ids: { trakt: traktId } };
  if (watchedAt) item.watched_at = watchedAt;
  const res = await httpFetch(`${BASE}/sync/history`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [item] }),
  });
  if (!res.ok) throw await traktWriteError(res, "marking this watched");
}

// Remove a rating from Trakt (/sync/ratings/remove). Used when the user clears
// a rating / removes an item from their library, so a later resync doesn't
// re-pull the stale rating.
export async function removeTraktRating(
  accessToken: string,
  type: "movie" | "show",
  traktId: number
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await httpFetch(`${BASE}/sync/ratings/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) throw await traktWriteError(res, "clearing this rating");
}

// ── Per-episode history (MB14) ────────────────────────────────────────────────
//
// ONE request for a whole batch, deliberately. Trakt's /sync/history takes a
// nested shows → seasons → episodes body, so "mark season 1 as seen" is a single
// call rather than 24 — which matters against a rate-limited API where a
// mid-batch 429 would leave the user's history half-written.
//
// Note the asymmetry with the movie/show helpers above: those post
// `{ ids: { trakt } }` at the top level, which marks EVERYTHING. Sending a
// `seasons` array scopes the write to exactly the listed episodes.
function episodeBody(traktId: number, episodes: { season: number; episode: number }[]) {
  const bySeason = new Map<number, number[]>();
  for (const e of episodes) {
    const list = bySeason.get(e.season) ?? [];
    list.push(e.episode);
    bySeason.set(e.season, list);
  }
  return {
    shows: [
      {
        ids: { trakt: traktId },
        seasons: Array.from(bySeason, ([number, eps]) => ({
          number,
          episodes: eps.map((n) => ({ number: n })),
        })),
      },
    ],
  };
}

async function postEpisodeHistory(
  accessToken: string,
  path: "/sync/history" | "/sync/history/remove",
  traktId: number,
  episodes: { season: number; episode: number }[],
): Promise<void> {
  if (!episodes.length) return;
  const res = await httpFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(episodeBody(traktId, episodes)),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trakt episode history (${path}) failed: ${res.status} ${body}`);
  }
}

/** Mark specific episodes of a show as watched. One request for the whole batch. */
export function addTraktEpisodesToHistory(
  accessToken: string,
  traktId: number,
  episodes: { season: number; episode: number }[],
): Promise<void> {
  return postEpisodeHistory(accessToken, "/sync/history", traktId, episodes);
}

/** Un-watch specific episodes of a show. One request for the whole batch. */
export function removeTraktEpisodesFromHistory(
  accessToken: string,
  traktId: number,
  episodes: { season: number; episode: number }[],
): Promise<void> {
  return postEpisodeHistory(accessToken, "/sync/history/remove", traktId, episodes);
}

// Remove watched-history entries for an item from Trakt (/sync/history/remove),
// so removing it from the library also un-marks it as watched.
export async function removeTraktFromHistory(
  accessToken: string,
  type: "movie" | "show",
  traktId: number
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await httpFetch(`${BASE}/sync/history/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trakt remove history failed: ${res.status} ${body}`);
  }
}

// ── Diagnostic: what shape does /sync/watched/shows actually come back in? ────
//
// MB14's per-episode half reads `seasons[].episodes[]` off this response, and on
// prod it returned 280 shows with ZERO episodes between them. Trakt documents
// seasons as included by default, this environment can't reach a real account,
// and three deploys of inference didn't settle it — so this reports the shape
// directly instead.
//
// SHAPE ONLY, by construction: counts, key names and types. No titles, no ids,
// no token, no watch history. It cannot leak what it never reads.
export interface WatchedShowsShape {
  entries: number;
  entryKeys: string[];
  /** How the `seasons` field arrives across every entry. */
  seasons: { absent: number; notArray: number; emptyArray: number; nonEmptyArray: number };
  totalSeasons: number;
  totalEpisodes: number;
  seasonKeys: string[];
  episodeKeys: string[];
}

function describeWatchedShows(list: any[]): WatchedShowsShape {
  const out: WatchedShowsShape = {
    entries: list.length,
    entryKeys: list.length ? Object.keys(list[0] ?? {}) : [],
    seasons: { absent: 0, notArray: 0, emptyArray: 0, nonEmptyArray: 0 },
    totalSeasons: 0,
    totalEpisodes: 0,
    seasonKeys: [],
    episodeKeys: [],
  };
  for (const e of list) {
    const s = e?.seasons;
    if (s === undefined || s === null) out.seasons.absent++;
    else if (!Array.isArray(s)) out.seasons.notArray++;
    else if (s.length === 0) out.seasons.emptyArray++;
    else {
      out.seasons.nonEmptyArray++;
      out.totalSeasons += s.length;
      for (const season of s) {
        const eps = season?.episodes;
        if (Array.isArray(eps)) out.totalEpisodes += eps.length;
        if (!out.seasonKeys.length && season) out.seasonKeys = Object.keys(season);
        if (!out.episodeKeys.length && Array.isArray(eps) && eps[0]) out.episodeKeys = Object.keys(eps[0]);
      }
    }
  }
  return out;
}

/**
 * Both variants side by side — the comparison IS the answer. If `withExtended`
 * shows no seasons and `plain` does, `extended=full` is suppressing them; if
 * neither does, the account genuinely has no per-episode history at this
 * endpoint and no amount of adapter work will conjure one.
 */
export async function probeWatchedShowsShape(accessToken: string): Promise<{
  withExtended: WatchedShowsShape;
  plain: WatchedShowsShape;
}> {
  const [full, plain] = await Promise.all([
    traktGetAllPages("/sync/watched/shows?extended=full", accessToken),
    traktGetAllPages("/sync/watched/shows", accessToken),
  ]);
  return { withExtended: describeWatchedShows(full), plain: describeWatchedShows(plain) };
}

/**
 * Shape-only probe of the two CANDIDATE episode sources, for the same reason
 * probeWatchedShowsShape exists: measure, don't infer. Counts and key names
 * only — no titles, no ids.
 */
export async function probeEpisodeSources(accessToken: string, sampleShowId: number) {
  const out: Record<string, unknown> = {};
  try {
    const hist = await traktGet(`/sync/history/episodes?limit=100`, accessToken);
    out.historyEpisodes = {
      count: Array.isArray(hist) ? hist.length : null,
      keys: Array.isArray(hist) && hist[0] ? Object.keys(hist[0]) : [],
      hasEpisodeNumbers:
        Array.isArray(hist) && hist[0]?.episode
          ? typeof hist[0].episode.season === "number" && typeof hist[0].episode.number === "number"
          : false,
    };
  } catch (e) {
    out.historyEpisodes = { error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const prog = await traktGet(`/shows/${sampleShowId}/progress/watched`, accessToken);
    out.progressWatched = {
      aired: prog?.aired ?? null,
      completed: prog?.completed ?? null,
      seasons: Array.isArray(prog?.seasons) ? prog.seasons.length : null,
      episodesInFirstSeason: Array.isArray(prog?.seasons?.[0]?.episodes) ? prog.seasons[0].episodes.length : null,
    };
  } catch (e) {
    out.progressWatched = { error: e instanceof Error ? e.message : String(e) };
  }
  return out;
}
