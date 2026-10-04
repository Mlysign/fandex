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
