import { httpFetch } from "@/lib/http";

const BASE = "https://api.themoviedb.org/3";
// See RAWG_HOST in sources/rawg.ts — the breaker is keyed by host, so it's
// derived from BASE rather than restated.
export const TMDB_HOST = new URL(BASE).host;
const KEY = process.env.TMDB_API_KEY!;

async function tmdbGet(endpoint: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ api_key: KEY, ...params });
  const res = await httpFetch(`${BASE}${endpoint}?${p}`, { appScopedAuth: true });
  if (!res.ok) throw new Error(`TMDB error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function getTmdbMovie(id: number) {
  return tmdbGet(`/movie/${id}`, { append_to_response: "videos,credits,watch/providers,keywords,release_dates,external_ids" });
}

export async function getTmdbShow(id: number) {
  const d = await tmdbGet(`/tv/${id}`, { append_to_response: "videos,credits,watch/providers,keywords,content_ratings,external_ids" });
  // A show's `credits` holds only the latest season's REGULARS. A miniseries
  // whose actors TMDB files episode by episode as guest stars (Adolescence:
  // 0 regulars, everyone a guest) comes back with no cast at all, so its page
  // had no Cast rail and the score no cast facet (50 of the pool's 1,706 TMDB
  // shows on 2026-11-02). `aggregate_credits` holds every episode's credits.
  // The LATEST season's is asked, the season `credits` describes: the whole
  // series' list runs to thousands of rows on a soap or a wrestling show, too
  // much to parse in a 10 ms Worker. Only an empty CAST asks; an empty crew
  // alone is common. It throws like any TMDB call, so a refresh keeps the
  // stored copy instead of storing no cast.
  if (d?.credits && !d.credits.cast?.length) {
    const season = latestSeasonNumber(d);
    const agg = await tmdbGet(season == null ? `/tv/${id}/aggregate_credits` : `/tv/${id}/season/${season}/aggregate_credits`);
    d.credits = fillCreditsFromAggregate(d.credits, agg);
  }
  return d;
}

/** The latest aired season, else the season count; null when TMDB names neither. */
function latestSeasonNumber(d: any): number | null {
  const n = d?.last_episode_to_air?.season_number ?? d?.number_of_seasons;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Fills an empty half of a show's `credits` from its `aggregate_credits`, in
 * `credits`' own row shape, so the projection, normalize and facets read it
 * unchanged. A half that has rows is left as it is. Most episodes first; a
 * person's character is the role they played in the most episodes, and a crew
 * member gets one row per job.
 */
export function fillCreditsFromAggregate(credits: any, agg: any): any {
  const byEpisodes = (rows: any[]) =>
    rows.slice().sort((a, b) => (b?.total_episode_count ?? 0) - (a?.total_episode_count ?? 0));
  const out = { ...credits };
  if (!credits?.cast?.length && Array.isArray(agg?.cast)) {
    out.cast = byEpisodes(agg.cast).map((c: any, i: number) => {
      const role = (c?.roles ?? []).slice().sort((a: any, b: any) => (b?.episode_count ?? 0) - (a?.episode_count ?? 0))[0];
      return { id: c?.id, name: c?.name, character: role?.character || null, profile_path: c?.profile_path ?? null, order: i };
    });
  }
  if (!credits?.crew?.length && Array.isArray(agg?.crew)) {
    out.crew = byEpisodes(agg.crew).flatMap((c: any) =>
      (c?.jobs ?? []).map((j: any) => ({ id: c?.id, name: c?.name, job: j?.job, profile_path: c?.profile_path ?? null })),
    );
  }
  return out;
}

// ── Seasons + episodes (MB14) ────────────────────────────────────────────────
// Deliberately NOT folded into getTmdbShow's append_to_response: the season list
// is dropped by project.ts's keep-list, so reading it from a stored blob would
// mean bumping PROJECTION_VERSION and re-projecting the whole catalog — the op
// that took prod down once. Two small dedicated calls, cached in show_seasons /
// show_episodes forever after, cost far less than that.
//
// Both THROW on a bad response (tmdbGet does). The Worker's season walk
// (worker/src/cron.ts, runShowSeasonsStep) degrades to whatever is already
// stored; nothing here drives a prune. A full getTmdbShow answer carries
// `seasons` too, and ingest stores them before the projection drops them
// (worker/src/catalog/seasons.ts).
export async function getTmdbShowSeasons(id: string | number): Promise<any[]> {
  const data = await tmdbGet(`/tv/${id}`);
  return Array.isArray(data?.seasons) ? data.seasons : [];
}

export async function getTmdbSeasonEpisodes(id: string | number, seasonNumber: number): Promise<any[]> {
  const data = await tmdbGet(`/tv/${id}/season/${seasonNumber}`);
  return Array.isArray(data?.episodes) ? data.episodes : [];
}

export async function searchTmdbMovie(query: string, year?: number) {
  const params: Record<string, string> = { query };
  if (year) params.year = String(year);
  const data = await tmdbGet("/search/movie", params);
  return data.results?.[0] ?? null;
}

export async function searchTmdbShow(query: string) {
  const data = await tmdbGet("/search/tv", { query });
  return data.results?.[0] ?? null;
}

export function tmdbPosterUrl(path: string | null, size = "w500"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

// ── Account (user) API — v3 request-token / session flow ──────────────────────
// Used by the TMDB MediaSource adapter. Auth = the app's api_key + a per-user
// session_id (obtained via the OAuth-like approval flow), stored on the identity.

export async function createTmdbRequestToken(): Promise<string> {
  const res = await httpFetch(`${BASE}/authentication/token/new?api_key=${KEY}`, { appScopedAuth: true });
  const data = await res.json();
  if (!data.request_token) throw new Error("TMDB request token failed");
  return data.request_token;
}

export async function createTmdbSession(requestToken: string): Promise<string> {
  const res = await httpFetch(`${BASE}/authentication/session/new?api_key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_token: requestToken }),
  });
  const data = await res.json();
  if (!data.session_id) throw new Error("TMDB session creation failed");
  return data.session_id;
}

export async function getTmdbAccount(sessionId: string): Promise<{ id: number; username: string; name: string }> {
  const res = await httpFetch(`${BASE}/account?api_key=${KEY}&session_id=${sessionId}`);
  if (!res.ok) throw new Error(`TMDB account: ${res.status}`);
  return res.json();
}

// Paginate an account list endpoint (watchlist/rated/favorite, movies or tv).
// Throws on a bad page rather than returning what it has so far: these lists
// drive `syncProvider`'s prune, so a truncated pull would delete every item on
// the pages we never fetched. Failing loudly keeps the prune from running.
async function accountList(accountId: string | number, sessionId: string, path: string): Promise<any[]> {
  const items: any[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await httpFetch(
      `${BASE}/account/${accountId}/${path}?api_key=${KEY}&session_id=${sessionId}&page=${page}&sort_by=created_at.desc`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status} account/${path} page ${page}`);
    const data = await res.json();
    items.push(...(data.results ?? []));
    totalPages = data.total_pages ?? 1;
    page++;
  } while (page <= totalPages && page <= 100);
  return items;
}

export function getTmdbWatchlistMovies(accountId: string | number, sessionId: string) { return accountList(accountId, sessionId, "watchlist/movies"); }
export function getTmdbWatchlistShows(accountId: string | number, sessionId: string)  { return accountList(accountId, sessionId, "watchlist/tv"); }
export function getTmdbRatedMovies(accountId: string | number, sessionId: string)      { return accountList(accountId, sessionId, "rated/movies"); }
export function getTmdbRatedShows(accountId: string | number, sessionId: string)       { return accountList(accountId, sessionId, "rated/tv"); }

export async function setTmdbWatchlist(
  accountId: string | number, sessionId: string, mediaType: "movie" | "tv", mediaId: number, add: boolean
): Promise<void> {
  const res = await httpFetch(`${BASE}/account/${accountId}/watchlist?api_key=${KEY}&session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: mediaType, media_id: mediaId, watchlist: add }),
  });
  if (!res.ok) throw new Error(`TMDB watchlist write: ${res.status} ${await res.text()}`);
}

// TMDB accepts a rating value of 0.5–10.0.
export async function setTmdbRating(sessionId: string, mediaType: "movie" | "tv", mediaId: number, value: number): Promise<void> {
  const res = await httpFetch(`${BASE}/${mediaType}/${mediaId}/rating?api_key=${KEY}&session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`TMDB rating write: ${res.status} ${await res.text()}`);
}

export async function deleteTmdbRating(sessionId: string, mediaType: "movie" | "tv", mediaId: number): Promise<void> {
  const res = await httpFetch(`${BASE}/${mediaType}/${mediaId}/rating?api_key=${KEY}&session_id=${sessionId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`TMDB rating delete: ${res.status}`);
}

// ── Collection membership (2026-08-23) ───────────────────────────────────────
//
// Every film TMDB files under a collection, whether or not we hold it. The
// franchise rail could previously only list catalog rows, and measured that day
// **167 of our 249 distinct collections held exactly ONE title** — so for two
// thirds of films with a franchise the rail showed nothing at all, while TMDB
// knew the full list the whole time. We already stored the collection's NAME
// (facets.ts reads belongs_to_collection.name as a label) and never once asked
// what was in it.
//
// Cheap, unlike its IGDB counterpart: sampled over 25 of our real collections,
// **4.8 members and ~4 KB per collection** (against IGDB's average of 78 games).
//
// THROWS on a bad response, like every other tmdbGet caller. The sweep needs to
// tell "this collection has one film" from "the call failed" — writing an empty
// membership on an error would turn an outage into an authoritative answer.
export async function getTmdbCollection(id: number): Promise<{ name: string; parts: any[] } | null> {
  const data = await tmdbGet(`/collection/${id}`);
  if (!data || !Array.isArray(data.parts)) return null;
  return { name: String(data.name ?? ""), parts: data.parts };
}
