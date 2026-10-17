// A person's, a studio's or a tag's titles from TMDB, for the facet pages. The
// catalog on the device holds what somebody acted on; a director's page built
// from that alone showed one film (Akira Kurosawa, 2026-10-10). The site asked
// the providers for the rest, and so does this, from the device with the TMDB
// key the app may carry (docs/app-plan.md). A port of the TMDB half of the
// site's src/lib/detail/publicFacetDetail.ts.
//
// Games come from IGDB, whose credentials may not ship, so a tag's or a
// studio's games are asked of the Worker (/v1/facet/games, since 2026-10-15),
// which keeps each answer a week. A person's page has none: IGDB files people
// by company, not by name.

import { personKey } from '@/lib/facets';
import { api, type GameSearchResult, type ProviderResult } from '~/lib/api';
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
  /** Every portrait TMDB holds of them, best voted first: `full` for the gallery, `thumb` for its strip. */
  photos: { full: string; thumb: string; width: number; height: number }[];
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

/** A book or a board game the Worker found, as a card. */
function shelfCard(r: ProviderResult): CardItem {
  return {
    key: `${r.source}:${r.type}:${r.sourceId}`, id: null, source: r.source, sourceId: r.sourceId, type: r.type,
    title: r.title, releaseDate: r.releaseDate, posterUrl: r.posterUrl, communityScore: r.rating, communityVotes: r.votes,
  };
}

const OL = 'https://openlibrary.org';

/**
 * An author as Open Library knows them, for a person TMDB has no record of
 * (most writers). The exact name with the most works wins: Open Library's first
 * hit for "Frank Herbert" is Frank Herbert Hayward (21 works), not the author
 * of Dune (141). Photos are its author covers; -1 means none.
 */
export async function openLibraryAuthor(name: string, signal?: AbortSignal): Promise<FacetPerson | null> {
  const target = name.trim().toLowerCase();
  if (target.length < 2) return null;
  const res = await fetch(`${OL}/search/authors.json?q=${encodeURIComponent(name)}&limit=8&fields=key,name,work_count`, { signal });
  if (!res.ok) return null;
  const docs = ((await res.json())?.docs ?? []) as { key?: string; name?: string; work_count?: number }[];
  const best = docs.filter((d) => d.key && d.name?.trim().toLowerCase() === target).sort((a, b) => (b.work_count ?? 0) - (a.work_count ?? 0))[0];
  if (!best?.key) return null;
  const a = await fetch(`${OL}/authors/${best.key}.json`, { signal }).then((r) => (r.ok ? r.json() : null), () => null);
  if (!a) return null;
  const photos = ((a.photos ?? []) as number[]).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20);
  const bio = typeof a.bio === 'string' ? a.bio : typeof a.bio?.value === 'string' ? a.bio.value : null;
  return {
    name: a.name ?? name,
    biography: bio,
    birthday: typeof a.birth_date === 'string' ? a.birth_date : null,
    deathday: typeof a.death_date === 'string' ? a.death_date : null,
    placeOfBirth: null,
    profileUrl: photos[0] ? `https://covers.openlibrary.org/a/id/${photos[0]}-M.jpg` : null,
    knownFor: 'Writing',
    photos: photos.map((id) => ({ full: `https://covers.openlibrary.org/a/id/${id}-L.jpg`, thumb: `https://covers.openlibrary.org/a/id/${id}-S.jpg`, width: 2, height: 3 })),
  };
}

/** A game the Worker found at IGDB, as a card. */
function gameCard(g: GameSearchResult): CardItem {
  return {
    key: `igdb:game:${g.sourceId}`, id: null, source: 'igdb', sourceId: g.sourceId, type: 'game',
    title: g.title, releaseDate: g.releaseDate, posterUrl: g.posterUrl,
    communityScore: g.rating, communityVotes: g.votes,
  };
}

const unique = (cards: CardItem[]) => {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
};

// ── Person ───────────────────────────────────────────────────────────────────

/** A talk-show appearance or a narration is not part of somebody's body of work. */
const CAST_SELF_RE = /^(self|himself|herself|narrator)\b/i;
/**
 * The crew jobs that make a title somebody's, the same ones the catalog files a
 * person under (src/lib/facets.ts: director, writer, creator). The site took
 * every crew credit, and so did this until 2026-10-11: Ridley Scott's page read
 * "157 titles" under "Director · Writer", most of them films he produced, none
 * of which link back to him from their own page (SM65).
 */
const AUTHOR_JOBS = new Set([
  'Director', 'Creator',
  'Writer', 'Screenplay', 'Story', 'Novel', 'Author', 'Comic Book', 'Teleplay', 'Co-Writer', 'Original Story',
]);

/** Whether a crew credit is one of those jobs. Exported for the test. */
export const isAuthorCredit = (c: { job?: string | null }) => AUTHOR_JOBS.has(c.job || '');

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
  const [meta, credits, images] = await Promise.all([
    tmdb(`/person/${id}`, signal), tmdb(`/person/${id}/combined_credits`, signal),
    // The photos behind the portrait (tap it on the person page). A failure costs the gallery, not the page.
    tmdb(`/person/${id}/images`, signal).catch(() => null),
  ]);
  const cards: CardItem[] = [];
  const take = (c: any) => {
    if (!(c.media_type === 'movie' || c.media_type === 'tv') || c.id == null) return;
    // No votes and no poster is an entry nobody filled in.
    if ((c.vote_count ?? 0) === 0 && !c.poster_path) return;
    cards.push(card(c));
  };
  for (const c of credits?.cast ?? []) if (!CAST_SELF_RE.test(String(c.character ?? ''))) take(c);
  for (const c of credits?.crew ?? []) if (isAuthorCredit(c)) take(c);
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
      photos: ((images?.profiles ?? []) as { file_path?: string; width?: number; height?: number; vote_average?: number }[])
        .filter((p) => p.file_path)
        .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
        .slice(0, 40)
        .map((p) => ({
          full: `https://image.tmdb.org/t/p/h632${p.file_path}`,
          thumb: `https://image.tmdb.org/t/p/w185${p.file_path}`,
          width: p.width ?? 2, height: p.height ?? 3,
        })),
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
  // Books run alongside too (Open Library, 2026-10-17): a subject's, an author's or a publisher's.
  const books = api.facetBooks(kind, label).then((r) => r.results.map(shelfCard), () => [] as CardItem[]);
  // An author TMDB does not know still gets a face and a biography.
  const author = kind === 'person' ? openLibraryAuthor(label, signal).catch(() => null) : Promise.resolve(null);
  if (!tmdbConfigured()) return { cards: unique(await books), person: await author };
  let found: ProviderFacet;
  // The games run alongside TMDB and never fail the page: no games is a shorter list.
  const games = kind === 'person' ? Promise.resolve([] as CardItem[])
    : api.facetGames(kind, label).then((r) => r.results.map(gameCard), () => [] as CardItem[]);
  if (kind === 'person') found = await person(key, signal);
  else if (kind === 'studio') {
    const id = await companyId(label, signal);
    found = { cards: id == null ? [] : await discover(`with_companies=${id}`, signal), person: null };
  } else {
    const filter = await tagFilter(label, signal);
    found = { cards: filter ? await discover(filter, signal) : [], person: null };
  }
  found.cards = unique([...found.cards, ...(await games), ...(await books)]);
  if (kind === 'person' && (!found.person || !found.person.profileUrl)) {
    const ol = await author;
    if (ol) found.person = found.person ? { ...ol, ...Object.fromEntries(Object.entries(found.person).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) } as FacetPerson : ol;
  }
  if (!found.cards.length) return found;
  try {
    const res = await api.lookup(found.cards.slice(0, 2000).map((c) => ({ source: c.source as string, type: c.type, id: c.sourceId as string })));
    const held = new Map(res.found.map((f) => [`${f.source}:${f.type}:${f.id}`, f]));
    found.cards = found.cards.map((c) => {
      const f = held.get(c.key);
      return f ? { ...c, id: f.mediaItemId, slug: f.slug ?? null } : c;
    });
  } catch { /* the cards still open; they just do not know your state */ }
  return found;
}
