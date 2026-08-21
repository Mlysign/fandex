// Taste Match — the discovery/recommendation engine that replaces the tag-slider
// "For You". It builds a multi-facet preference profile from the user's ratings
// (tags + people + companies), where facets rated below the user's baseline get
// NEGATIVE weight (so dislikes emerge automatically), refines it with optional
// example-title seeds + manual like/dislike pills, and ranks the WHOLE local
// catalog with explainable reasons — plus extensive filtering and sorting.

import { query, get } from "@/lib/db";
import { BoundedCache } from "@/lib/boundedCache";
import { extractYear } from "@/lib/merge";
import { representativeCommunity, averageCommunity } from "@/lib/ratings";
import { getUserStateMap } from "@/lib/userState";
import { getDerivedForItem, peekDerived, derivedSignature, type Derived, type RawLink } from "@/lib/facetCache";
import { type Facet, facetId, type FacetRole, personKey, companyKey } from "@/lib/facets";
import { getLibraryFacetAnalysis, librarySignature } from "@/lib/libraryAnalysis";
import { getScoringConfig, getTagCategories, getTagCategoryOverrides, scoringConfigSignature, type TagCategoryConfig } from "@/lib/scoringConfig";
import { applyTagAliases, canonicalTagKey, getTagAliases, tagAliasSignature } from "@/lib/tagAlias";
import { applyIpFacets, getIpAliases, getItemIpOverrides, ipAliasSignature, itemIpOverrideSignature } from "@/lib/ipAlias";
import { communityVotes, bayesRating, ratingPrior } from "@/lib/ratingsSort";
import type { ScoringConfigValues } from "@/lib/scoringDefaults";
import type { MediaLink, MediaType } from "@/types";

// ── Tunables ───────────────────────────────────────────────────────
// K_SHRINK (the old raw·count/(count+K) confidence shrink) is gone from HERE —
// buildProfile() now reads its Bayesian equivalent (priorStrength, C) from
// scoringConfig.ts (H5.2). ROLE_WEIGHT stays: liveDiscover.ts's membership-prior
// scoring (a different, non-Fandex-Score signal) still reads it directly.
const TOP_K_FACETS = 8;      // only an item's strongest matches score it (anti facet-dense)
const SEED_BOOST = 1.25;     // example title you like → amplify its (positive) facets
const SEED_PENALTY = 1.25;   // example title you dislike → amplify its (negative) facets
const MANUAL_LIKE = 2.0;     // like pill bump
const MANUAL_DISLIKE = -2.0; // dislike pill bump
export const ROLE_WEIGHT: Record<string, number> = {
  director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
  developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
};

// ── Types ──────────────────────────────────────────────────────────
export interface DiscoveryVector {
  id: string;
  type: MediaType;
  title: string;
  /** The public url address segment, carried so every card built from a vector
   *  links straight to the canonical url instead of through the legacy 308. */
  slug: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  year: number | null;
  communityScore: number | null; // 0-100 representative (one source)
  communityAvg: number | null;   // 0-100 average across all DBs (platform-rating sort)
  communityVotes: number;        // summed vote count across sources (popularity + bayes rating)
  runtimeMinutes: number | null;
  addedAt: number;
  sources: { source: string; sourceId: string }[];
  facets: Facet[];
}

export interface VocabEntry { kind: string; role?: FacetRole; key: string; label: string; count: number }

// H5.2 §3.4: BA/n (the facet's Bayesian average + rated-item count) are
// populated by computeFandexScore's reasons so the expanded "why" view can
// read e.g. "Director — 8.9 avg over 4 titles". Optional: scoreFacets'
// (unchanged, idf-weighted Discover-ranking) reasons don't carry them.
// Q29: `capped` (computeFandexScore only) — this facet matched but lost the
// per-category-cap cut, contribution pinned to 0. scoreFacets' reasons never
// set it (that ranking score has no such cap).
// `contribution` — what actually reached THIS item's score (0 for a capped
// reason, by construction, so `center + Σcontribution === score` stays exact).
// `impact` (T10, 2026-07-29) — the facet's CANONICAL points value from
// facetImpact(): what it adds to ANY item carrying it. Populated by
// computeFandexScore (the Fandex Score reasons, incl. capped ones — a capped
// tag can still show its real worth instead of a flat 0); left undefined by
// scoreFacets' unrelated idf-ranking Reason[] above, which has no use for it.
export interface Reason { kind: string; role?: FacetRole; label: string; category?: string; contribution: number; impact?: number | null; BA?: number; n?: number; capped?: boolean }

export interface MembershipFilter { library?: "include" | "exclude" | "only"; wishlist?: "include" | "exclude" | "only"; rated?: "include" | "exclude" | "only" }

export interface DiscoverFilters {
  types?: MediaType[];
  yearMin?: number; yearMax?: number;
  communityMin?: number; communityMax?: number;
  runtimeMin?: number; runtimeMax?: number;
  sources?: string[];
  membership?: MembershipFilter;
  includeFacets?: { kind: string; role?: FacetRole; key: string }[];
  excludeFacets?: { kind: string; role?: FacetRole; key: string }[];
}

export interface FacetRef { kind: string; role?: FacetRole; key: string; label?: string }
export interface DiscoverRefine {
  seeds?: string[];     // media_item ids you like ("more like this")
  negSeeds?: string[];  // media_item ids you dislike
  likes?: FacetRef[];
  dislikes?: FacetRef[];
}

// Unified sort set (2026-07-19): release date (newest), popularity (vote count),
// rating (Bayesian-damped), and the personalized Fandex Score.
export type SortKey = "releaseDate" | "popularity" | "rating" | "fandexScore";

export interface FindRequest {
  q?: string;            // free-text title query (T5 search)
  refine?: DiscoverRefine;
  filters?: DiscoverFilters;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  excludeIgnored?: boolean;  // T10 feed: drop items the user swiped away
}

// ── Candidate cache (whole catalog, user-independent) ──────────────
const CANDIDATE_TTL_MS = 5 * 60 * 1000;
// `sig` is the CONTENT signature and `memSig` the membership one — they're
// separate so a wishlist/rating write can take getCache()'s incremental path
// instead of forcing a full rebuild (§A). `vocabMap` and `actedIds` exist only
// to make that patch possible: the sorted `vocab` array can't be updated
// in place, and the diff needs last build's membership to compare against.
let _cache: {
  sig: string; memSig: string; actedSig: string; aliasSig: string; at: number;
  vectors: DiscoveryVector[];
  byId: Map<string, DiscoveryVector>;
  vocab: VocabEntry[];
  vocabMap: Map<string, VocabEntry>;
  idf: Map<string, number>;
  rawTagCounts: Map<string, { label: string; count: number }>;
  actedIds: Set<string>;
} | null = null;

// ── The catalog POOL (H2b) ───────────────────────────────────────────────────
//
// Since H2b, media_items is no longer "the library": /discover writes a row for
// every item it returns, so the table is library + recommendIngest's pool +
// everything anyone has browsed past. Everything in this module — the Best-match
// candidate set, Insights, searchTitles, and the IDF weights — means the first
// two and NOT the third. A browsed row is a url target, not a catalog entry.
//
// So the pool is: anything not marked `browsed` (library, synced, ingested),
// UNION anything any user has acted on. The union is what makes promotion
// automatic — wishlist a browsed title and it joins the pool on the next rebuild,
// with no flag to flip and no way for the two to disagree.
//
// NOT filtered on membership alone: recommendIngest deliberately persists unowned
// titles so the recommender has a real pool to rank, and those must stay.
//
// Exported (2026-07-22, PR13) so other pool-scoped reads — the sitemap — use
// the SAME predicate instead of re-deriving it and risking drift.
export const POOL_WHERE = `(mi.browsed = 0 OR mi.id IN (SELECT media_item_id FROM user_item_state))`;

// The signature must be scoped to the pool too, not just the cache it guards.
// A count over ALL of media_items would change on every /discover browse, so
// every browse would invalidate the cache and force a full rebuild — which
// parses the raw_data of the entire catalog, on the request path, for a table
// the browse didn't meaningfully change.
//
// §A (2026-08-02) split this in two. It used to be COUNT + MAX(updated_at) over
// POOL_WHERE, which unions in `user_item_state` — so wishlisting or rating a
// BROWSED title changed the count and forced a full rebuild, even though the
// catalog's content was byte-for-byte identical. Content and membership now
// have separate signatures, and a membership-only change takes the incremental
// path in getCache() instead of a rebuild.
//
// CONTENT: the browsed=0 catalog only. A membership write cannot move this —
// it writes `user_item_state` and never touches `media_items` (only
// upsertMediaItem does, matcher.ts) — which is what lets a promotion take the
// incremental path.
function contentSignature(): string {
  const cat = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM media_items WHERE browsed = 0`
  );
  return `${cat?.n ?? 0}:${cat?.mx ?? 0}`;
}

// CONTENT of the acted-on browsed rows, which are in the pool too and CAN be
// re-synced — `browsed` is set once at creation and never cleared (matcher.ts),
// so an item stays browsed=1 even after a real sync enriches it. That happens
// on the very first sync after you wishlist a browsed title, so it has to be
// caught or the pool serves that item's thin pre-sync facets.
//
// This deliberately is NOT folded into contentSignature(): it's a MAX over a
// SET THAT PROMOTION ITSELF CHANGES, so comparing it unconditionally would
// make every promotion look like a content change and force the very rebuild
// §A exists to avoid. (Measured: with it folded in, the incremental path was
// unreachable — sabotaging the patch changed no test result.) getCache()
// therefore compares it only when membership is unchanged, where it's a
// like-for-like comparison; when membership DID change, the membership branch
// runs first and restamps it.
function actedContentSignature(): string {
  const r = get<{ mx: number }>(
    `SELECT COALESCE(MAX(mi.updated_at),0) mx FROM media_items mi
     WHERE mi.browsed = 1 AND mi.id IN (SELECT media_item_id FROM user_item_state)`
  );
  return `${r?.mx ?? 0}`;
}

// MEMBERSHIP, as a cheap gate. Fetching the acted-on id list on every getCache()
// would put a growing row-scan on the warm path, which is currently ~2 ms; this
// aggregate is O(1)-ish and only differs when `user_item_state` actually
// changed. MAX(rowid) covers inserts, COUNT covers deletes.
function membershipSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(rowid),0) mx FROM user_item_state`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

// The browsed rows some user has acted on — i.e. exactly the items that join or
// leave the pool WITHOUT a content change. Ids only, no blobs.
function actedBrowsedIds(): Set<string> {
  const rows = query<{ id: string }>(
    `SELECT mi.id FROM media_items mi
     WHERE mi.browsed = 1 AND mi.id IN (SELECT media_item_id FROM user_item_state)`
  );
  return new Set(rows.map((r) => r.id));
}

// NOTE: no `raw_data` — pass 1 reads metadata only (see buildCache()).
// `raw_len` is LENGTH(raw_data), not the blob itself: half of facetCache's
// freshness token, and the half that catches a same-second rewrite.
interface VecRow {
  id: string; type: MediaType; title: string; slug: string | null; release_date: string | null; poster_url: string | null;
  created_at: number; source: string | null; source_id: string | null; link_release_date: string | null;
  last_synced: number | null; raw_len: number | null;
}

interface RawDataRow {
  media_item_id: string; source: string; source_id: string;
  release_date: string | null; raw_data: string | null; last_synced: number | null;
}

// SQLite caps host parameters per statement (SQLITE_MAX_VARIABLE_NUMBER). Chunk
// the miss list well under any build's limit rather than assuming the modern
// 32k default.
const MISS_CHUNK = 400;

/** A built vector plus its RAW (pre-alias) facets, which `rawTagCounts` needs. */
interface PoolEntry { vector: DiscoveryVector; rawFacets: Facet[] }

// §A, closed 2026-08-02 — the pool rebuild no longer re-parses the whole catalog,
// and a membership write no longer triggers a rebuild at all.
//
// TWO PASSES, not one. Pass 1 reads metadata + a freshness token
// (`last_synced`, `LENGTH(raw_data)`) with no blobs; `raw_data` is then SELECTed
// in pass 2 for facetCache MISSES ALONE. An unchanged item costs a map lookup —
// no SQL blob read, no JSON.parse, no mergeLinks/extractFacets.
//
// The cache is `facetCache`'s, shared with /api/library, /api/calendar,
// analyzeLibraryFacets and loadMembershipGroups — so the pool warms those and
// vice versa, rather than being a second copy of the same derivation.
//
// `where`/`params` are parameterized so getCache()'s incremental path can build
// entries for JUST the promoted ids through the exact same code — a promoted
// item must be derived identically whether it arrived via a rebuild or a patch.
function buildEntries(where: string, params: unknown[] = []): PoolEntry[] {
  const rows = query<VecRow>(
    `SELECT mi.id, mi.type, mi.title, mi.slug, mi.release_date, mi.poster_url, mi.created_at,
            ml.source, ml.source_id, ml.release_date as link_release_date, ml.last_synced,
            LENGTH(ml.raw_data) as raw_len
     FROM media_items mi
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id
     WHERE ${where}`,
    params
  );

  const groups = new Map<string, { row: VecRow; links: RawLink[]; maxSynced: number; rawLen: number }>();
  for (const r of rows) {
    let g = groups.get(r.id);
    if (!g) { g = { row: r, links: [], maxSynced: 0, rawLen: 0 }; groups.set(r.id, g); }
    if (r.source) {
      g.links.push({
        source: r.source as MediaLink["source"], sourceId: r.source_id!,
        releaseDate: r.link_release_date, rawData: null, lastSynced: r.last_synced ?? 0,
      });
      g.maxSynced = Math.max(g.maxSynced, r.last_synced ?? 0);
      g.rawLen += r.raw_len ?? 0;
    }
  }

  // Pass 1: what's already derived? `peekDerived` needs no raw_data.
  // The config signature is constant across the whole rebuild but costs
  // 0.061 ms a call — recomputing it per item was ~307 ms of a cold rebuild.
  const sig = derivedSignature();
  const derivedById = new Map<string, Derived>();
  const missIds: string[] = [];
  for (const [id, g] of groups) {
    const hit = peekDerived(id, g.maxSynced, g.rawLen, undefined, sig);
    if (hit) derivedById.set(id, hit);
    else missIds.push(id);
  }

  // Pass 2: raw_data for misses only.
  if (missIds.length) {
    const rawByItem = new Map<string, RawDataRow[]>();
    // Chunked `IN (?,?,…)` is much cheaper than a full scan for a handful of
    // misses and much MORE expensive when nearly everything misses — measured
    // on the real 2,531-item pool: a cold rebuild (every item a miss) went
    // 473 ms -> 989 ms on the chunked path alone, while the bulk join stayed
    // flat. So pick per rebuild. Cold start and a projection-version bump take
    // the bulk path; the membership write this whole fix targets takes the
    // chunked one, where the miss list is one item.
    const bulk = missIds.length > groups.size / 2;
    const rd = bulk
      ? query<RawDataRow>(
          `SELECT ml.media_item_id, ml.source, ml.source_id, ml.release_date, ml.raw_data, ml.last_synced
           FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id
           WHERE ${where}`,
          params
        )
      : [];
    for (const r of rd) {
      const list = rawByItem.get(r.media_item_id);
      if (list) list.push(r); else rawByItem.set(r.media_item_id, [r]);
    }
    for (let i = 0; !bulk && i < missIds.length; i += MISS_CHUNK) {
      const chunk = missIds.slice(i, i + MISS_CHUNK);
      const part = query<RawDataRow>(
        `SELECT media_item_id, source, source_id, release_date, raw_data, last_synced
         FROM media_links WHERE media_item_id IN (${chunk.map(() => "?").join(",")})`,
        chunk
      );
      for (const r of part) {
        const list = rawByItem.get(r.media_item_id);
        if (list) list.push(r); else rawByItem.set(r.media_item_id, [r]);
      }
    }
    for (const id of missIds) {
      const g = groups.get(id)!;
      const rawLinks: RawLink[] = (rawByItem.get(id) ?? []).map((r) => ({
        source: r.source as MediaLink["source"], sourceId: r.source_id,
        releaseDate: r.release_date, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
      }));
      // getDerivedForItem populates the shared cache as a side effect.
      derivedById.set(id, getDerivedForItem(id, rawLinks, g.row.type, undefined, sig));
    }
  }

  // H5.6: canonicalize tag facets once per build so bundled spellings collapse
  // into one vocab entry (summed count) and itemsWithFacet(canonical) returns
  // items carrying any member spelling.
  const aliases = getTagAliases();
  // 2026-08-14: the franchise layer resolves here too, and unlike tags it also
  // needs the item id — an item_ip_override attaches or detaches a franchise on
  // ONE item. Both maps are fetched once for the whole build rather than
  // per-item, matching how `aliases` is threaded below.
  const ipAliases = getIpAliases();
  const ipOverrides = getItemIpOverrides();
  const entries: PoolEntry[] = [];
  for (const [id, { row, links }] of groups) {
    // Both come from facetCache — `facets` there is always RAW extractFacets
    // output (that cache deliberately doesn't bake in alias/override
    // resolution), so the applyTagAliases step below is unchanged.
    const { merged, facets: rawFacets } = derivedById.get(id)!;
    const facets = applyIpFacets(applyTagAliases(rawFacets, aliases), id, {
      aliases: ipAliases, overrides: ipOverrides,
    });
    entries.push({
      rawFacets,
      vector: {
        id: row.id, type: row.type,
        slug: row.slug ?? null,
        title: row.title ?? merged.title,
        posterUrl: row.poster_url ?? merged.posterUrl,
        backdropUrl: merged.backdropUrl,
        releaseDate: row.release_date ?? merged.releaseDate,
        year: extractYear(row.release_date ?? merged.releaseDate),
        communityScore: representativeCommunity(merged.communityRatings),
        communityAvg: averageCommunity(merged.communityRatings),
        communityVotes: communityVotes(merged.communityRatings),
        runtimeMinutes: merged.runtimeMinutes,
        addedAt: row.created_at ?? 0,
        sources: links.map((l) => ({ source: l.source, sourceId: l.sourceId })),
        facets,
      },
    });
  }
  return entries;
}

/**
 * Folds one entry's facets into the vocab counters. The full rebuild calls this
 * for every entry; the incremental path calls it for the promoted ones only,
 * which is why it has to be a shared function rather than an inlined loop —
 * a patched pool must end up with the same counts a rebuild would produce.
 */
function foldEntry(
  entry: PoolEntry,
  vocabMap: Map<string, VocabEntry>,
  // 2026-07-29 (T6, tag admin table): the tag table's aka chips want each alias
  // MEMBER's own pre-fold count/label (e.g. "rpg (42)"), which vocabMap can't
  // answer since it's built from the POST-alias facets. Keyed by raw tag key
  // (tags have no role, so the key alone is the identity — see facets.ts).
  rawTagCounts: Map<string, { label: string; count: number }>
) {
  for (const f of entry.vector.facets) {
    const fid = facetId(f);
    const v = vocabMap.get(fid);
    if (v) v.count++;
    else vocabMap.set(fid, { kind: f.kind, role: f.role, key: f.key, label: f.label, count: 1 });
  }
  for (const f of entry.rawFacets) {
    if (f.kind !== "tag") continue;
    const r = rawTagCounts.get(f.key);
    if (r) r.count++;
    else rawTagCounts.set(f.key, { label: f.label, count: 1 });
  }
}

// IDF: a facet on most items (Singleplayer, Action) is a weak signal; a rare
// one (steampunk, a specific director) is a strong, distinctive match. This is
// what stops generic high-frequency genres from dominating recommendations.
// Recomputed whole after an incremental patch: N moves when the pool grows, so
// every entry's weight shifts slightly. It's a map walk with no parsing (~2 ms).
function computeIdf(vocabMap: Map<string, VocabEntry>, poolSize: number): Map<string, number> {
  const N = poolSize || 1;
  const idf = new Map<string, number>();
  for (const [id, e] of vocabMap.entries()) idf.set(id, Math.log((N + 1) / (e.count + 1)));
  return idf;
}

const sortVocab = (vocabMap: Map<string, VocabEntry>) =>
  [...vocabMap.values()].sort((a, b) => b.count - a.count);

function buildCache() {
  const entries = buildEntries(POOL_WHERE);
  const vectors = entries.map((e) => e.vector);
  const vocabMap = new Map<string, VocabEntry>();
  const rawTagCounts = new Map<string, { label: string; count: number }>();
  for (const e of entries) foldEntry(e, vocabMap, rawTagCounts);
  return {
    vectors,
    byId: new Map(vectors.map((v) => [v.id, v])),
    vocab: sortVocab(vocabMap),
    vocabMap,
    idf: computeIdf(vocabMap, vectors.length),
    rawTagCounts,
    actedIds: actedBrowsedIds(),
  };
}

function rebuild(sig: string, memSig: string, aliasSig: string) {
  _cache = { sig, memSig, aliasSig, actedSig: actedContentSignature(), at: Date.now(), ...buildCache() };
  return _cache;
}

// How many promotions are worth patching in. Past this a rebuild is simpler and
// not much slower, and it bounds how far a patch bug could ever propagate.
const MAX_INCREMENTAL_ADDS = 50;

function getCache() {
  const sig = contentSignature();
  // H5.6: a bundle edit doesn't change the catalog, so guard on the alias
  // signature too — otherwise bundled vocab/vectors would stay stale until the
  // 5-min TTL expired.
  //
  // 2026-08-21: the two IP signatures belong here for the same reason and were
  // missing, so bundling a franchise in /dev/scoring did nothing visible for up
  // to five minutes. buildEntries() resolves ip aliases + item overrides into
  // the cached vectors, so a bundle edit changes what this cache should hold
  // while changing nothing it was watching.
  //
  // The window was worse than "stale", it was INCONSISTENT — exactly what the
  // warning at the top of ipAlias.ts is about. An item outside the pool has its
  // facets derived per request and resolved fresh, so its ip key was already
  // canonical while every pool vector still carried the pre-bundle key: the
  // franchise rail on such an item matched only titles whose ORIGINAL key
  // happened to equal the new canonical one. Nils bundled the Spider-Man
  // franchises and the rail showed exactly one film.
  const aliasSig = `${tagAliasSignature()}|${ipAliasSignature()}|${itemIpOverrideSignature()}`;
  if (!_cache || _cache.sig !== sig || _cache.aliasSig !== aliasSig || Date.now() - _cache.at >= CANDIDATE_TTL_MS) {
    return rebuild(sig, membershipSignature(), aliasSig);
  }

  // Catalog content is unchanged. Membership might not be — and a membership
  // change is the ONLY thing that can alter the pool without altering catalog
  // content, which is the whole point of §A. Cheap aggregate first; the id list
  // only when it moved.
  const memSig = membershipSignature();
  if (memSig === _cache.memSig) {
    // Membership stable, so the acted-on browsed set is stable, so its content
    // MAX is a like-for-like comparison — this is where a re-sync of an already
    // promoted item gets caught. (Checked AFTER memSig on purpose: promotion
    // moves both, and the membership branch must win.)
    const actedSig = actedContentSignature();
    if (actedSig !== _cache.actedSig) return rebuild(sig, memSig, aliasSig);
    return _cache;
  }

  const acted = actedBrowsedIds();
  const added: string[] = [];
  for (const id of acted) if (!_cache.actedIds.has(id)) added.push(id);
  let removed = 0;
  for (const id of _cache.actedIds) if (!acted.has(id)) removed++;

  // `user_item_state` changed but pool membership didn't (rating something you
  // already own, say — it was in the pool via browsed=0 all along).
  if (!added.length && !removed) {
    _cache.memSig = memSig; _cache.actedIds = acted; _cache.actedSig = actedContentSignature();
    return _cache;
  }

  // A removal needs the departing item's RAW facets to un-count its vocab and
  // rawTagCounts contribution exactly, and the vector only carries POST-alias
  // facets. Re-deriving them to save one rebuild isn't worth the second code
  // path, so demotion — the rare direction — just rebuilds.
  if (removed || added.length > MAX_INCREMENTAL_ADDS) return rebuild(sig, memSig, aliasSig);

  const entries = buildEntries(`mi.id IN (${added.map(() => "?").join(",")})`, added);

  // SELF-CHECK. This is what makes patching safe rather than a silent-failure
  // risk: if the patched pool doesn't match what SQL says the pool is, throw the
  // patch away and rebuild. A wrong patch costs one rebuild, never a wrong pool.
  const poolCount = get<{ n: number }>(`SELECT COUNT(*) n FROM media_items mi WHERE ${POOL_WHERE}`)?.n ?? -1;
  if (entries.length !== added.length || _cache.vectors.length + entries.length !== poolCount) {
    return rebuild(sig, memSig, aliasSig);
  }

  for (const e of entries) {
    _cache.vectors.push(e.vector);
    _cache.byId.set(e.vector.id, e.vector);
    foldEntry(e, _cache.vocabMap, _cache.rawTagCounts);
  }
  _cache.vocab = sortVocab(_cache.vocabMap);
  _cache.idf = computeIdf(_cache.vocabMap, _cache.vectors.length);
  _cache.actedIds = acted;
  _cache.memSig = memSig;
  // Restamped here, not compared: the promoted rows just joined the acted set,
  // so the pre-patch value was computed over a different set.
  _cache.actedSig = actedContentSignature();
  // `at` deliberately NOT refreshed — the TTL measures staleness against the
  // last full build, so a stream of promotions can't hold a stale pool open
  // indefinitely.
  return _cache;
}

// Public: invalidate after a fetch-more ingest so new items appear immediately.
export function invalidateDiscoveryCache() { _cache = null; }

// The catalog-wide IDF map (facetId → rarity weight). Exposed so the live
// discover feed can score off-catalog (upcoming) items with the same rarity
// signal; facets unseen in the catalog fall back to idf 1 at the call site.
export function getCatalogIdf(): Map<string, number> { return getCache().idf; }

// H5.4 — the taxonomy editor's tag-triage view: every tag in the catalog
// vocab, sorted by frequency (already the vocab's sort order). Not filtered by
// category here — the caller (the vocab API route) decides what to show.
export function getTagVocab(): VocabEntry[] { return getCache().vocab.filter((v) => v.kind === "tag"); }

// T6 (2026-07-29) — pre-alias-fold per-key tag counts, for the tag admin
// table's aka chips (e.g. "rpg (42)" as a member of "role playing (rpg)").
// getTagVocab() can't answer this: its counts are POST-fold, so an alias
// member never gets its own row there.
export function getRawTagCounts(): Map<string, { label: string; count: number }> { return getCache().rawTagCounts; }

// 2026-07-29 — the FULL persisted facets for one catalog item (credits,
// keywords, studios), by media_items uuid. This is the same array runDiscovery
// scores, exposed so the live-provider paths in liveDiscover.ts can score an
// already-ingested item off its real facets instead of the provider list
// payload's genres-only view. Returns null for an item not in the catalog.
// See liveDiscover.ts's `catalogFacets` for why this matters post-T2.
export function getCatalogFacets(mediaItemId: string): Facet[] | null {
  return getCache().byId.get(mediaItemId)?.facets ?? null;
}

// Q25 (2026-07-19) — same "recover the real label from the catalog" trick as
// getTagVocab (Q11), for companies. companyKey() strips trailing legal/role
// tokens ("Focus Entertainment" -> "focus"), and a public /studio/<slug> URL
// carries only that lossy key — searching providers with it directly matched
// the wrong company (Focus Features, a different studio, beat "focus" out).
export function getCompanyVocab(): VocabEntry[] { return getCache().vocab.filter((v) => v.kind === "company"); }

// ── Preference profile ────────────────────────────────────────────
// meta's classWeight/BA/n are set for every real (rated-library) facet — H5.2
// adds them for computeFandexScore's aggregate + explainability. Facets
// injected by applyRefinements (seeds/manual pills) have no library stats
// behind them, so those three stay undefined; computeFandexScore treats a
// facet with no classWeight as unscored (see its `meta?.classWeight` guard).
export interface Profile {
  w: Map<string, number>;
  meta: Map<string, { kind: string; role?: FacetRole; key: string; label: string; category?: string; classWeight?: number; BA?: number; n?: number }>;
  baseline: number;
  hasSignal: boolean;
  ratedItemCount: number;
}

// H5.3 §8 cold-start: below this many rated items, computeFandexScore refuses
// to show a number at all rather than a misleading one built on 1-2 samples.
// Deliberately NOT folded into `hasSignal` (which stays "at least one facet",
// unchanged since before H5) — hasSignal also gates Discover's "match" sort
// fallback, and raising that bar would change existing ranking behavior for
// sparse profiles as a side effect of a scoring-display decision.
export const MIN_RATED_FOR_FANDEX_SCORE = 3;

// Per-user; sig-invalidated on read. Capped so many distinct users can't grow it
// without bound (single-instance, P2).
const _profileCache = new BoundedCache<string, { sig: string; profile: Profile }>({ max: 500 });

// H5.2: the Bayesian shrinkage average (§3.1) — replaces the old
// `raw · count/(count+K)` shortcut with a textbook Bayesian average, shrunk
// toward the user's OWN rating baseline (D4) rather than a global one. This is
// what makes a facet seen once get pulled most of the way back to baseline
// until real evidence accumulates, and what makes dislikes (dev_f < 0) emerge
// with no special-casing.
//
// Weight class (§3.2): tags resolve their EFFECTIVE category as
// `tag_category_override[key] ?? f.category` (D6 — a backend reassignment
// from the taxonomy editor wins over categorizeTag()'s code heuristic), then
// read that category's weight from tag_category and are DROPPED entirely
// (not just zero-weighted) when it's ignored — meta/noise today, anything else
// someone buckets that way via the taxonomy editor (H5.4). `meta.category`
// stores the EFFECTIVE id too, so the breakdown UI's color/label matches what
// was actually scored, not the pre-reassignment category. People/company
// roles keep reading roleWeights (still the ROLE_WEIGHT literal's values, now
// DB-backed via scoring_config).
//
// `overrides` (H5.4): the /dev/scoring live preview needs to score against
// DRAFT (unsaved) weights without touching the DB or the shared cache — pass
// `config`/`categoryWeights` to bypass getScoringConfig()/getTagCategories()
// for just those fields, layered onto everything else that's still real
// (the user's actual rated facets, tag_category_override, category
// id/label/color). Providing overrides always skips the profile cache: its
// key is userId+librarySignature only, which can't distinguish a draft call
// from a real one, so caching a draft result would leak into every other read.
export interface ProfileOverrides {
  config?: ScoringConfigValues;
  categoryWeights?: Map<string, { weight: number; ignored: boolean }>;
}

export function buildProfile(userId: string, overrides?: ProfileOverrides): Profile {
  const sig = `${librarySignature(userId)}|${scoringConfigSignature()}`;
  if (!overrides) {
    const cached = _profileCache.get(userId);
    if (cached && cached.sig === sig) return cached.profile;
  }

  const a = getLibraryFacetAnalysis(userId);
  const cfg = overrides?.config ?? getScoringConfig();
  const tagOverrides = getTagCategoryOverrides();
  const categoryById = new Map<string, TagCategoryConfig>(
    getTagCategories().map((c) => {
      const w = overrides?.categoryWeights?.get(c.id);
      return [c.id, w ? { ...c, weight: w.weight, ignored: w.ignored } : c];
    })
  );

  const w = new Map<string, number>();
  const meta = new Map<string, { kind: string; role?: FacetRole; key: string; label: string; category?: string; classWeight?: number; BA?: number; n?: number }>();
  for (const f of a.facets) {
    const id = `${f.kind}|${f.role ?? ""}|${f.key}`;

    let classWeight: number;
    let effectiveCategory = f.category;
    if (f.kind === "tag") {
      effectiveCategory = tagOverrides.get(f.key) ?? f.category ?? "other";
      const cat = categoryById.get(effectiveCategory);
      if (cat?.ignored || cat?.weight === 0) continue;
      classWeight = cat?.weight ?? 1;
    } else {
      classWeight = cfg.roleWeights[f.role ?? "tag"] ?? 1;
    }

    // Q30: from the prominence-weighted accumulators (identical to
    // weightedSum/weightedCount == sum/count for every non-cast facet) — a
    // lead-role rating counts closer to a full data point toward this
    // person's Bayesian average, a cameo closer to CAST_PROMINENCE_FLOOR.
    // `n` stays the plain rated-title count for the breakdown's "N titles" text.
    const BA = (cfg.priorStrength * a.baseline + f.weightedSum) / (cfg.priorStrength + f.weightedCount);
    const dev = BA - a.baseline;

    w.set(id, dev * classWeight);
    meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: effectiveCategory, classWeight, BA, n: f.count });
  }
  const profile: Profile = { w, meta, baseline: a.baseline, hasSignal: w.size > 0, ratedItemCount: a.ratedItemCount };
  if (!overrides) _profileCache.set(userId, { sig, profile });
  return profile;
}

// Clone + inject seeds / manual pills (per request — never mutate the cache).
function applyRefinements(profile: Profile, refine: DiscoverRefine | undefined, byId: Map<string, DiscoveryVector>): Profile {
  const w = new Map(profile.w);
  const meta = new Map(profile.meta);
  if (!refine) return { ...profile, w, meta };

  const noteMeta = (f: Facet) => {
    const id = facetId(f);
    if (!meta.has(id)) meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: f.category });
    return id;
  };

  for (const seedId of refine.seeds ?? []) {
    const v = byId.get(seedId);
    if (!v) continue;
    for (const f of v.facets) {
      const id = noteMeta(f);
      const base = w.get(id) ?? 0;
      w.set(id, Math.max(base, 0) * SEED_BOOST + (base <= 0 ? 1.0 : 0));
    }
  }
  for (const seedId of refine.negSeeds ?? []) {
    const v = byId.get(seedId);
    if (!v) continue;
    for (const f of v.facets) {
      const id = noteMeta(f);
      const base = w.get(id) ?? 0;
      w.set(id, Math.min(base, 0) * SEED_PENALTY + (base >= 0 ? -1.0 : 0));
    }
  }
  for (const l of refine.likes ?? []) {
    const id = `${l.kind}|${l.role ?? ""}|${l.key}`;
    w.set(id, (w.get(id) ?? 0) + MANUAL_LIKE);
    if (!meta.has(id)) meta.set(id, { kind: l.kind, role: l.role, key: l.key, label: l.label ?? l.key });
  }
  for (const d of refine.dislikes ?? []) {
    const id = `${d.kind}|${d.role ?? ""}|${d.key}`;
    w.set(id, (w.get(id) ?? 0) + MANUAL_DISLIKE);
    if (!meta.has(id)) meta.set(id, { kind: d.kind, role: d.role, key: d.key, label: d.label ?? d.key });
  }

  const hasSignal = [...w.values()].some((x) => x !== 0);
  return { w, meta, baseline: profile.baseline, hasSignal, ratedItemCount: profile.ratedItemCount };
}

// ── Scoring ────────────────────────────────────────────────────────
// Each matched facet contributes (user taste weight) × (catalog rarity / idf),
// so a shared distinctive facet outweighs several generic ones. Works off a bare
// facet list so it scores both catalog vectors and live (upcoming) candidates.
export function scoreFacets(facets: Facet[], w: Map<string, number>, idf: Map<string, number>): { score: number; reasons: Reason[] } | null {
  const contribs: { f: Facet; w: number }[] = [];
  for (const f of facets) {
    const id = facetId(f);
    const weight = w.get(id);
    if (weight == null) continue;
    const eff = weight * (idf.get(id) ?? 1);
    if (eff) contribs.push({ f, w: eff });
  }
  if (!contribs.length) return null;
  contribs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const kept = contribs.slice(0, TOP_K_FACETS);
  const sum = kept.reduce((acc, c) => acc + c.w, 0);
  const score = sum / Math.sqrt(Math.max(kept.length, 1));
  const reasons: Reason[] = kept
    .sort((a, b) => b.w - a.w)
    .map((c) => ({ kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category, contribution: Math.round(c.w * 100) / 100 }));
  return { score: Math.round(score * 1000) / 1000, reasons };
}

// ── Fandex Score (H5.2, §3.3) ───────────────────────────────────────
// The VISIBLE per-item taste-match number (0-100) — a different computation
// from scoreFacets' idf-weighted ranking score above, which stays exactly as
// it was and keeps driving Discover's "match" sort (D2: idf may remain a
// sort signal, never in the shown number). Takes only `facets` + the rated
// profile, so §4's hard exclusions (community rating, browsed/popularity,
// release date) hold structurally — this function has no parameter to leak
// them through even by mistake.
export interface FandexScoreResult { score: number; center: number; reasons: Reason[] }

// S11 (2026-07-27) — the center is a pure function of the profile (baseline*10,
// same rounding computeFandexScore uses), with NO dependency on any item's
// facets — unlike computeFandexScore, which returns null when an item shares
// no facets with the profile. Lets a caller show/attach the center even for a
// response that has no single "current item" (e.g. a facet page's one shared
// per-request value) without needing a dummy facets array.
export function fandexCenterFor(profile: Profile): number | null {
  if (!profile.hasSignal || profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  return Math.round(profile.baseline * 10 * 10) / 10;
}

// T10 (2026-07-29) — THE canonical per-facet score impact: the points a facet
// (almost always a tag) adds to ANY item carrying it, independent of which
// other facets that item happens to have. Before this, two call sites each
// hand-rolled their own version and quietly disagreed: /api/facet/mine's
// tagImpact computed `gain * (BA - baseline)`, dropping the category
// classWeight multiplication computeFandexScore's own reasons[].contribution
// always included. Every category in the live DB happens to have weight 1
// today, which is exactly why nobody noticed — the two formulas only diverge
// once an admin sets a category weight != 1 in the Weights panel.
//
// Why this is safe to compute WITHOUT a specific item's facets: buildProfile
// already stores `profile.w.get(id) === dev * classWeight` per facet (see
// its `w.set(id, dev * classWeight)` line) — classWeight there is the
// facet's OWN category/role weight, with no per-occurrence adjustment
// (prominence, the cast lead-vs-cameo scaling) baked in. So for a tag this
// is exactly the same number computeFandexScore uses; for a person/company
// it's the canonical (prominence == 1, i.e. lead-billed) value, since actual
// per-item prominence isn't known outside a specific item's facets.
export function facetImpact(id: string, profile: Profile, config?: ScoringConfigValues): number | null {
  const w = profile.w.get(id);
  if (w == null) return null;
  const cfg = config ?? getScoringConfig();
  const gain = w >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  return Math.round(gain * w * 10) / 10;
}

interface FandexContrib { f: Facet; dev: number; classWeight: number; BA?: number; n?: number }

// `configOverride` (H5.4 live preview): use the draft mappingConstant/top-N
// selection instead of the persisted ones — pass the SAME override object
// given to buildProfile so K/selection and the role/category weights that
// produced `profile` stay consistent with each other.
export function computeFandexScore(
  facets: Facet[],
  profile: Profile,
  configOverride?: ScoringConfigValues,
  opts?: { mediaItemId?: string | null }
): FandexScoreResult | null {
  if (!profile.hasSignal || profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  const cfg = configOverride ?? getScoringConfig();

  // 2026-08-14 — franchise resolution happens HERE, not at the nine
  // extractFacets() call sites, because this is the one function every scoring
  // surface funnels through. The profile learned its ip facets under canonical
  // keys (analyzeLibraryFacets/buildCache resolve them), so an unresolved item
  // key would simply fail to match `profile.w` and the franchise would vanish
  // from the score with nothing to show for it — which is precisely how tag
  // bundling drifted on the four per-item paths.
  //
  // No id means a live candidate with no catalog row: it can't have a per-item
  // override, but its provider-supplied franchise still gets aliased.
  const resolved = applyIpFacets(facets, opts?.mediaItemId);

  const matched: FandexContrib[] = [];
  for (const f of resolved) {
    const id = facetId(f);
    const w = profile.w.get(id);
    const meta = profile.meta.get(id);
    if (w == null || !meta?.classWeight) continue;
    // Q30: `dev` recovers from `w` using the profile's BUILD-time classWeight
    // (the same value `w` was computed with) — but the classWeight carried
    // FORWARD into this item's weighted mean is scaled by THIS item's own
    // cast prominence (f.prominence), so the same actor counts more here if
    // they're the lead in THIS title than if they were a cameo. Absent/1 for
    // every non-cast facet.
    const classWeight = meta.classWeight * (f.prominence ?? 1);
    matched.push({ f, dev: w / meta.classWeight, classWeight, BA: meta.BA, n: meta.n });
  }
  if (!matched.length) return null;

  // 2026-07-29: fixed-size top-N selection, replacing the per-category cap.
  // The aggregate below is now a RAW SUM, not a mean — with no divisor, a
  // tag's contribution is `gain · dev · classWeight`, independent of every
  // OTHER facet on the item (the whole point: it's printable on a chip and
  // means the same thing everywhere). But an unbounded sum over an unbounded
  // facet count would let a 300-tag item swamp a 5-tag one, so instead of
  // capping tags per-category we cap by SIGN across the whole item — the
  // user's framing: "an item with 5 genre tags should count all 5", which a
  // per-category cap of 3 forbade.
  const tags = matched.filter((c) => c.f.kind === "tag");
  const people = matched.filter((c) => c.f.kind === "person");
  const companies = matched.filter((c) => c.f.kind === "company");
  const ips = matched.filter((c) => c.f.kind === "ip");

  const tagsPositive = tags.filter((c) => c.dev > 0).sort((a, b) => b.dev - a.dev);
  const tagsNegative = tags.filter((c) => c.dev < 0).sort((a, b) => a.dev - b.dev); // most negative first
  const peopleSorted = [...people].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
  const companiesSorted = [...companies].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
  // Signed like people/companies, not split by sign like tags: a franchise you
  // rate BELOW your average should pull the next entry down just as hard.
  const ipsSorted = [...ips].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));

  const kept: FandexContrib[] = [
    ...tagsPositive.slice(0, cfg.topTagsPositive),
    ...tagsNegative.slice(0, cfg.topTagsNegative),
    ...peopleSorted.slice(0, cfg.topPeople),
    ...companiesSorted.slice(0, cfg.topCompanies),
    ...ipsSorted.slice(0, cfg.topIps),
  ];
  // Q29 (2026-07-19): facets beyond the selection used to just vanish — no
  // trace in the breakdown, so "why isn't this counted" had no visible
  // answer. Tracked separately (not added to `kept`, so the score math is
  // untouched) and rendered grayed-out with contribution pinned to 0 below.
  // A tag with dev === 0 belongs to neither the positive nor negative bucket
  // and lands here too — it would contribute nothing either way.
  const capped: FandexContrib[] = [
    ...tagsPositive.slice(cfg.topTagsPositive),
    ...tagsNegative.slice(cfg.topTagsNegative),
    ...peopleSorted.slice(cfg.topPeople),
    ...companiesSorted.slice(cfg.topCompanies),
    ...ipsSorted.slice(cfg.topIps),
    ...tags.filter((c) => c.dev === 0),
  ];
  if (!kept.length) return null;

  // Raw sum — NOT divided by totalWeight (that division is what made a mean
  // out of it, and what made per-tag contribution item-dependent).
  const rawSum = kept.reduce((acc, c) => acc + c.dev * c.classWeight, 0);

  // Q19 (2026-07-19): center on the user's OWN mean rating (matching what
  // Insights shows as "your average"), not a fixed 50 — a fixed center meant
  // ~half of any library scored below 50 by construction ("you won't like
  // most things"). The center is derived, never an admin knob. Positive
  // deviations (above-your-average items) and negative ones (below-average)
  // get separately tunable gains (K_up / K_down) so the visible range can be
  // skewed toward enthusiasm without an asymmetric center.
  const center = profile.baseline * 10; // baseline is 0-10 (mean personal rating) → 0-100
  const gain = rawSum >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  // 2026-07-29: deliberately UNBOUNDED — no Math.max/Math.min clamp. Clamping
  // required a compensating `scale` factor on every reason's contribution to
  // keep the breakdown additive (see history for the old formula); removing
  // the clamp removes the need for it, so `center + Σ contribution` is now
  // EXACTLY `score`, not just approximately.
  const score = center + gain * rawSum;

  const reasons: Reason[] = kept
    .sort((a, b) => b.dev * b.classWeight - a.dev * a.classWeight)
    .map((c) => ({
      kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category,
      contribution: Math.round(gain * c.dev * c.classWeight * 10) / 10,
      impact: facetImpact(facetId(c.f), profile, cfg),
      BA: c.BA, n: c.n,
    }));

  // Q29 — appended after the real contributors, contribution fixed at 0 (so
  // the additive sum is unaffected), flagged `capped` for the client to
  // render grayed-out with a "not counted for this title" note. `impact`
  // (T10) is still populated for these — the client can show the tag's real
  // canonical worth instead of the flat 0 `contribution` implies.
  for (const c of capped.sort((a, b) => Math.abs(b.dev * b.classWeight) - Math.abs(a.dev * a.classWeight))) {
    reasons.push({
      kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category, contribution: 0,
      impact: facetImpact(facetId(c.f), profile, cfg),
      BA: c.BA, n: c.n, capped: true,
    });
  }

  return { score: Math.round(score * 10) / 10, center: Math.round(center * 10) / 10, reasons };
}

// ── Filtering ──────────────────────────────────────────────────────
function hasFacet(v: DiscoveryVector, ref: { kind: string; role?: FacetRole; key: string }): boolean {
  return v.facets.some((f) => f.kind === ref.kind && f.key === ref.key && (!ref.role || f.role === ref.role));
}

function passesFilters(
  v: DiscoveryVector,
  filters: DiscoverFilters,
  state: { onWatchlist: boolean; libraryStatus: string | null; rating: number | null } | undefined
): boolean {
  if (filters.types?.length && !filters.types.includes(v.type)) return false;

  const yearActive = filters.yearMin != null || filters.yearMax != null;
  if (yearActive) {
    if (v.year == null) return false;
    if (filters.yearMin != null && v.year < filters.yearMin) return false;
    if (filters.yearMax != null && v.year > filters.yearMax) return false;
  }

  const commActive = (filters.communityMin != null && filters.communityMin > 0) || (filters.communityMax != null && filters.communityMax < 100);
  if (commActive) {
    if (v.communityScore == null) return false;
    if (filters.communityMin != null && v.communityScore < filters.communityMin) return false;
    if (filters.communityMax != null && v.communityScore > filters.communityMax) return false;
  }

  const runtimeActive = filters.runtimeMin != null || filters.runtimeMax != null;
  if (runtimeActive) {
    if (v.runtimeMinutes == null) return false;
    if (filters.runtimeMin != null && v.runtimeMinutes < filters.runtimeMin) return false;
    if (filters.runtimeMax != null && v.runtimeMinutes > filters.runtimeMax) return false;
  }

  if (filters.sources?.length && !v.sources.some((s) => filters.sources!.includes(s.source))) return false;

  const m = filters.membership;
  if (m) {
    const inLib = !!state?.libraryStatus;
    const inWl = !!state?.onWatchlist;
    const isRated = state?.rating != null;
    if (m.library === "only" && !inLib) return false;
    if (m.library === "exclude" && inLib) return false;
    if (m.wishlist === "only" && !inWl) return false;
    if (m.wishlist === "exclude" && inWl) return false;
    if (m.rated === "only" && !isRated) return false;
    if (m.rated === "exclude" && isRated) return false;
  }

  for (const inc of filters.includeFacets ?? []) if (!hasFacet(v, inc)) return false;
  for (const exc of filters.excludeFacets ?? []) if (hasFacet(v, exc)) return false;

  return true;
}

// ── Public: find ───────────────────────────────────────────────────
export interface DiscoverResultItem {
  id: string;
  /** Public url address segment; see publicUrl.ts. */
  slug?: string | null;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  communityScore: number | null;
  communityAvg: number | null;
  communityVotes: number;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  sources: { source: string; sourceId: string }[];
  score: number;
  reasons: Reason[];
  fandexScore: number | null;
  fandexCenter: number | null;
  /**
   * True when this row could not be scored but the user HAS enough signal for a
   * score to exist — the card should ask `/api/discover/scores` to heal and
   * score it. Mirrors the flag liveDiscover.ts already sets; without it here,
   * advanced search rendered permanently blank badges (2026-08-13).
   */
  fandexPending: boolean;
}

export interface FindResult {
  baseline: number;
  total: number;
  profileSummary: { topPositive: Reason[]; topNegative: Reason[] };
  items: DiscoverResultItem[];
}

export function find(userId: string, req: FindRequest): FindResult {
  const { vectors, byId, idf } = getCache();
  // H5.3: the visible Fandex Score badge uses the RAW rated-library profile,
  // never the refined one — a seed/manual-pill nudge changes what ranks well
  // in THIS search, not your actual taste-match number (D2's "fully
  // transparent" intent extends to "stable regardless of session refinements").
  const rawProfile = buildProfile(userId);
  const profile = applyRefinements(rawProfile, req.refine, byId);
  const filters = req.filters ?? {};
  const sort: SortKey = req.sort ?? "fandexScore";
  const limit = Math.min(Math.max(req.limit ?? 60, 1), 120);
  const offset = Math.max(req.offset ?? 0, 0);
  const q = (req.q ?? "").trim().toLowerCase();

  // State for the whole catalog (needed for membership filtering + hydration).
  const state = getUserStateMap(userId, vectors.map((v) => v.id));

  const ignored = req.excludeIgnored
    ? new Set(query<{ media_item_id: string }>(
        "SELECT media_item_id FROM user_item_state WHERE user_id = ? AND relation = 'ignored'", [userId]
      ).map((r) => r.media_item_id))
    : null;

  // Fandex Score is computed here (not just for the paged slice) so the whole
  // set can be SORTED by it. The badge uses the RAW profile (H5.3) regardless.
  const scored: { v: DiscoveryVector; score: number; reasons: Reason[]; fandexScore: number | null; fandexCenter: number | null }[] = [];
  for (const v of vectors) {
    if (ignored?.has(v.id)) continue;
    if (q && !v.title.toLowerCase().includes(q)) continue;
    if (!passesFilters(v, filters, state.get(v.id))) continue;
    const s = scoreFacets(v.facets, profile.w, idf);
    const fx = computeFandexScore(v.facets, rawProfile, undefined, { mediaItemId: v.id });
    scored.push({ v, score: s?.score ?? 0, reasons: s?.reasons ?? [], fandexScore: fx?.score ?? null, fandexCenter: fx?.center ?? null });
  }

  // Unified sort model: releaseDate (newest) / popularity (votes) / rating
  // (Bayesian-damped) / fandexScore. "Fandex Score" with no usable signal (cold
  // start) falls back to the Bayesian rating so the page stays useful.
  const score10 = (v: DiscoveryVector) => (v.communityAvg == null ? null : v.communityAvg / 10);
  const prior = ratingPrior(scored.map(({ v }) => ({ score10: score10(v), votes: v.communityVotes })));
  const bayes = (v: DiscoveryVector) => bayesRating(score10(v), v.communityVotes, prior);
  // Two DIFFERENT questions that used to share one answer, split 2026-08-13:
  //  - `profileUsable` — has this user enough signal for a score to mean
  //    anything? Governs whether an unscored card may ask for one.
  //  - `fandexUsable` — should the SORT use it? Additionally requires that the
  //    user actually chose that sort.
  // Conflating them is what hid the badge: with sort=Popularity the old flag was
  // false, so nothing downstream believed a score was available at all.
  const profileUsable = rawProfile.ratedItemCount >= MIN_RATED_FOR_FANDEX_SCORE;
  const fandexUsable = sort === "fandexScore" && profileUsable;
  scored.sort((a, b) => {
    switch (sort) {
      case "releaseDate": return cmpDate(a.v.releaseDate, b.v.releaseDate); // cmpDate defaults to desc (newest first)
      case "popularity": return b.v.communityVotes - a.v.communityVotes || bayes(b.v) - bayes(a.v);
      case "rating": return bayes(b.v) - bayes(a.v) || b.v.communityVotes - a.v.communityVotes;
      default: // fandexScore
        if (!fandexUsable) return bayes(b.v) - bayes(a.v) || b.v.communityVotes - a.v.communityVotes;
        return (b.fandexScore ?? -1) - (a.fandexScore ?? -1) || bayes(b.v) - bayes(a.v);
    }
  });

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);

  const items: DiscoverResultItem[] = page.map(({ v, score, reasons, fandexScore, fandexCenter }) => {
    const st = state.get(v.id);
    return {
      id: v.id, slug: v.slug, type: v.type, title: v.title, releaseDate: v.releaseDate, posterUrl: v.posterUrl, backdropUrl: v.backdropUrl,
      communityScore: v.communityScore,
      communityAvg: v.communityAvg,
      communityVotes: v.communityVotes,
      platformSources: st?.platformSources ?? [],
      onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null,
      sources: v.sources, score, reasons,
      fandexScore, fandexCenter,
      // 2026-08-13 — the advanced-search path was never connected to the lazy
      // heal. `fandexPending` was set ONLY in liveDiscover.ts, so a filtered
      // search (/api/discover/find -> this function) returned fandexScore: null
      // for any row too thin to score and the card had no way to ask for one:
      // PosterCard registers with usePendingFandexScore only when this flag is
      // set. Unreleased titles have no communityScore to fall back on either, so
      // the badge vanished entirely — and tag filters make it worse, because a
      // thin browsed row's tags are the one thing it DOES have, so it matches
      // tag queries readily and then scores blank.
      //
      // Same condition liveDiscover uses: only pend when a profile exists to
      // score against, or a cold-start user would spin forever on a question
      // that has no answer. `/api/discover/scores` heals the row and answers,
      // and a genuine "still no score" comes back as null, which is final.
      fandexPending: fandexScore == null && profileUsable,
    };
  });

  // Profile summary — strongest positive/negative facets overall, ranked by the
  // same idf-weighted effective contribution used for scoring.
  const entries = [...profile.w.entries()].map(([id, weight]) => ({ eff: weight * (idf.get(id) ?? 1), meta: profile.meta.get(id) }))
    .filter((e) => e.meta);
  const toReason = (e: { eff: number; meta: any }): Reason => ({
    kind: e.meta.kind, role: e.meta.role, label: e.meta.label, category: e.meta.category, contribution: Math.round(e.eff * 100) / 100,
  });
  const topPositive = entries.filter((e) => e.eff > 0).sort((a, b) => b.eff - a.eff).slice(0, 12).map(toReason);
  const topNegative = entries.filter((e) => e.eff < 0).sort((a, b) => a.eff - b.eff).slice(0, 12).map(toReason);

  return { baseline: Math.round(profile.baseline * 10) / 10, total, profileSummary: { topPositive, topNegative }, items };
}

function cmpDate(a: string | null, b: string | null, asc = false): number {
  // For desc (releaseNew): later dates first, nulls last. asc flips, nulls still last.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return asc ? a.localeCompare(b) : b.localeCompare(a);
}

// ── Public: facet + title autocomplete (for pills + seeds) ─────────
export function searchFacets(q: string, kind: string | null, limit = 20): VocabEntry[] {
  const { vocab } = getCache();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const filtered = vocab.filter((e) => (!kind || e.kind === kind) && e.label.toLowerCase().includes(needle));
  // SM14 (2026-07-27): the vocab keys person/company facets by kind+role+key
  // (facetId — a person who both directed and wrote is two distinct entries,
  // which matters for idf weighting). But facetUrl.ts drops role from the URL
  // ON PURPOSE — /person/<slug> and /studio/<slug> fold every role into one
  // page — so search must merge by kind+key too, or the same person/company
  // shows up as duplicate pills pointing at the identical link. Re-sort after
  // merging: a merged count can outrank entries that hadn't been split.
  const merged = new Map<string, VocabEntry>();
  for (const e of filtered) {
    const mergeKey = `${e.kind}|${e.key}`;
    const existing = merged.get(mergeKey);
    if (existing) existing.count += e.count;
    else merged.set(mergeKey, { ...e });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export interface TitleMatch { id: string; title: string; type: MediaType; posterUrl: string | null; year: number | null }
export function searchTitles(q: string, limit = 12): TitleMatch[] {
  const { vectors } = getCache();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: TitleMatch[] = [];
  for (const v of vectors) {
    if (v.title.toLowerCase().includes(needle)) {
      out.push({ id: v.id, title: v.title, type: v.type, posterUrl: v.posterUrl, year: v.year });
      if (out.length >= limit * 3) break; // gather a few, then rank
    }
  }
  // Prefer prefix matches, then shorter titles (closer to the query).
  out.sort((a, b) => {
    const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
    const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
    return ap - bp || a.title.length - b.title.length;
  });
  return out.slice(0, limit);
}

// All catalog items carrying a given facet (for the facet detail page).
// H5.6: the cached vectors carry CANONICAL tag keys, so canonicalize a tag ref
// key too — a caller passing a member spelling still matches the whole bundle.
export function itemsWithFacet(ref: { kind: string; role?: FacetRole; key: string }): DiscoveryVector[] {
  const { vectors } = getCache();
  const key = ref.kind === "tag" ? canonicalTagKey(ref.key) : ref.key;
  return vectors.filter((v) =>
    v.facets.some((f) => f.kind === ref.kind && f.key === key && (!ref.role || f.role === ref.role))
  );
}

// Resolve a person facet to its TMDB person id by reading the credits of one
// catalog item that carries them — so the detail page can fetch bio/age. Cached.
const _personIdCache = new BoundedCache<string, number | null>({ max: 5000 });
export function resolvePersonTmdbId(role: string, key: string): number | null {
  const ck = `${role}:${key}`;
  if (_personIdCache.has(ck)) return _personIdCache.get(ck)!;
  let found: number | null = null;
  for (const v of itemsWithFacet({ kind: "person", role: role as FacetRole, key })) {
    const row = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'tmdb' LIMIT 1`, [v.id]);
    if (!row) continue;
    let data: any;
    try { data = JSON.parse(row.raw_data ?? "{}"); } catch { continue; }
    const pool: any[] = role === "cast" ? (data.credits?.cast ?? []) : role === "creator" ? (data.created_by ?? []) : (data.credits?.crew ?? []);
    const hit = pool.find((p) => personKey(p?.name ?? "") === key);
    if (hit?.id) { found = hit.id; break; }
  }
  _personIdCache.set(ck, found);
  return found;
}

// Resolve a game developer/publisher facet to its RAWG entity id (for pulling
// their catalog), by reading one carrying item's rawg raw_data. Cached.
const _rawgEntityCache = new BoundedCache<string, number | null>({ max: 5000 });
export function resolveRawgEntityId(role: string, key: string): number | null {
  const ck = `${role}:${key}`;
  if (_rawgEntityCache.has(ck)) return _rawgEntityCache.get(ck)!;
  let found: number | null = null;
  for (const v of itemsWithFacet({ kind: "company", role: role as FacetRole, key })) {
    const row = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'rawg' LIMIT 1`, [v.id]);
    if (!row) continue;
    let data: any;
    try { data = JSON.parse(row.raw_data ?? "{}"); } catch { continue; }
    const pool: any[] = role === "developer" ? (data.developers ?? []) : (data.publishers ?? []);
    const hit = pool.find((p) => companyKey(p?.name ?? "") === key);
    if (hit?.id) { found = hit.id; break; }
  }
  _rawgEntityCache.set(ck, found);
  return found;
}

// Strongest positive tag keys from the profile — drives the "fetch more" ingest.
export function topPositiveTagKeys(userId: string, refine: DiscoverRefine | undefined, n = 8): string[] {
  const { byId, idf } = getCache();
  const profile = applyRefinements(buildProfile(userId), refine, byId);
  return [...profile.w.entries()]
    .map(([id, weight]) => ({ meta: profile.meta.get(id), eff: weight * (idf.get(id) ?? 1) }))
    .filter((e) => e.meta?.kind === "tag" && e.eff > 0)
    .sort((a, b) => b.eff - a.eff)
    .slice(0, n)
    .map((e) => e.meta!.key);
}
