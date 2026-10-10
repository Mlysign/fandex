// A person's, a studio's or a tag's titles from TMDB, for the facet pages. The
// catalog on the device holds what somebody acted on; a director's page built
// from that alone showed one film (Akira Kurosawa, 2026-10-10). The site asked
// the providers for the rest, and so does this, from the device with the TMDB
// key the app may carry (docs/app-plan.md). A port of the TMDB half of the
// site's src/lib/detail/publicFacetDetail.ts.
//
// Films and shows only. Games come from IGDB, whose credentials may not ship,
// and the Worker has no route for a studio's or a tag's games yet.

import { personKey } from '@/lib/facets';
import { api } from '~/lib/api';
import type { CardItem } from '~/lib/cards';
import { TMDB_API_KEY, tmdbConfigured } from '~/lib/config';

const BASE = 'https://api.themoviedb.org/3';

async function tmdb(path: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}`, { signal });
  if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
  return res.json();
}

export interface FacetPerson {
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownFor: string | null;
}

export interface ProviderFacet {
  cards: CardItem[];
  person: FacetPerson | null;
}

function card(c: any, mediaHint?: 'movie' | 'tv'): CardItem {
  const type = (c.media_type ?? mediaHint) === 'tv' ? 'show' : 'movie';
  return {
    key: `tmdb:${type}:${c.id}`, id: null, source: 'tmdb', sourceId: String(c.id), type,
    title: c.title || c.name || 'Untitled',
    releaseDate: c.release_date || c.first_air_date || null,
    posterUrl: c.poster_path ? `https://image.tmdb.org/t/p/w342${c.poster_path}` : null,
    communityScore: typeof c.vote_average === 'number' && c.vote_average > 0 ? Math.round(c.vote_average * 10) : null,
    communityVotes: c.vote_count ?? 0,
  };
}

const unique = (cards: CardItem[]) => {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
};

// ── Person ───────────────────────────────────────────────────────────────────

/** A talk-show appearance or a narration is not part of somebody's body of work. */
const CAST_SELF_RE = /^(self|himself|herself|narrator)\b/i;
const LOW_SIGNAL_CREW_JOBS = new Set(['Thanks', 'Special Thanks', 'Characters']);

/** The person a key names: the exact name with the most popularity, else the most popular result. */
async function personId(key: string, signal?: AbortSignal): Promise<number | null> {
  const d = await tmdb(`/search/person?query=${encodeURIComponent(key)}&include_adult=false`, signal);
  const results: any[] = d?.results ?? [];
  const byPopularity = (a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0);
  const exact = results.filter((r) => personKey(r.name ?? '') === key).sort(byPopularity);
  return (exact[0] ?? [...results].sort(byPopularity)[0])?.id ?? null;
}

async function person(key: string, signal?: AbortSignal): Promise<ProviderFacet> {
  const id = await personId(key, signal);
  if (id == null) return { cards: [], person: null };
  const [meta, credits] = await Promise.all([tmdb(`/person/${id}`, signal), tmdb(`/person/${id}/combined_credits`, signal)]);
  const cards: CardItem[] = [];
  const take = (c: any) => {
    if (!(c.media_type === 'movie' || c.media_type === 'tv') || c.id == null) return;
    // No votes and no poster is an entry nobody filled in.
    if ((c.vote_count ?? 0) === 0 && !c.poster_path) return;
    cards.push(card(c));
  };
  for (const c of credits?.cast ?? []) if (!CAST_SELF_RE.test(String(c.character ?? ''))) take(c);
  for (const c of credits?.crew ?? []) if (!LOW_SIGNAL_CREW_JOBS.has(c.job || '')) take(c);
  return {
    cards: unique(cards),
    person: {
      name: meta?.name ?? key,
      biography: meta?.biography || null,
      birthday: meta?.birthday || null,
      deathday: meta?.deathday || null,
      placeOfBirth: meta?.place_of_birth || null,
      profileUrl: meta?.profile_path ? `https://image.tmdb.org/t/p/w300${meta.profile_path}` : null,
      knownFor: meta?.known_for_department || null,
    },
  };
}

// ── Studio and tag: TMDB's discover, by popularity and by date ───────────────

const PAGES = [1, 2];

async function discover(filter: string, signal?: AbortSignal): Promise<CardItem[]> {
  const requests: Promise<CardItem[]>[] = [];
  for (const [media, recency] of [['movie', 'primary_release_date.desc'], ['tv', 'first_air_date.desc']] as const) {
    for (const sort of ['popularity.desc', recency]) {
      for (const page of PAGES) {
        requests.push(
          tmdb(`/discover/${media}?${filter}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}`, signal)
            .then((d) => ((d?.results ?? []) as any[]).map((m) => card(m, media)))
            // One list that failed is a shorter page, not an empty one.
            .catch(() => []),
        );
      }
    }
  }
  return unique((await Promise.all(requests)).flat());
}

/** The company a name means: the only match, else the one with the most films. */
async function companyId(label: string, signal?: AbortSignal): Promise<number | null> {
  const results: any[] = (await tmdb(`/search/company?query=${encodeURIComponent(label)}`, signal))?.results ?? [];
  if (results.length <= 1) return results[0]?.id ?? null;
  const sized = await Promise.all(results.slice(0, 5).map(async (c) => ({
    id: c.id as number,
    total: ((await tmdb(`/discover/movie?with_companies=${c.id}&page=1`, signal).catch(() => null))?.total_results ?? 0) as number,
  })));
  sized.sort((a, b) => b.total - a.total);
  return sized[0]?.total > 0 ? sized[0].id : (results.find((r) => (r.name ?? '').toLowerCase() === label.toLowerCase())?.id ?? results[0].id);
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A tag is a TMDB genre when one carries its name, else a TMDB keyword of exactly that name. */
async function tagFilter(label: string, signal?: AbortSignal): Promise<string | null> {
  const want = plain(label);
  const [movie, tv] = await Promise.all([tmdb('/genre/movie/list', signal), tmdb('/genre/tv/list', signal)]);
  const genre = [...((movie?.genres ?? []) as any[]), ...((tv?.genres ?? []) as any[])].find((g) => plain(g.name ?? '') === want);
  if (genre) return `with_genres=${genre.id}`;
  const keywords: any[] = (await tmdb(`/search/keyword?query=${encodeURIComponent(label)}`, signal))?.results ?? [];
  const keyword = keywords.find((k) => plain(k.name ?? '') === want);
  return keyword ? `with_keywords=${keyword.id}` : null;
}

// ── The page's question ──────────────────────────────────────────────────────

/**
 * What TMDB has for this facet, with each title the Worker already knows given
 * its Fandex id, so the card shows your state and opens the page it has.
 * Throws when TMDB cannot be reached; the page then shows what the device holds.
 */
export async function providerFacet(kind: 'tag' | 'person' | 'studio', key: string, label: string, signal?: AbortSignal): Promise<ProviderFacet> {
  if (!tmdbConfigured()) return { cards: [], person: null };
  let found: ProviderFacet;
  if (kind === 'person') found = await person(key, signal);
  else if (kind === 'studio') {
    const id = await companyId(label, signal);
    found = { cards: id == null ? [] : await discover(`with_companies=${id}`, signal), person: null };
  } else {
    const filter = await tagFilter(label, signal);
    found = { cards: filter ? await discover(filter, signal) : [], person: null };
  }
  if (!found.cards.length) return found;
  try {
    const res = await api.lookup(found.cards.slice(0, 2000).map((c) => ({ source: 'tmdb', type: c.type, id: c.sourceId as string })));
    const held = new Map(res.found.map((f) => [`${f.source}:${f.type}:${f.id}`, f.mediaItemId]));
    found.cards = found.cards.map((c) => (held.has(c.key) ? { ...c, id: held.get(c.key) as string } : c));
  } catch { /* the cards still open; they just do not know your state */ }
  return found;
}
