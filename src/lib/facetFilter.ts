// Client-side must-include / must-exclude facet matching for already-loaded
// item lists (wishlist, library). Reuses the same extractFacets/facetId logic the
// server uses, applied to each item's per-source rawData (EnrichedItem.sources[].data),
// so a facet pill means the same thing here as in catalog search.

import { extractFacets, facetId } from "@/lib/facets";
import type { FacetPill, Membership} from "@/components/discovery/types";
import { YEAR_MIN, YEAR_MAX } from "@/components/discovery/types";
import type { MediaLink, MediaType } from "@/types";

interface FacetableItem {
  id: string;
  type: MediaType;
  tags?: string[];
  keywords?: string[];
  sources?: { source: string; sourceId: string; data?: Record<string, any> }[];
}

function itemFacetIds(item: FacetableItem): Set<string> {
  const links: MediaLink[] = (item.sources ?? []).map((s, i) => ({
    id: String(i), mediaItemId: item.id, source: s.source as MediaLink["source"],
    sourceId: s.sourceId, title: null, releaseDate: null, rawData: s.data ?? {}, lastSynced: 0,
  }));
  const facets = extractFacets(links, item.type, { tags: item.tags, keywords: item.keywords });
  return new Set(facets.map((f) => facetId(f)));
}

// Year range + membership (in-library / on-wishlist) filter for already-loaded
// lists. inLibrary = has a library status/rating; onWishlist = has wishlist
// providers. Both are present on Library and Wishlist items (cross-relation).
export function passesYearMembership(
  item: { releaseDate?: string | null; libraryStatus?: string | null; rating?: number | null; platformSources?: string[] },
  yearRange: [number, number],
  membership: { library?: Membership; wishlist?: Membership; rated?: Membership }
): boolean {
  const y = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : null;
  if (yearRange[0] > YEAR_MIN && (y == null || y < yearRange[0])) return false;
  if (yearRange[1] < YEAR_MAX && (y == null || y > yearRange[1])) return false;
  const inLib = item.libraryStatus != null || item.rating != null;
  const onWl = (item.platformSources?.length ?? 0) > 0;
  const isRated = item.rating != null;
  if (membership.library === "only" && !inLib) return false;
  if (membership.library === "exclude" && inLib) return false;
  if (membership.wishlist === "only" && !onWl) return false;
  if (membership.wishlist === "exclude" && onWl) return false;
  if (membership.rated === "only" && !isRated) return false;
  if (membership.rated === "exclude" && isRated) return false;
  return true;
}

/**
 * AND across include (every one must be present), NONE of exclude may be present.
 *
 * Takes ids rather than an item, so a caller that already HAS them can use it.
 * The Progress tab is one: its entries arrive carrying the show's `facetIds`,
 * computed server-side where the raw provider data actually lives.
 *
 * ⚠️ That makes this the STRONGER half of the pair. `matchesFacets` below can
 * only ever see TAG facets, because `/api/library` and `/api/calendar` ship
 * `sources[].data` as `{}` (the 2026-07-30 payload fix — 30.7 MB of provider
 * blobs), and people, studios and franchises are extracted from exactly those
 * blobs. Ids computed server-side carry all four kinds.
 */
export function matchesFacetIds(ids: Iterable<string>, include: FacetPill[], exclude: FacetPill[]): boolean {
  if (include.length === 0 && exclude.length === 0) return true;
  const set = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  // FacetPill carries kind/role as plain strings; facetId only reads them as keys.
  for (const f of include) if (!set.has(facetId(f as any))) return false;
  for (const f of exclude) if (set.has(facetId(f as any))) return false;
  return true;
}

// The same rule, deriving the ids from an already-loaded item's per-source data.
export function matchesFacets(item: FacetableItem, include: FacetPill[], exclude: FacetPill[]): boolean {
  if (include.length === 0 && exclude.length === 0) return true;
  return matchesFacetIds(itemFacetIds(item), include, exclude);
}
