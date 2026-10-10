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
