const BASE = "https://api.trakt.tv";
const CLIENT_ID = process.env.TRAKT_CLIENT_ID!;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET!;
const REDIRECT_URI = process.env.TRAKT_REDIRECT_URI || "http://localhost:3000/api/auth/trakt/callback";

const HEADERS = {
  "Content-Type": "application/json",
  "trakt-api-version": "2",
  "trakt-api-key": CLIENT_ID,
  "User-Agent": "ReleaseRadar/2.0",
};

export function getTraktAuthUrl(state: string): string {
  const p = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
  return `https://trakt.tv/oauth/authorize?${p}`;
}

export async function exchangeTraktCode(code: string) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  if (!res.ok) { const b = await res.text(); throw new Error(`Trakt token exchange failed: ${res.status} ${b}`); }
  return res.json();
}

export async function refreshTraktToken(refreshToken: string) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Trakt refresh failed: ${res.status}`);
  return res.json();
}

async function traktGet(endpoint: string, accessToken: string) {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function getTraktUserInfo(accessToken: string) {
  return traktGet("/users/me", accessToken);
}

function getStartDate(daysPast: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysPast);
  return d.toISOString().split("T")[0];
}

export async function getTraktWatchlistMovies(accessToken: string) {
  try {
    // Use /sync/watchlist/movies – returns the actual watchlist, not the calendar
    const results = await traktGet("/sync/watchlist/movies?extended=full", accessToken);
    return results ?? [];
  } catch { return []; }
}

export async function getTraktWatchlistShows(accessToken: string) {
  try {
    const results = await traktGet("/sync/watchlist/shows?extended=full", accessToken);
    return results ?? [];
  } catch { return []; }
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

// Write-back: add movie to Trakt watchlist
export async function addMovieToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to add to Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function removeMovieFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to remove from Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function removeShowFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to remove show from Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function addShowToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to add show to Trakt watchlist: ${res.status} ${body}`);
  }
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
