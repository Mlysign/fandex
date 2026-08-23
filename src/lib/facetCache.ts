// Shared per-item derived-data cache — the SAFE HALF of the discovery cache's
// deferred perf fix (docs/archive/performance-audit.md §A, 2026-07-30).
//
// THE PROBLEM: `/api/library` and `/api/calendar` each independently SELECT
// their media_links rows, JSON.parse every raw_data blob, and call
// mergeLinks() + extractFacets() themselves — the exact same derivation
// `analyzeLibraryFacets` (library stats/Insights) and `loadMembershipGroups`
// (the live-discover taste signal) ALSO do for the same items. Those two
// already have their own per-user RESULT caches (`getLibraryFacetAnalysis`,
// `getMembershipSignal`), but neither the routes' own item-building loop nor a
// same-library re-render is helped by that: a route hits the DB, parses every
// blob and re-derives facets/merged on every single request, cache hit or not.
//
// THE FIX: cache the DERIVED {facets, merged} per item, keyed on freshness a
// caller can check WITHOUT parsing anything (MAX(last_synced) is a plain SQL
// column). A caller builds `RawLink[]` straight off its SQL rows — raw_data
// stays an unparsed string — and only pays the JSON.parse + mergeLinks +
// extractFacets cost on an actual cache miss.
//
// WHY THE DERIVED SHAPE, NEVER THE PARSED raw_data: caching the parsed JS
// objects (rather than these small derived shapes) would trade a CPU problem
// for a memory one — 30 MB of raw_data parses into several times that on the
// heap, on a container with real OOM history (memory: image-optimizer-native-
// memory). facets+merged for the whole pool is on the order of a few MB.
//
// WHAT'S DELIBERATELY *NOT* CACHED HERE: tag-alias canonicalization and
// category-override resolution. Only `analyzeLibraryFacets` applies those
// today (`applyTagAliases` + `tagOverrides.get(f.key) ?? f.category`); the
// routes and `loadMembershipGroups` call `extractFacets` raw and always have.
// Baking alias/override resolution into this cache would silently change what
// the routes' `computeFandexScore` sees — a scoring-behavior change, not a
// caching one, and out of this fix's scope. So `facets` here are always RAW
// `extractFacets` output; every caller keeps applying its own existing
// post-processing (or none) on top, exactly as before this cache existed.
//
// WIRED INTO discovery.ts's `buildCache` since 2026-08-02 (§A closed) — via
// `peekDerived` below, which is what makes the two-pass read possible: pass 1
// reads metadata + last_synced only, and `raw_data` is SELECTed in pass 2 for
// cache MISSES alone. Note what that does NOT do: pool membership is still
// recomputed from SQL on every rebuild. The originally-proposed fix was to
// treat a membership write as an incremental add to the cached pool, whose
// failure mode is an item silently missing from the pool until the TTL expires;
// caching the DERIVATION instead gets the same saving with no such mode.

import { sharedCache } from "@/lib/boundedCache";
import { mergeLinks } from "@/lib/merge";
import { extractFacets, type Facet } from "@/lib/facets";
import { scoringConfigSignature } from "@/lib/scoringConfig";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import type { EnrichedItem, MediaLink, MediaType } from "@/types";

/** The region-aware projection every caller already builds via mergeLinks(). */
export type MergedItem = Omit<EnrichedItem, "id" | "type" | "platformSources">;

export interface Derived {
  facets: Facet[];
  merged: MergedItem;
}

/**
 * One media_links row, UNPARSED. Callers build this straight off their SQL
 * rows — `rawData` stays a JSON string — so the parse can be skipped entirely
 * on a cache hit. Mirrors the shape every call site already selects.
 */
export interface RawLink {
  source: MediaLink["source"];
  sourceId: string;
  releaseDate: string | null;
  rawData: string | null;
  lastSynced: number;
}

// Capped like its sibling per-item caches (liveDiscover.ts's `_facetCache`,
// discovery.ts's `_personIdCache`) — a few thousand entries covers the pool
// (~2,500 items) across a couple of regions with headroom, without growing
// unbounded across many users/regions over the long-lived process (P2).
const _cache = sharedCache<string, Derived>("facetCache.derived", { max: 6000 });

// scoringConfigSignature() already folds tagAliasSignature() + the category/
// override signatures in (scoringConfig.ts) — including it here costs nothing
// (a config change just turns entries over a little earlier than strictly
// necessary, since RAW facets don't actually depend on it) and keeps this
// cache honest if a future caller ever does bake alias/override resolution in.
//
// `last_synced` alone is NOT a sufficient freshness token: matcher.ts writes it
// as strftime('%s','now'), so two writes to the same link inside one second are
// indistinguishable — and sub-second follow-up writes are a real pattern here
// (enrichment writes straight after a sync upsert; /api/facet/mine heals thin
// links before scoring). A key made of last_synced alone hands back the FIRST
// write's derivation until the caller's own TTL expires. Proven reproducible in
// discoveryPoolCache.test.ts, which fails without the length component.
//
// So the token is (MAX(last_synced), SUM(LENGTH(raw_data))). Length is not a
// hash, but it needs no JSON.parse — plain SQL `LENGTH()` for a peeking caller,
// and free for `getDerivedForItem`, which already holds the strings — and two
// payloads that differ in content essentially always differ in byte length when
// one is an enrichment of the other. A true content hash would mean reading
// every blob in pass 1, which is the exact cost this cache exists to avoid.
function keyFor(mediaItemId: string, maxLastSynced: number, rawLen: number, region: string, sig: string): string {
  return `${mediaItemId}:${maxLastSynced}:${rawLen}:${region}:${sig}`;
}

/**
 * The config component of the cache key, for callers doing a BATCH of lookups.
 *
 * It's identical for every item in one pass, but it isn't free: measured at
 * 0.061 ms a call, and discovery.ts's pool rebuild does one peek + (on a miss)
 * one set per item, so recomputing it per item cost ~307 ms of a cold 2,531-item
 * rebuild — more than the JSON.parse it was there to help avoid. Batch callers
 * compute it once and pass it to `peekDerived`/`getDerivedForItem`; single-item
 * callers can keep omitting it.
 */
export function derivedSignature(): string {
  return scoringConfigSignature();
}

/**
 * Cache lookup WITHOUT the raw links — the whole point being that the caller
 * hasn't read `raw_data` yet and wants to know whether it has to.
 *
 * Both freshness inputs come from plain SQL aggregates over the item's links —
 * `MAX(ml.last_synced)` and `SUM(LENGTH(ml.raw_data))` — so a caller builds the
 * key from a metadata-only SELECT. On a hit it never touches `raw_data`; on a
 * miss it SELECTs raw_data for just that item and calls `getDerivedForItem`.
 *
 * Returns a fresh copy of `facets` on a hit, same as `getDerivedForItem`.
 */
export function peekDerived(
  mediaItemId: string,
  maxLastSynced: number,
  rawLen: number,
  region: string = DEFAULT_COUNTRY,
  sig: string = scoringConfigSignature()
): Derived | undefined {
  const hit = _cache.get(keyFor(mediaItemId, maxLastSynced, rawLen, region, sig));
  return hit ? { facets: [...hit.facets], merged: hit.merged } : undefined;
}

/**
 * Facets + the region-aware merged projection for one item, backed by the
 * shared cache.
 *
 * Returns a FRESH COPY of the `facets` array on every call — never the stored
 * array reference — so a caller that sorts/filters/mutates it in place can't
 * corrupt the next caller's read. (The `Facet` objects themselves are shared;
 * nothing in the codebase mutates a `Facet`'s fields in place.)
 */
export function getDerivedForItem(
  mediaItemId: string,
  rawLinks: RawLink[],
  type: MediaType,
  region: string = DEFAULT_COUNTRY,
  sig: string = scoringConfigSignature()
): Derived {
  const maxLastSynced = rawLinks.reduce((m, l) => Math.max(m, l.lastSynced), 0);
  // Free here — the strings are already in hand. Must match the SQL
  // SUM(LENGTH(raw_data)) a peeking caller computes.
  const rawLen = rawLinks.reduce((n, l) => n + (l.rawData?.length ?? 0), 0);
  const key = keyFor(mediaItemId, maxLastSynced, rawLen, region, sig);

  const hit = _cache.get(key);
  if (hit) return { facets: [...hit.facets], merged: hit.merged };

  const links: MediaLink[] = rawLinks.map((l) => ({
    id: "", mediaItemId, source: l.source, sourceId: l.sourceId,
    title: null, releaseDate: l.releaseDate,
    rawData: l.rawData ? JSON.parse(l.rawData) : {}, lastSynced: l.lastSynced,
  }));

  const merged = mergeLinks(links, type, region);
  const facets = extractFacets(links, type, merged);

  _cache.set(key, { facets, merged });
  return { facets: [...facets], merged };
}
