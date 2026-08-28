// Client-side must-include / must-exclude facet matching for already-loaded
// item lists (library, wishlist, progress).
//
// ── There is exactly ONE producer of facet ids, and it is the server ────────
//
// This file used to hold a second one. `matchesFacets(item, …)` rebuilt
// MediaLink[] out of `EnrichedItem.sources[].data` and re-ran `extractFacets`,
// on the reasonable-sounding theory that a facet pill should mean the same
// thing here as in catalog search.
//
// It didn't, and hadn't since 2026-07-30. `/api/library` and `/api/calendar`
// ship `sources[].data` as `{}` — the payload fix that took 30.7 MB of raw
// provider blobs off the wire — and `extractFacets` reads people out of
// `tmdb.credits`, companies out of `production_companies` /
// `involved_companies` and franchises out of `belongs_to_collection` /
// `franchises`. All of that lives in the blobs. With them empty the derivation
// yields TAG FACETS AND NOTHING ELSE, so every person, studio and franchise
// pill silently matched zero items on Library and Wishlist. Measured on the
// real account: "Rebecca Ferguson · Cast · 6" took /wishlist?tab=library from
// 1,943 titles to 0, while the same pill on Progress correctly returned Silo.
//
// It survived a month with every test green for two reasons worth remembering.
// A pill that matches nothing renders exactly like a genuine zero result, so
// there is nothing to see. And the tests only ever exercised tags, which is the
// one kind that still worked.
//
// So the derivation is gone rather than fixed. The routes carry `facetIds`,
// computed where the raw data still lives, and `matchesFacetIds` below is the
// only entry point. A client that cannot derive facets cannot derive them
// WRONG, and `tsc` now rejects the call that used to.

import { facetId } from "@/lib/facets";
import type { FacetPill, Membership} from "@/components/discovery/types";
import { YEAR_MIN, YEAR_MAX } from "@/components/discovery/types";

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
 * Takes ids rather than an item, because every caller now HAS them: they arrive
 * on the payload as `facetIds`, computed server-side. `/api/library` and
 * `/api/calendar` supply them per item (EnrichedItem.facetIds); `/api/progress`
 * supplies the show's set per episode (ProgressEntry.facetIds). One producer,
 * one meaning, all four facet kinds.
 *
 * ⚠️ An item that carries no ids matches nothing but the empty filter, which is
 * the correct reading of "we know none of this item's facets" and the same
 * answer the old derivation gave for people. Do not paper over a missing
 * `facetIds` by re-deriving from the item — see this file's header.
 */
export function matchesFacetIds(ids: Iterable<string>, include: FacetPill[], exclude: FacetPill[]): boolean {
  if (include.length === 0 && exclude.length === 0) return true;
  const set = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  // FacetPill carries kind/role as plain strings; facetId only reads them as keys.
  for (const f of include) if (!set.has(facetId(f as any))) return false;
  for (const f of exclude) if (set.has(facetId(f as any))) return false;
  return true;
}
