const BASE = "https://api.themoviedb.org/3";
const KEY = process.env.TMDB_API_KEY!;

async function tmdbGet(endpoint: string, params: Record<string, string> = {}) {
  const p = new URLSearchParams({ api_key: KEY, ...params });
  const res = await fetch(`${BASE}${endpoint}?${p}`);
  if (!res.ok) throw new Error(`TMDB error: ${res.status} ${endpoint}`);
  return res.json();
}

export async function getTmdbMovie(id: number) {
  return tmdbGet(`/movie/${id}`, { append_to_response: "videos,credits,watch_providers" });
}

export async function getTmdbShow(id: number) {
  return tmdbGet(`/tv/${id}`, { append_to_response: "videos,credits,watch_providers" });
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
