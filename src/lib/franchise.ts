// The franchise rail's selection logic — pure logic over plain data, so it's
// testable without the catalog cache (same shape and the same reason as
// similarItems.ts, which sits beside it in the same API route).
//
// WHAT THIS IS FOR: the item page's "More from …" rail. `ip` is the fourth
// facet kind (facets.ts), fed by TMDB `belongs_to_collection` and IGDB
// `franchises`, and ipKey()'s suffix-peel is what lands "Star Wars Collection"
// (TMDB, movies) and "Star Wars" (IGDB, games) on ONE key. That peel is the
// entire reason this rail can be cross-media at all.
//
// ⚠️ COVERAGE IS PARTIAL AND ASYMMETRIC, and the rail has to be honest about
// it. Measured on the real catalog (2026-08-21): 628 distinct franchises over
// 2,538 pool items, but the median franchise holds ONE item and only 226 hold
// more than one — so most titles show no rail, and that is the data being thin,
// not a bug. Neither provider describes a SHOW's franchise, so the 6 Star Wars
// series in the catalog are there only because `item_ip_override` rows attach
// them by hand (see ipAlias.ts). Expect a franchise to be missing entries the
// providers never linked.

import { ipDisplayLabel } from "@/lib/facets";
import type { Facet } from "@/lib/facets";
import type { DiscoveryVector } from "@/lib/discovery";

/**
 * Hard ceiling on rail length. Star Wars is the catalog's largest franchise at
 * 24 members (2026-08-21), so this truncates nothing today; it exists so a
 * future franchise ingest can't put 300 cards in one horizontal scroller.
 */
const FRANCHISE_CAP = 40;

export interface FranchiseGroup {
  /** The canonical ip facet key, for logging/debugging. Not a URL: `ip` is
   *  deliberately not a linkable facet kind (see facetUrl.ts). */
  key: string;
  /** Display label with the franchise words peeled: "Star Wars", not
   *  "Star Wars Collection". */
  label: string;
  /** Siblings only — never the item you're looking at. Chronological. */
  items: DiscoveryVector[];
}

/**
 * Oldest first, undated last, ties broken by title.
 *
 * A franchise is a timeline, so chronological beats every ranking we could
 * apply here — and unlike "More like this" below it, this rail is a complete
 * index rather than a recommendation, so it deliberately does NOT sort by the
 * viewer's taste. releaseDate is ISO `YYYY-MM-DD`, so a string compare IS a
 * date compare.
 */
function chronological(items: DiscoveryVector[]): DiscoveryVector[] {
  return [...items].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return a.title.localeCompare(b.title);
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title);
  });
}

/**
 * The franchise rail for one item, or null when there's nothing to show.
 *
 * `candidatesForFacet` is injected rather than calling itemsWithFacet()
 * directly, so this stays pure — no DB, no module-level cache. The caller is
 * responsible for handing over CANONICAL facets (ip aliases + per-item
 * overrides applied), because a profile-canonical key only matches an
 * item-canonical one; see the warning at the top of ipAlias.ts.
 *
 * WHEN AN ITEM CARRIES SEVERAL FRANCHISES (IGDB's `franchises` is an array),
 * the largest one wins rather than unioning them. Union would mislabel the
 * rail: "More from Metal Gear" listing a title that is only in a different
 * franchise is worse than showing the smaller list. Note the near-miss case
 * this ISN'T — "Star Wars Collection" and "Star Wars" already collapse to one
 * key in ipKey(), so two ip facets on one item are two genuinely different
 * franchises.
 */
export function franchiseForItem(
  itemId: string,
  facets: Facet[],
  candidatesForFacet: (f: Facet) => DiscoveryVector[],
  cap: number = FRANCHISE_CAP
): FranchiseGroup | null {
  let best: FranchiseGroup | null = null;
  for (const f of facets) {
    if (f.kind !== "ip") continue;
    const items = candidatesForFacet(f).filter((v) => v.id !== itemId);
    if (!best || items.length > best.items.length) {
      best = { key: f.key, label: ipDisplayLabel(f.label), items };
    }
  }
  // A franchise whose only member is the item itself is not a rail. Rendering
  // an empty (or one-card) shelf is how a thin catalog reads as a broken
  // feature — the rail is hidden entirely instead.
  if (!best || best.items.length === 0) return null;
  return { ...best, items: chronological(best.items).slice(0, cap) };
}
