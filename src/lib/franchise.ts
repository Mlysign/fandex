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

/** A franchise member the PROVIDER lists but the catalog does not hold. Shaped
 *  like a `franchise_members` row; kept structural so this module stays free of
 *  a DB import and testable as pure logic. */
export interface FranchiseOutsider {
  source: string;
  sourceId: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  /** Crowd attention (TMDB popularity / IGDB total_rating_count). Comparable
   *  with a held title's communityVotes for cap selection. */
  popularity: number | null;
}

/** One rail slot: either a catalog row or a provider-only title. */
export type FranchiseEntry =
  | { kind: "held"; vector: DiscoveryVector; attention: number; releaseDate: string | null; title: string }
  | { kind: "absent"; outsider: FranchiseOutsider; attention: number; releaseDate: string | null; title: string };

export interface FranchiseGroup {
  /** The canonical ip facet key, for logging/debugging. Not a URL: `ip` is
   *  deliberately not a linkable facet kind (see facetUrl.ts). */
  key: string;
  /** Display label with the franchise words peeled: "Star Wars", not
   *  "Star Wars Collection". */
  label: string;
  /** CATALOG siblings only, newest first — never the item you're looking at.
   *  Kept for callers that can only render real rows. */
  items: DiscoveryVector[];
  /** The full rail: catalog rows AND provider-only titles, ranked and capped
   *  together. This is what the item page renders. */
  entries: FranchiseEntry[];
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

/** topByAttention over mixed entries. Held rows and provider-only titles
 *  compete in ONE pool — see the warning at the merge site. */
function topByAttentionEntries(entries: FranchiseEntry[], cap: number): FranchiseEntry[] {
  if (entries.length <= cap) return entries;
  return [...entries]
    .sort((a, b) =>
      b.attention - a.attention ||
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
      a.title.localeCompare(b.title)
    )
    .slice(0, cap);
}

/** byRecency over mixed entries. */
function byRecencyEntries(entries: FranchiseEntry[]): FranchiseEntry[] {
  return [...entries].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return a.title.localeCompare(b.title);
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title);
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
  cap: number = FRANCHISE_CAP,
  /** Titles the PROVIDER says are in this franchise but the catalog does not
   *  hold (2026-08-23). Injected, like `candidatesForFacet`, so this function
   *  stays pure and testable without the DB. Given the winning ip facet, the
   *  caller returns the stored `franchise_members` rows for it. */
  absentForFacet?: (f: Facet) => FranchiseOutsider[]
): FranchiseGroup | null {
  let best: { key: string; label: string; facet: Facet; items: DiscoveryVector[] } | null = null;
  for (const f of facets) {
    if (f.kind !== "ip") continue;
    const items = candidatesForFacet(f).filter((v) => v.id !== itemId);
    if (!best || items.length > best.items.length) {
      best = { key: f.key, label: ipDisplayLabel(f.label), facet: f, items };
    }
  }
  if (!best) return null;

  // ── Titles we do not hold ────────────────────────────────────────────────
  // Measured 2026-08-23: 167 of the catalog's 249 TMDB collections held exactly
  // ONE title, so before this the rail was hidden for two thirds of the films
  // that have a franchise — not because the franchise was wrong, but because we
  // only ever looked at our own shelf.
  //
  // Deduped against the catalog by (source, sourceId), which is the identity
  // the rest of the app matches on. A title-and-year match would be wrong in
  // both directions here: a franchise routinely contains a remake with the same
  // title, and the same film reaches us under different titles per provider.
  const held = new Set<string>();
  for (const v of best.items) {
    for (const s of v.sources ?? []) held.add(`${s.source}:${s.sourceId}`);
  }
  // The item being viewed counts as held too, or every franchise rail would
  // offer a card back to the page you are already on.
  for (const s of selfSources(candidatesForFacet, best.facet, itemId)) held.add(s);

  const outsiders = (absentForFacet?.(best.facet) ?? [])
    .filter((o) => !held.has(`${o.source}:${o.sourceId}`));

  // A franchise whose only member is the item itself is not a rail. Rendering
  // an empty (or one-card) shelf is how a thin catalog reads as a broken
  // feature — the rail is hidden entirely instead.
  if (best.items.length === 0 && outsiders.length === 0) return null;

  // Select on attention, display by recency. Never `sort().slice()` — see
  // topByAttention's warning.
  //
  // ⚠️ HELD TITLES AND OUTSIDERS COMPETE IN ONE POOL, not in two ranked lists
  // concatenated. Ranking them separately would put every catalog row ahead of
  // every provider row regardless of which is the more notable film, which is
  // the same "a selection must rank by the quantity that matters" mistake the
  // Score's top-N buckets made. `communityVotes` and a member's stored
  // `popularity` are both crowd-attention numbers, which is what makes them
  // comparable at all.
  const merged: FranchiseEntry[] = [
    ...best.items.map((v) => ({ kind: "held" as const, vector: v, attention: v.communityVotes ?? 0, releaseDate: v.releaseDate, title: v.title })),
    ...outsiders.map((o) => ({ kind: "absent" as const, outsider: o, attention: o.popularity ?? 0, releaseDate: o.releaseDate, title: o.title })),
  ];

  const entries = byRecencyEntries(topByAttentionEntries(merged, cap));

  return {
    key: best.key,
    label: best.label,
    // DERIVED from `entries`, never ranked separately. Two independent
    // selections over the same pool is how the same rail ends up disagreeing
    // with itself about which titles made the cut — a held row visible in one
    // list and missing from the other, with nothing to explain why.
    items: entries.filter((e) => e.kind === "held").map((e) => e.vector),
    entries,
  };
}

/** The viewing item's own provider ids, so it can't be re-offered as an
 *  "absent" member of its own franchise. */
function selfSources(
  candidatesForFacet: (f: Facet) => DiscoveryVector[],
  facet: Facet,
  itemId: string
): string[] {
  const self = candidatesForFacet(facet).find((v) => v.id === itemId);
  return (self?.sources ?? []).map((s) => `${s.source}:${s.sourceId}`);
}
