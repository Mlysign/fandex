// TMDB, called straight from the device. Films and shows only; games go
// through the Worker because IGDB's credentials may not ship (docs/app-plan.md).
//
// Search results are provider cards: a TMDB id and what a card needs. Opening
// one goes through the Worker's /v1/resolve, which is what turns a provider id
// into a Fandex item.

import { TMDB_API_KEY, tmdbConfigured } from '~/lib/config';
import type { MediaType } from '~/lib/api';

export interface ProviderCard {
  source: 'tmdb' | 'igdb';
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  votes: number;
}

const BASE = 'https://api.themoviedb.org/3';

/** Films and shows matching a title, most-voted first. Empty when no key is configured. */
export async function searchTmdb(query: string, signal?: AbortSignal): Promise<ProviderCard[]> {
  if (!tmdbConfigured() || query.trim().length < 2) return [];
  const url = `${BASE}/search/multi?api_key=${TMDB_API_KEY}&include_adult=false&query=${encodeURIComponent(query.trim())}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`TMDB search answered ${res.status}`);
  const data = (await res.json()) as { results?: any[] };
  return (data.results ?? [])
    .filter((r) => r && (r.media_type === 'movie' || r.media_type === 'tv') && r.id)
    .map((r): ProviderCard => ({
      source: 'tmdb',
      sourceId: String(r.id),
      type: r.media_type === 'movie' ? 'movie' : 'show',
      title: r.title ?? r.name ?? 'Untitled',
      releaseDate: r.release_date || r.first_air_date || null,
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      votes: typeof r.vote_count === 'number' ? r.vote_count : 0,
    }))
    .sort((a, b) => b.votes - a.votes);
}

export interface SeasonEpisode {
  season: number;
  episode: number;
  title: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
}

/**
 * One season's episodes, for a season the Worker's catalog has no list for. The
 * site filled a season the first time somebody opened it, so most seasons were
 * never stored; the device asks TMDB the same question instead.
 */
export async function tmdbSeasonEpisodes(tmdbId: string, season: number, signal?: AbortSignal): Promise<SeasonEpisode[]> {
  if (!tmdbConfigured()) throw new Error('TMDB is not set up in this build.');
  const res = await fetch(`${BASE}/tv/${encodeURIComponent(tmdbId)}/season/${season}?api_key=${TMDB_API_KEY}`, { signal });
  if (!res.ok) throw new Error(`TMDB season answered ${res.status}`);
  const data = (await res.json()) as { episodes?: any[] };
  return (data.episodes ?? [])
    .filter((e) => e && Number.isInteger(e.episode_number))
    .map((e): SeasonEpisode => ({
      season,
      episode: e.episode_number,
      title: typeof e.name === 'string' && e.name ? e.name : null,
      airDate: typeof e.air_date === 'string' && e.air_date ? e.air_date : null,
      runtimeMinutes: typeof e.runtime === 'number' ? e.runtime : null,
    }))
    .sort((a, b) => a.episode - b.episode);
}

export interface EpisodeDetail {
  title: string | null;
  overview: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  stillUrl: string | null;
  /** TMDB's crowd score, 0-10, and how many votes it is made of. */
  voteAverage: number | null;
  voteCount: number;
}

/** What TMDB knows about one episode: the synopsis and the still the catalog's list does not carry. */
export async function tmdbEpisode(tmdbId: string, season: number, episode: number, signal?: AbortSignal): Promise<EpisodeDetail> {
  if (!tmdbConfigured()) throw new Error('TMDB is not set up in this build.');
  const res = await fetch(`${BASE}/tv/${encodeURIComponent(tmdbId)}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`, { signal });
  if (!res.ok) throw new Error(`TMDB episode answered ${res.status}`);
  const e = (await res.json()) as any;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    title: text(e.name),
    overview: text(e.overview),
    airDate: text(e.air_date),
    runtimeMinutes: typeof e.runtime === 'number' && e.runtime > 0 ? e.runtime : null,
    stillUrl: e.still_path ? `https://image.tmdb.org/t/p/w780${e.still_path}` : null,
    voteAverage: typeof e.vote_average === 'number' && e.vote_count > 0 ? e.vote_average : null,
    voteCount: typeof e.vote_count === 'number' ? e.vote_count : 0,
  };
}

/**
 * The film TMDB ranks first for a title and year, as the site's list import
 * asked it (src/lib/sources/tmdb.ts, searchTmdbMovie). Null when TMDB has none.
 */
export async function searchTmdbMovieId(title: string, year: number | null, signal?: AbortSignal): Promise<number | null> {
  if (!tmdbConfigured()) return null;
  const url = `${BASE}/search/movie?api_key=${TMDB_API_KEY}&include_adult=false&query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`TMDB search answered ${res.status}`);
  const id = ((await res.json()) as { results?: { id?: unknown }[] }).results?.[0]?.id;
  return typeof id === 'number' ? id : null;
}

/** The film or show an IMDb id (tt…) is on TMDB. Exact, unlike a title search. */
export async function tmdbFindImdb(imdbId: string, signal?: AbortSignal): Promise<{ type: 'movie' | 'show'; id: number } | null> {
  if (!tmdbConfigured()) return null;
  const res = await fetch(`${BASE}/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`, { signal });
  if (!res.ok) throw new Error(`TMDB find answered ${res.status}`);
  const data = (await res.json()) as { movie_results?: { id?: unknown }[]; tv_results?: { id?: unknown }[] };
  const movie = data.movie_results?.[0]?.id;
  if (typeof movie === 'number') return { type: 'movie', id: movie };
  const show = data.tv_results?.[0]?.id;
  return typeof show === 'number' ? { type: 'show', id: show } : null;
}

/** The old site's browse window: about eighteen months ahead (src/lib/discoverFeed.ts, DAYS_WINDOW). */
const UPCOMING_DAYS = 550;

/**
 * Upcoming films or shows, most popular first: the old site's Discover feed
 * (discoverFeed.ts, fetchMoviePage and tmdbShowPage), same parameters. A film
 * is asked for in your country, with its theatrical and limited releases, so the
 * date on the card is the one that applies to you.
 */
export async function tmdbUpcoming(type: 'movie' | 'show', page: number, region: string, signal?: AbortSignal): Promise<ProviderCard[]> {
  if (!tmdbConfigured()) return [];
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const url = type === 'movie'
    ? `${BASE}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=popularity.desc&include_adult=false&with_release_type=2|3&region=${encodeURIComponent(region)}`
      + `&release_date.gte=${day(0)}&release_date.lte=${day(UPCOMING_DAYS)}&page=${page}`
    : `${BASE}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=popularity.desc&first_air_date.gte=${day(0)}&first_air_date.lte=${day(UPCOMING_DAYS)}&page=${page}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`TMDB discover answered ${res.status}`);
  const data = (await res.json()) as { results?: any[] };
  return (data.results ?? [])
    .filter((r) => r?.id)
    .map((r): ProviderCard => ({
      source: 'tmdb',
      sourceId: String(r.id),
      type,
      title: r.title ?? r.name ?? 'Untitled',
      releaseDate: r.release_date || r.first_air_date || null,
      posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      votes: typeof r.vote_count === 'number' ? r.vote_count : 0,
    }));
}

/**
 * This week's trending films or shows at TMDB, in TMDB's order: the old site's
 * "Popular right now" (src/lib/homeRails.ts, trendingPool). `score` is the
 * crowd's, 0 to 100.
 */
export async function tmdbTrending(type: 'movie' | 'show', page: number, signal?: AbortSignal): Promise<(ProviderCard & { score: number | null })[]> {
  if (!tmdbConfigured()) return [];
  const res = await fetch(`${BASE}/trending/${type === 'movie' ? 'movie' : 'tv'}/week?api_key=${TMDB_API_KEY}&page=${page}`, { signal });
  if (!res.ok) throw new Error(`TMDB trending answered ${res.status}`);
  const data = (await res.json()) as { results?: any[] };
  return (data.results ?? [])
    .filter((r) => r?.id && r.poster_path)
    .map((r) => ({
      source: 'tmdb' as const,
      sourceId: String(r.id),
      type,
      title: r.title ?? r.name ?? 'Untitled',
      releaseDate: r.release_date || r.first_air_date || null,
      posterUrl: `https://image.tmdb.org/t/p/w342${r.poster_path}`,
      votes: typeof r.vote_count === 'number' ? r.vote_count : 0,
      score: typeof r.vote_average === 'number' && r.vote_average > 0 ? Math.round(r.vote_average * 10) : null,
    }));
}

const collectionCache = new Map<string, Promise<{ name: string; parts: ProviderCard[] } | null>>();

/**
 * The other films in a film's TMDB collection: what a franchise holds that the
 * catalog may not (the site kept these in franchise_members, which is not in
 * D1). Two calls, made once per film per session. Null when it is in none.
 */
export function tmdbCollectionFor(tmdbMovieId: string): Promise<{ name: string; parts: ProviderCard[] } | null> {
  if (!tmdbConfigured()) return Promise.resolve(null);
  let hit = collectionCache.get(tmdbMovieId);
  if (!hit) {
    hit = (async () => {
      const movie = await fetch(`${BASE}/movie/${encodeURIComponent(tmdbMovieId)}?api_key=${TMDB_API_KEY}`).then((r) => (r.ok ? r.json() : null));
      const id = movie?.belongs_to_collection?.id;
      if (typeof id !== 'number') return null;
      const c = await fetch(`${BASE}/collection/${id}?api_key=${TMDB_API_KEY}`).then((r) => (r.ok ? r.json() : null));
      if (!c) return null;
      const parts = ((c.parts ?? []) as any[])
        .filter((p) => p?.id && String(p.id) !== tmdbMovieId && p.poster_path)
        .map((p): ProviderCard => ({
          source: 'tmdb', sourceId: String(p.id), type: 'movie', title: p.title ?? 'Untitled',
          releaseDate: p.release_date || null, posterUrl: `https://image.tmdb.org/t/p/w342${p.poster_path}`,
          votes: typeof p.vote_count === 'number' ? p.vote_count : 0,
        }));
      return { name: String(c.name ?? movie.belongs_to_collection.name ?? ''), parts };
    })().catch(() => null);
    collectionCache.set(tmdbMovieId, hit);
  }
  return hit;
}
