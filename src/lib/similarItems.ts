// "More like this" ranking — pure logic, no DB/cache access, so it's testable
// without spinning up the real catalog (2026-07-31, T6).
//
// The item-detail mockup drew this rail but marked its logic explicitly out of
// scope ("Recommendation logic out of scope (05-DELTA b) — placeholder rail").
// It's cheap now: the catalog's per-item facets + IDF weights (discovery.ts's
// getCatalogFacets/getCatalogIdf/itemsWithFacet) are already pure in-memory
// reads once the catalog cache is warm — no provider call, no new query beyond
// what a cache miss on a non-pool item needs (see the API route).
//
// WHY IDF-WEIGHTED, NOT A PLAIN SHARED-FACET COUNT: two items sharing "Drama"
// (a genre nearly every dramatic film carries) tells you almost nothing; two
// sharing "steampunk" (rare) tells you a lot. `idf` — already computed for the
// Fandex Score's own facet weighting — is exactly "how rare is this facet",
// so reusing it here means "more like this" agrees with what the app already
// considers distinctive about a title, rather than a second, disagreeing
// notion of similarity.

import { facetId } from "@/lib/facets";
import type { Facet } from "@/lib/facets";
import type { DiscoveryVector } from "@/lib/discovery";

export interface SimilarResult {
  vector: DiscoveryVector;
  score: number;
}

/** Only the item's TOP_N_FACETS rarest facets are scored — an item with 20+
 * tags/cast/companies would otherwise trigger 20+ candidate scans for a rail
 * that only shows 12 results. */
const TOP_N_FACETS = 8;
/** Per facet, the candidate scan stops here — a facet on hundreds of items
 * (a common genre) can't walk the whole catalog. An arbitrary cut is fine: a
 * title's TOTAL score sums across up to 8 facets, so missing a few instances
 * of one common facet past this cap rarely changes who makes the top 12. */
const MAX_CANDIDATES_PER_FACET = 200;
const RESULT_LIMIT = 12;

/**
 * Rank catalog items by shared, IDF-weighted facets with `targetFacets`.
 *
 * `candidatesForFacet` is injected (rather than calling itemsWithFacet()
 * directly) so this stays a pure function over plain data — no DB, no module-
 * level cache — and is unit-testable with fake vectors.
 */
export function rankSimilar(
  targetId: string,
  targetFacets: Facet[],
  idf: Map<string, number>,
  candidatesForFacet: (f: Facet) => DiscoveryVector[],
  limit: number = RESULT_LIMIT
): SimilarResult[] {
  const ranked = [...targetFacets]
    .sort((a, b) => (idf.get(facetId(b)) ?? 0) - (idf.get(facetId(a)) ?? 0))
    .slice(0, TOP_N_FACETS);

  const scores = new Map<string, SimilarResult>();
  for (const f of ranked) {
    // A facet present on every item (or absent from the vocab entirely) has
    // idf 0 or is unweighted — contributes nothing, so skip the scan outright.
    const weight = idf.get(facetId(f)) ?? 0;
    if (weight <= 0) continue;

    for (const v of candidatesForFacet(f).slice(0, MAX_CANDIDATES_PER_FACET)) {
      if (v.id === targetId) continue; // never recommend the item to itself
      const cur = scores.get(v.id);
      if (cur) cur.score += weight;
      else scores.set(v.id, { vector: v, score: weight });
    }
  }

  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
