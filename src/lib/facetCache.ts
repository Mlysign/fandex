// Shared per-item derived-data cache — the SAFE HALF of the discovery cache's
// deferred perf fix (docs/performance-audit.md §A, 2026-07-30).
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
// NOT wired into discovery.ts's `buildCache` (the catalog pool) — that cache
// is coupled to `catalogSignature()`/`POOL_WHERE`, which is the harder,
// deliberately-deferred half of this fix (a membership write must not force a
// full pool rebuild; that needs its own supervised pass).

import { BoundedCache } from "@/lib/boundedCache";
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
const _cache = new BoundedCache<string, Derived>({ max: 6000 });

// scoringConfigSignature() already folds tagAliasSignature() + the category/
// override signatures in (scoringConfig.ts) — including it here costs nothing
// (a config change just turns entries over a little earlier than strictly
// necessary, since RAW facets don't actually depend on it) and keeps this
// cache honest if a future caller ever does bake alias/override resolution in.
function keyFor(mediaItemId: string, maxLastSynced: number, region: string): string {
  return `${mediaItemId}:${maxLastSynced}:${region}:${scoringConfigSignature()}`;
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
  region: string = DEFAULT_COUNTRY
): Derived {
  const maxLastSynced = rawLinks.reduce((m, l) => Math.max(m, l.lastSynced), 0);
  const key = keyFor(mediaItemId, maxLastSynced, region);

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
