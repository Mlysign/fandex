const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.TMDB_API_KEY!;

async function tmdbGet(endpoint: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ api_key: KEY, ...params });
  const res = await fetch(`${BASE}${endpoint}?${p}`);
  if (!res.ok) throw new Error(`TMDB error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function getTmdbMovie(id: number) {
  return tmdbGet(`/movie/${id}`, { append_to_response: "videos,credits,watch/providers,keywords,release_dates,external_ids" });
}

export async function getTmdbShow(id: number) {
  return tmdbGet(`/tv/${id}`, { append_to_response: "videos,credits,watch/providers,keywords,content_ratings,external_ids" });
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
  const res = await fetch(`${BASE}/authentication/token/new?api_key=${KEY}`);
  const data = await res.json();
  if (!data.request_token) throw new Error("TMDB request token failed");
  return data.request_token;
}

export async function createTmdbSession(requestToken: string): Promise<string> {
  const res = await fetch(`${BASE}/authentication/session/new?api_key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_token: requestToken }),
  });
  const data = await res.json();
  if (!data.session_id) throw new Error("TMDB session creation failed");
  return data.session_id;
}

export async function getTmdbAccount(sessionId: string): Promise<{ id: number; username: string; name: string }> {
  const res = await fetch(`${BASE}/account?api_key=${KEY}&session_id=${sessionId}`);
  if (!res.ok) throw new Error(`TMDB account: ${res.status}`);
  return res.json();
}

// Paginate an account list endpoint (watchlist/rated/favorite, movies or tv).
async function accountList(accountId: string | number, sessionId: string, path: string): Promise<any[]> {
  const items: any[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(
      `${BASE}/account/${accountId}/${path}?api_key=${KEY}&session_id=${sessionId}&page=${page}&sort_by=created_at.desc`
    );
    if (!res.ok) break;
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
  const res = await fetch(`${BASE}/account/${accountId}/watchlist?api_key=${KEY}&session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: mediaType, media_id: mediaId, watchlist: add }),
  });
  if (!res.ok) throw new Error(`TMDB watchlist write: ${res.status} ${await res.text()}`);
}

// TMDB accepts a rating value of 0.5–10.0.
export async function setTmdbRating(sessionId: string, mediaType: "movie" | "tv", mediaId: number, value: number): Promise<void> {
  const res = await fetch(`${BASE}/${mediaType}/${mediaId}/rating?api_key=${KEY}&session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`TMDB rating write: ${res.status} ${await res.text()}`);
}

export async function deleteTmdbRating(sessionId: string, mediaType: "movie" | "tv", mediaId: number): Promise<void> {
  const res = await fetch(`${BASE}/${mediaType}/${mediaId}/rating?api_key=${KEY}&session_id=${sessionId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`TMDB rating delete: ${res.status}`);
}
