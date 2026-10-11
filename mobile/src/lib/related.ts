// The item page's two rails: "More from {franchise}" and "More like this".
// A port of the site's src/lib/detail/relatedRails.ts.
//
// The site built them on its server from the scoring pool. The device holds the
// same pool, so they are built here, with the site's own two rankers imported as
// they are: `franchiseForItem` and `rankSimilar` are pure functions that take
// "which titles carry this facet" as an argument.
//
// What answers that question is an index of the catalog copy: every facet, with
// the titles carrying it. One pass over the catalog, kept until the catalog or
// the taxonomy changes. The first item page opened pays for it.
//
// Not here: titles a franchise has that the catalog does not hold. The site
// kept those in `franchise_members`, which is not in D1 (docs/worker.md).

import type { SQLiteDatabase } from 'expo-sqlite';
import type { DiscoveryVector } from '@/lib/discovery';
import type { Facet } from '@/lib/facets';
import { franchiseForItem } from '@/lib/franchise';
import { rankSimilar } from '@/lib/similarItems';
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
}

/** Index titles by the facets the score reads: after bundles, attaches and detaches. */
export function indexFacets(rows: { id: string; facets: ScoreFacet[] }[], tax: Taxonomy, into?: FacetIndex): FacetIndex {
  const index = into ?? { size: 0, ids: [], byFacet: new Map<string, number[]>() };
  for (const r of rows) {
    const at = index.ids.length;
    index.ids.push(r.id);
    const seen = new Set<string>();
    for (const f of resolveFacets(r.facets, r.id, tax)) {
      const id = facetId(f);
      // A title carrying one facet twice is one title.
      if (seen.has(id)) continue;
      seen.add(id);
      const list = index.byFacet.get(id);
      if (list) list.push(at); else index.byFacet.set(id, [at]);
    }
  }
  index.size = index.ids.length;
  return index;
}

/** The site's rarity weight (discovery.ts, computeIdf): a facet on most titles says little. */
const idfOf = (index: FacetIndex, id: string) => Math.log((index.size + 1) / ((index.byFacet.get(id)?.length ?? 0) + 1));

const idsFor = (index: FacetIndex, f: { kind: string; role?: string; key: string }) =>
  (index.byFacet.get(facetId(f)) ?? []).map((i) => index.ids[i]);

/** The titles any of this title's franchises holds: the ones `pickRelated` needs vectors for. */
export function franchiseCandidateIds(index: FacetIndex, facets: ScoreFacet[]): string[] {
  const out = new Set<string>();
  for (const f of facets) if (f.kind === 'ip') for (const id of idsFor(index, f)) out.add(id);
  return [...out];
}

/**
 * Which titles go in each rail, as ids. `facets` are the title's facets after
 * the taxonomy. `vectors` must hold every id `franchiseCandidateIds` named: the
 * franchise rail is picked by crowd attention and shown newest first, and both
 * are read off the vector.
 */
export function pickRelated(input: { id: string; facets: ScoreFacet[]; index: FacetIndex; vectors: Map<string, ItemVector> }): {
  franchise: { label: string; ids: string[] } | null;
  similar: string[];
} {
  const { id, facets, index, vectors } = input;
  const stub = (vid: string) => (vectors.get(vid) ?? { id: vid }) as unknown as DiscoveryVector;
  const candidates = (f: Facet) => idsFor(index, f).map(stub);

  const franchise = franchiseForItem(id, facets as unknown as Facet[], candidates);
  const inFranchise = new Set(franchise?.items.map((v) => v.id) ?? []);

  const idf = new Map<string, number>();
  for (const f of facets) idf.set(facetId(f), idfOf(index, facetId(f)));
  // ⚠️ Only facets some OTHER title carries are offered to the ranker. It scores
  // a title's eight rarest facets, and the rarest facet there is belongs to this
  // title alone: a bit-part actor, a one-off keyword. Such a facet can find
  // nothing. On the live catalog (2026-10-11) 12,140 of 20,504 facets are like
  // that, and for 1,074 of 4,561 titles they filled all eight places, so the
  // rail was empty: Alien and Severance among them.
  const shared = facets.filter((f) => idsFor(index, f).some((other) => other !== id));
  // Asked for more than the cap, so dropping the franchise's titles still leaves a full rail.
  const similar = rankSimilar(id, shared as unknown as Facet[], idf, candidates, RAIL_CAP + inFranchise.size)
    .map((r) => r.vector.id)
    .filter((vid) => !inFranchise.has(vid))
    .slice(0, RAIL_CAP);

  return {
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
  const rows = await db.getAllAsync<{ id: string; facets: string }>('SELECT id, facets FROM catalog');
  const index: FacetIndex = { size: 0, ids: [], byFacet: new Map() };
  for (let i = 0; i < rows.length; i += PARSE_CHUNK) {
    indexFacets(rows.slice(i, i + PARSE_CHUNK).map((r) => ({ id: r.id, facets: parse(r.facets) })), tax, index);
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
  franchise: { label: string; items: CardItem[] } | null;
  similar: CardItem[];
}

/** Both rails for one title, as cards. `rawFacets` are the title's facets as the catalog holds them. */
export async function relatedRails(db: SQLiteDatabase, revision: number, tax: Taxonomy, id: string, rawFacets: ScoreFacet[]): Promise<RelatedRails> {
  const index = await facetIndex(db, revision, tax);
  const facets = resolveFacets(rawFacets, id, tax);

  const stored = await byId<{ id: string; vector: string }>(db, 'id, vector', franchiseCandidateIds(index, facets));
  const vectors = new Map<string, ItemVector>();
  for (const [vid, row] of stored) {
    try { vectors.set(vid, JSON.parse(row.vector) as ItemVector); } catch { /* a title with an unreadable vector is left out */ }
  }

  const picked = pickRelated({ id, facets, index, vectors });
  const rows = await byId<CatalogRow>(
    db, 'id, type, title, slug, poster_url, release_date, year, community_score, community_votes',
    [...(picked.franchise?.ids ?? []), ...picked.similar],
  );
  const cards = (ids: string[]) => ids.map((cid) => rows.get(cid)).filter((r): r is CatalogRow => !!r).map(toCard);
  return {
    franchise: picked.franchise ? { label: picked.franchise.label, items: cards(picked.franchise.ids) } : null,
    similar: cards(picked.similar),
  };
}
