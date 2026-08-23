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
 * NEWEST first, undated last, ties broken by title.
 *
 * A franchise is a timeline, so a date order beats every ranking we could apply
 * to the DISPLAY — and unlike "More like this" below it, this rail is a
 * complete index rather than a recommendation, so it deliberately does not sort
 * by the viewer's taste. releaseDate is ISO `YYYY-MM-DD`, so a string compare
 * IS a date compare.
 *
 * It ran OLDEST-first until 2026-08-23. Nils' call, and it is the right one for
 * a horizontal rail specifically: a rail is read left to right and almost never
 * scrolled to its end, so oldest-first spent the only slots anyone actually
 * looks at on the least current titles in the franchise. On a 24-member Star
 * Wars rail that meant the visible cards were all from the 1970s and 80s.
 */
function byRecency(items: DiscoveryVector[]): DiscoveryVector[] {
  return [...items].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return a.title.localeCompare(b.title);
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title);
  });
}

/**
 * Which members survive the cap, when a franchise has more members than the
 * rail can show.
 *
 * ⚠️ THE CAP AND THE ORDER MUST BE DECIDED BY DIFFERENT QUANTITIES, and mixing
 * them is a documented failure in this repo (AGENTS.md: "a cap applied after a
 * sort is a silent filter", which cut every RAWG game genre out of the homepage
 * hub). Sorting by date and then slicing answers "which 40" with "whichever 40
 * happen to sit at one end of the timeline" — for IGDB's 394-member Star Wars
 * franchise that is a near-arbitrary 10% of it.
 *
 * So: SELECT by crowd attention (`communityVotes`), then hand the survivors to
 * byRecency for DISPLAY. Ties fall back to recency so the choice stays
 * deterministic on the long tail of franchise entries with no votes at all,
 * which on IGDB is most of them.
 */
function topByAttention(items: DiscoveryVector[], cap: number): DiscoveryVector[] {
  if (items.length <= cap) return items;
  return [...items]
    .sort((a, b) =>
      (b.communityVotes ?? 0) - (a.communityVotes ?? 0) ||
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
      a.title.localeCompare(b.title)
    )
    .slice(0, cap);
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
  // Select on attention, display by recency. Never `sort().slice()` — see
  // topByAttention's warning.
  return { ...best, items: byRecency(topByAttention(best.items, cap)) };
}
