// The item page's two rails: "More from {franchise}" and "More like this".
// A port of the site's src/lib/detail/relatedRails.ts.
//
// The site built them on its server from the scoring pool. The device holds the
// same pool, so they are built here. The franchise rail is the site's own
// `franchiseForItem`. "More like this" is the app's own since 2026-10-17
// (`rankLike`, below): the site's ranker picked odd titles (Alien got Top Gun).
//
// What answers that question is an index of the catalog copy: every facet, with
// the titles carrying it. One pass over the catalog, kept until the catalog or
// the taxonomy changes. The first item page opened pays for it.
//
// Not here: titles a franchise has that the catalog does not hold. The site
// kept those in `franchise_members`, which is not in D1 (docs/worker.md).

import type { SQLiteDatabase } from 'expo-sqlite';
import { ipDisplayLabel, type Facet } from '@/lib/facets';
import { franchiseForItem } from '@/lib/franchise';
import type { ItemVector } from '~/lib/api';
import type { CardItem } from '~/lib/cards';
import type { CatalogRow } from '~/lib/db';
import { facetId, resolveFacets, type ScoreFacet, type Taxonomy } from '~/lib/fandexScore';

/** How many cards "More like this" holds. The site's RAIL_CAP. */
export const RAIL_CAP = 12;
/** Fewer similar titles than this is not a rail. The site's MIN_SIMILAR. */
export const MIN_SIMILAR = 3;
/** Rows parsed before the thread is handed back, so opening a page does not stall on a phone. */
const PARSE_CHUNK = 250;
const ID_CHUNK = 200;

export interface FacetIndex {
  /** How many titles were indexed: the N in the rarity weight. */
  size: number;
  ids: string[];
  /** facet id → positions in `ids` of the titles carrying it, in catalog order. */
  byFacet: Map<string, number[]>;
  /**
   * A provider's own franchise key (before bundles and hand-made attaches) →
   * the positions of the titles the PROVIDER put in it. What the series rail
   * reads: TMDB's collection is the eight Harry Potter films and nothing else,
   * where the bundled, hand-filled franchise is thirty-eight titles.
   */
  byRawIp: Map<string, number[]>;
  /** Per position: the title's media type, when the row said. */
  types: (string | null)[];
  /** Per position: the crowd's vote count, when the row said. */
  votes: number[];
  /** Per position: each facet the title carries and how much it says about the title (`facetWeight`). */
  facetsOf: { id: string; w: number }[][];
  /** The tag facets that are genres: "More like this" keeps to titles sharing one. */
  genres: Set<string>;
}

/**
 * How much one facet says about what a title is like, before rarity.
 *
 * The site's ranker had no such notion: it scored a title's eight RAREST facets,
 * and the rarest are a bit-part actor or a one-off keyword, so Alien's rail was
 * Saving Private Ryan, Top Gun and Freddy's Dead. Here a director counts for more
 * than a top-billed actor, a top-billed actor for far more than a bit part, and a
 * curated theme or setting for more than a raw keyword. A franchise counts for
 * nothing: it has a rail of its own.
 */
export function facetWeight(f: ScoreFacet, castRank: number, tax: Taxonomy): number {
  if (f.kind === 'ip') return 0;
  if (f.kind === 'tag') {
    const category = tax.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other';
    if (tax.categories.get(category)?.ignored) return 0;
    if (category === 'genre') return 1;
    if (category === 'theme' || category === 'setting' || category === 'mood') return 1.2;
    if (category === 'other') return 0.5;
    return 0.6;
  }
  if (f.kind === 'person') {
    if (f.role === 'director' || f.role === 'creator') return 1.6;
    if (f.role === 'writer') return 0.9;
    // Cast in billing order, as the provider lists it.
    return castRank < 3 ? 0.9 : castRank < 6 ? 0.45 : 0.15;
  }
  // A developer makes the game; a publisher, studio or network mostly pays for it.
  return f.role === 'developer' ? 1 : 0.3;
}

const isGenre = (f: ScoreFacet, tax: Taxonomy) =>
  f.kind === 'tag' && (tax.tagCategoryOverrides.get(f.key) ?? f.category) === 'genre';

/** Each facet once, with its weight; cast ranked in the order given. */
function weighted(facets: ScoreFacet[], tax: Taxonomy): { f: ScoreFacet; id: string; w: number }[] {
  const out: { f: ScoreFacet; id: string; w: number }[] = [];
  const seen = new Set<string>();
  let cast = 0;
  for (const f of facets) {
    const id = facetId(f);
    // A title carrying one facet twice is one title.
    if (seen.has(id)) continue;
    seen.add(id);
    const w = facetWeight(f, f.kind === 'person' && f.role === 'cast' ? cast++ : 0, tax);
    out.push({ f, id, w });
  }
  return out;
}

/** Index titles by the facets the score reads: after bundles, attaches and detaches. */
export function indexFacets(
  rows: { id: string; type?: string; votes?: number; facets: ScoreFacet[] }[], tax: Taxonomy, into?: FacetIndex,
): FacetIndex {
  const index = into ?? { size: 0, ids: [], byFacet: new Map<string, number[]>(), byRawIp: new Map<string, number[]>(), types: [], votes: [], facetsOf: [], genres: new Set<string>() };
  for (const r of rows) {
    const at = index.ids.length;
    index.ids.push(r.id);
    index.types.push(r.type ?? null);
    index.votes.push(r.votes ?? 0);
    const rawIps = new Set<string>();
    for (const f of r.facets) {
      if (f.kind !== 'ip' || !f.key || rawIps.has(f.key)) continue;
      rawIps.add(f.key);
      const carriers = index.byRawIp.get(f.key);
      if (carriers) carriers.push(at); else index.byRawIp.set(f.key, [at]);
    }
    const list: { id: string; w: number }[] = [];
    for (const { f, id, w } of weighted(resolveFacets(r.facets, r.id, tax), tax)) {
      const carriers = index.byFacet.get(id);
      if (carriers) carriers.push(at); else index.byFacet.set(id, [at]);
      if (w > 0) list.push({ id, w });
      if (isGenre(f, tax)) index.genres.add(id);
    }
    index.facetsOf.push(list);
  }
  index.size = index.ids.length;
  return index;
}

/** The site's rarity weight (discovery.ts, computeIdf): a facet on most titles says little. */
const idfOf = (index: FacetIndex, id: string) => Math.log((index.size + 1) / ((index.byFacet.get(id)?.length ?? 0) + 1));

const idsFor = (index: FacetIndex, f: { kind: string; role?: string; key: string }) =>
  (index.byFacet.get(facetId(f)) ?? []).map((i) => index.ids[i]);

/** A facet on more of the catalog than this finds candidates through others; it still counts in the score. */
const BROAD_SHARE = 0.15;
/** A title of another media type is "like" this one at this fraction. */
const OTHER_TYPE = 0.4;

const norms = new WeakMap<FacetIndex, { size: number; norm: Float64Array }>();

/**
 * Each title's length as a vector of facet weight × rarity, over the facets some
 * other title also carries. One no other title carries can match nothing, and
 * counting it would mark down a title for having a long list of one-off keywords.
 */
function normOf(index: FacetIndex): Float64Array {
  const hit = norms.get(index);
  if (hit && hit.size === index.size) return hit.norm;
  const idf = new Map<string, number>();
  const norm = new Float64Array(index.size);
  index.facetsOf.forEach((list, i) => {
    let sum = 0;
    for (const { id, w } of list) {
      if ((index.byFacet.get(id)?.length ?? 0) < 2) continue;
      let v = idf.get(id);
      if (v === undefined) { v = idfOf(index, id); idf.set(id, v); }
      sum += (w * v) ** 2;
    }
    norm[i] = Math.sqrt(sum);
  });
  norms.set(index, { size: index.size, norm });
  return norm;
}

/**
 * "More like this", as ids, best first.
 *
 * Cosine similarity over every facet two titles share, each weighted by what kind
 * of facet it is (`facetWeight`) and by how rare it is. Then three rules a reader
 * would expect: a title that shares no genre with this one is not like it (when
 * this one has a genre); another media type counts for less; and among titles
 * about as alike, the one more people have rated comes first, so a rail is not a
 * list of things nobody has heard of.
 */
export function rankLike(input: { id: string; type?: string; facets: ScoreFacet[]; index: FacetIndex; tax: Taxonomy; limit: number }): string[] {
  const { id, facets, index, tax, limit } = input;
  const self = index.ids.indexOf(id);
  const type = input.type ?? (self >= 0 ? index.types[self] : null);
  const target = new Map<string, number>();
  const genres = new Set<string>();
  let normT = 0;
  for (const { id: fid, w } of weighted(facets, tax)) {
    if (index.genres.has(fid)) genres.add(fid);
    const carriers = index.byFacet.get(fid) ?? [];
    // Only facets some OTHER title carries can say anything about likeness.
    if (w <= 0 || !carriers.some((i) => i !== self)) continue;
    const v = w * idfOf(index, fid);
    target.set(fid, v);
    normT += v * v;
  }
  if (!target.size) return [];
  normT = Math.sqrt(normT);

  const broad = Math.max(50, index.size * BROAD_SHARE);
  const candidates = new Set<number>();
  for (const fid of target.keys()) {
    const carriers = index.byFacet.get(fid) ?? [];
    if (carriers.length > broad) continue;
    for (const i of carriers) if (i !== self) candidates.add(i);
  }

  const norm = normOf(index);
  const scored: { i: number; score: number }[] = [];
  for (const i of candidates) {
    let dot = 0;
    let sharesGenre = genres.size === 0;
    for (const { id: fid, w } of index.facetsOf[i]) {
      const t = target.get(fid);
      if (t !== undefined) dot += t * w * idfOf(index, fid);
      if (!sharesGenre && genres.has(fid)) sharesGenre = true;
    }
    if (dot <= 0 || !sharesGenre || !norm[i]) continue;
    let score = dot / (normT * norm[i]);
    if (type && index.types[i] && index.types[i] !== type) score *= OTHER_TYPE;
    score *= 0.7 + 0.3 * Math.min(1, Math.log10(1 + index.votes[i]) / 4);
    scored.push({ i, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => index.ids[s.i]);
}

/** The titles any of this title's franchises holds, and its provider series: the ones `pickRelated` needs vectors for. */
export function franchiseCandidateIds(index: FacetIndex, facets: ScoreFacet[], rawFacets: ScoreFacet[] = []): string[] {
  const out = new Set<string>();
  for (const f of facets) if (f.kind === 'ip') for (const id of idsFor(index, f)) out.add(id);
  for (const f of rawFacets) if (f.kind === 'ip') for (const i of index.byRawIp.get(f.key) ?? []) out.add(index.ids[i]);
  return [...out];
}

/** How a medium is named in a series rail's title: "Harry Potter books", "Star Wars films". */
const SERIES_PLURAL: Record<string, string> = { movie: 'films', show: 'shows', game: 'games', book: 'books', boardgame: 'board games' };
/** A series rail holds at most this many; a bigger provider series is cut to the best known, oldest first. */
export const SERIES_CAP = 20;

/**
 * The series this title is one of, as its provider says: the other titles of
 * the SAME medium in the same provider franchise, before any bundle or hand-made
 * attach widened it. Oldest first, since a series is read in order.
 *
 * Why (Nils, 2026-10-18): "More from Harry Potter" is thirty-eight titles across
 * four media, and nothing said which were the seven books. TMDB's collection,
 * Open Library's series and IGDB's franchise are each clean on their own; the
 * mixing is Fandex's. So the rail is that one provider set, cut to one medium.
 * Its title names the medium when the series IS the franchise seen through
 * one medium ("Harry Potter books"), and the series when the series sits
 * inside a bigger franchise ("The Dark Knight series", inside Batman).
 */
export function seriesForItem(input: { id: string; type?: string; rawFacets: ScoreFacet[]; franchiseKey: string | null; index: FacetIndex; vectors: Map<string, ItemVector> }): { label: string; ids: string[] } | null {
  const { id, rawFacets, franchiseKey, index, vectors } = input;
  const self = index.ids.indexOf(id);
  const type = input.type ?? (self >= 0 ? index.types[self] : null);
  if (!type) return null;
  let best: { key: string; label: string; ids: string[] } | null = null;
  const seen = new Set<string>();
  for (const f of rawFacets) {
    if (f.kind !== 'ip' || !f.key || seen.has(f.key)) continue;
    seen.add(f.key);
    const ids = (index.byRawIp.get(f.key) ?? []).filter((i) => i !== self && index.types[i] === type).map((i) => index.ids[i]);
    if (!best || ids.length > best.ids.length) best = { key: f.key, label: ipDisplayLabel(f.label || f.key), ids };
  }
  // One other title is a pair the franchise rail already shows; a series starts at three.
  if (!best || best.ids.length < 2) return null;
  const date = (vid: string) => vectors.get(vid)?.releaseDate ?? null;
  const votes = (vid: string) => vectors.get(vid)?.communityVotes ?? 0;
  let ids = best.ids;
  // Select on attention, then show in order: never sort then slice (AGENTS.md).
  if (ids.length > SERIES_CAP) ids = [...ids].sort((a, b) => votes(b) - votes(a)).slice(0, SERIES_CAP);
  ids = [...ids].sort((a, b) => {
    const da = date(a); const db = date(b);
    if (!da && !db) return a.localeCompare(b);
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
  // The provider's key IS the franchise's: this medium's slice of it. Bundled
  // into a bigger one (The Dark Knight into Batman), or beside it: a series.
  const label = best.key === franchiseKey ? `${best.label} ${SERIES_PLURAL[type] ?? type}` : `${best.label} series`;
  return { label, ids };
}

/**
 * Which titles go in each rail, as ids. `facets` are the title's facets after
 * the taxonomy; `rawFacets` the same before it, which the series rail reads.
 * `vectors` must hold every id `franchiseCandidateIds` named: the franchise
 * rail is picked by crowd attention and shown newest first, the series rail
 * oldest first, and both are read off the vector.
 */
export function pickRelated(input: { id: string; type?: string; facets: ScoreFacet[]; rawFacets?: ScoreFacet[]; index: FacetIndex; vectors: Map<string, ItemVector>; tax: Taxonomy }): {
  series: { label: string; ids: string[] } | null;
  franchise: { label: string; ids: string[] } | null;
  similar: string[];
} {
  const { id, type, facets, index, vectors, tax } = input;
  // A title with no vector in hand still has its id, which is all the similarity ranker reads.
  const stub = (vid: string): ItemVector => vectors.get(vid) ?? ({ id: vid, title: '', releaseDate: null, communityVotes: 0, sources: [] } as unknown as ItemVector);
  const candidates = (f: Facet) => idsFor(index, f).map(stub);

  const franchise = franchiseForItem(id, facets as unknown as Facet[], candidates);
  const inFranchise = new Set(franchise?.items.map((v) => v.id) ?? []);

  let series = input.rawFacets ? seriesForItem({ id, type, rawFacets: input.rawFacets, franchiseKey: franchise?.key ?? null, index, vectors }) : null;
  // The same titles twice is one rail: the franchise rail already is the series.
  if (series && franchise && series.ids.length === inFranchise.size && series.ids.every((vid) => inFranchise.has(vid))) series = null;

  // Asked for more than the cap, so dropping the franchise's titles still leaves a full rail.
  const similar = rankLike({ id, type, facets, index, tax, limit: RAIL_CAP + inFranchise.size })
    .filter((vid) => !inFranchise.has(vid))
    .slice(0, RAIL_CAP);

  return {
    series,
    franchise: franchise && franchise.items.length ? { label: franchise.label, ids: franchise.items.map((v) => v.id) } : null,
    similar: similar.length >= MIN_SIMILAR ? similar : [],
  };
}

// ── The device's side: reading the catalog copy ──────────────────────────────

let cached: { db: SQLiteDatabase; revision: number; tax: Taxonomy; index: Promise<FacetIndex> } | null = null;

function parse(json: string): ScoreFacet[] {
  try { return JSON.parse(json) as ScoreFacet[]; } catch { return []; }
}

async function buildIndex(db: SQLiteDatabase, tax: Taxonomy): Promise<FacetIndex> {
  const rows = await db.getAllAsync<{ id: string; type: string; community_votes: number; facets: string }>('SELECT id, type, community_votes, facets FROM catalog');
  const index: FacetIndex = { size: 0, ids: [], byFacet: new Map(), byRawIp: new Map(), types: [], votes: [], facetsOf: [], genres: new Set() };
  for (let i = 0; i < rows.length; i += PARSE_CHUNK) {
    indexFacets(rows.slice(i, i + PARSE_CHUNK).map((r) => ({ id: r.id, type: r.type, votes: r.community_votes ?? 0, facets: parse(r.facets) })), tax, index);
    await new Promise<void>((done) => setTimeout(done, 0));
  }
  return index;
}

/** The index for this catalog copy and taxonomy, built once and shared by every item page. */
export function facetIndex(db: SQLiteDatabase, revision: number, tax: Taxonomy): Promise<FacetIndex> {
  if (!cached || cached.db !== db || cached.revision !== revision || cached.tax !== tax) {
    const index = buildIndex(db, tax);
    cached = { db, revision, tax, index };
    // A failed build must not be the answer for the rest of the session.
    index.catch(() => { if (cached?.index === index) cached = null; });
  }
  return cached.index;
}

async function byId<T extends { id: string }>(db: SQLiteDatabase, columns: string, ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const rows = await db.getAllAsync<T>(`SELECT ${columns} FROM catalog WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

// lib/cards.ts has this as cardFromCatalog. Written out here so this file stays free of the
// hooks that module carries, and can be tested without a device.
const toCard = (r: CatalogRow): CardItem => ({
  key: r.id, id: r.id, type: r.type, title: r.title, slug: r.slug, releaseDate: r.release_date,
  posterUrl: r.poster_url, communityScore: r.community_score, communityVotes: r.community_votes,
});

export interface RelatedRails {
  /** The provider's own series of this medium ("Harry Potter books"), when it differs from the franchise rail. */
  series: { label: string; items: CardItem[] } | null;
  franchise: { label: string; items: CardItem[] } | null;
  similar: CardItem[];
}

/** The rails for one title, as cards. `rawFacets` are the title's facets as the catalog holds them. */
export async function relatedRails(db: SQLiteDatabase, revision: number, tax: Taxonomy, id: string, rawFacets: ScoreFacet[]): Promise<RelatedRails> {
  const index = await facetIndex(db, revision, tax);
  const facets = resolveFacets(rawFacets, id, tax);

  const stored = await byId<{ id: string; vector: string }>(db, 'id, vector', franchiseCandidateIds(index, facets, rawFacets));
  const vectors = new Map<string, ItemVector>();
  for (const [vid, row] of stored) {
    try { vectors.set(vid, JSON.parse(row.vector) as ItemVector); } catch { /* a title with an unreadable vector is left out */ }
  }

  const picked = pickRelated({ id, facets, rawFacets, index, vectors, tax });
  const rows = await byId<CatalogRow>(
    db, 'id, type, title, slug, poster_url, release_date, year, community_score, community_votes',
    [...(picked.series?.ids ?? []), ...(picked.franchise?.ids ?? []), ...picked.similar],
  );
  const cards = (ids: string[]) => ids.map((cid) => rows.get(cid)).filter((r): r is CatalogRow => !!r).map(toCard);
  return {
    series: picked.series ? { label: picked.series.label, items: cards(picked.series.ids) } : null,
    franchise: picked.franchise ? { label: picked.franchise.label, items: cards(picked.franchise.ids) } : null,
    similar: cards(picked.similar),
  };
}
