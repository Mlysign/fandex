// Client-side must-include / must-exclude facet matching for already-loaded
// item lists (wishlist, library). Reuses the same extractFacets/facetId logic the
// server uses, applied to each item's per-source rawData (EnrichedItem.sources[].data),
// so a facet pill means the same thing here as in catalog search.

import { extractFacets, facetId } from "@/lib/facets";
import { FacetPill, Membership, YEAR_MIN, YEAR_MAX } from "@/components/discovery/types";
import { MediaLink, MediaType } from "@/types";

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
  membership: { library?: Membership; wishlist?: Membership }
): boolean {
  const y = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : null;
  if (yearRange[0] > YEAR_MIN && (y == null || y < yearRange[0])) return false;
  if (yearRange[1] < YEAR_MAX && (y == null || y > yearRange[1])) return false;
  const inLib = item.libraryStatus != null || item.rating != null;
  const onWl = (item.platformSources?.length ?? 0) > 0;
  if (membership.library === "only" && !inLib) return false;
  if (membership.library === "exclude" && inLib) return false;
  if (membership.wishlist === "only" && !onWl) return false;
  if (membership.wishlist === "exclude" && onWl) return false;
  return true;
}

// AND across include (every one must be present), NONE of exclude may be present.
export function matchesFacets(item: FacetableItem, include: FacetPill[], exclude: FacetPill[]): boolean {
  if (include.length === 0 && exclude.length === 0) return true;
  const ids = itemFacetIds(item);
  // FacetPill carries kind/role as plain strings; facetId only reads them as keys.
  for (const f of include) if (!ids.has(facetId(f as any))) return false;
  for (const f of exclude) if (ids.has(facetId(f as any))) return false;
  return true;
}
