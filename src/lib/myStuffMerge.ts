// C8 (2026-07-28) — the pure merge + tab-filter logic behind the merged
// Library/Wishlist view (MyStuffView.tsx). Extracted so it's unit-testable
// without a DOM: dedupe an item present in both sets, and each of the four
// tab predicates.
import type { EnrichedItem } from "@/types";

// ── The tab set, trimmed to three on 2026-08-16 (Nils: "the tabs get a little
// crowded") ─────────────────────────────────────────────────────────────────
// Was: all · wishlist · unrated · rated · progress. "All" was a superset nobody
// asked for, and rated/unrated were a rating FILTER wearing a tab's clothes —
// the toolbar's own filters cover that. Now: Wishlist · Progress · Library, in
// that order, which is also roughly the order you use them.
//
// `TABS` order IS the strip's order — LibraryWishlistTabs renders from its own
// list, but `parseTab` validates against this one, so both must agree.
//
// "progress" is the odd one out and deliberately so: the other two filter the
// SAME merged item list, while progress lists EPISODES from /api/progress. It
// lives here because it is a tab of this view to the reader, and `parseTab` is
// what makes `?tab=progress` a real deep link — which is what Home's "See all"
// needs. `filterByTab` never sees it; MyStuffView branches before that point.
export type MyStuffTab = "wishlist" | "progress" | "library";
const TABS: MyStuffTab[] = ["wishlist", "progress", "library"];

// SM21 (2026-07-28): the tab used to be pure client state — switching it
// changed no URL, so it reset on reload and Back exited the page instead of
// returning to the previous tab. Validates a `?tab=` query value against the
// four real tabs, falling back to the route's own default for anything else
// (missing, empty, or unrecognized) rather than crashing on a bad/stale link.
export function parseTab(raw: string | null | undefined, fallback: MyStuffTab): MyStuffTab {
  return (TABS as string[]).includes(raw ?? "") ? (raw as MyStuffTab) : fallback;
}

export interface MyStuffItem extends EnrichedItem {
  inLibrary: boolean;
  inWishlist: boolean;
  /**
   * When the item reached the WISHLIST, kept alongside `addedAt` because for an
   * item in both collections they are different dates and `addedAt` below is
   * the library's. Null for a library-only item. See the note in the merge.
   */
  wishlistAddedAt?: number | null;
}

// Both `/api/library` and `/api/calendar` already cross-populate the OTHER
// collection's membership signal (getUserStateMap, both routes) — a library
// item's `platformSources` IS its true wishlist-provider list, and a
// wishlist item's `libraryStatus`/`rating` are its true library state. So an
// item present in both fetches needs no field-by-field reconciliation: keep
// the library fetch's copy (it has the richer library-side fields) and just
// confirm `inWishlist`.
//
// ── ⚠️ `addedAt` is the ONE field that cannot be resolved by keeping one copy
// (2026-08-26) ──────────────────────────────────────────────────────────────
// Every other field describes the ITEM, so the richer copy is simply the better
// one. `addedAt` describes an EVENT, and there are two of them: you wishlisted
// Slay the Spire II in June and it entered your library in July. Keeping the
// library copy therefore made "Recently added" on the WISHLIST tab report the
// library date, floating a long-standing wish to the top the day you bought it.
// So the wishlist's timestamp is carried separately and the tab picks. Rare but
// not exotic: it is every game you own on Steam and still have wishlisted.
export function mergeMyStuff(libraryItems: EnrichedItem[], wishlistItems: EnrichedItem[]): MyStuffItem[] {
  const byId = new Map<string, MyStuffItem>();
  for (const it of libraryItems) {
    byId.set(it.id, { ...it, inLibrary: true, inWishlist: (it.platformSources?.length ?? 0) > 0 });
  }
  for (const it of wishlistItems) {
    const existing = byId.get(it.id);
    if (existing) byId.set(it.id, { ...existing, inWishlist: true, wishlistAddedAt: it.addedAt ?? null });
    else byId.set(it.id, { ...it, inLibrary: it.libraryStatus != null, inWishlist: true, wishlistAddedAt: it.addedAt ?? null });
  }
  return [...byId.values()];
}

/**
 * Re-point `addedAt` at the wishlist's own timestamp, for the Wishlist tab.
 *
 * `sortItems` reads one field, and it is right to: a card shows one "added"
 * date and the tab decides which event that is. Applied on the tab's items
 * rather than inside the merge so the library tab keeps the library date.
 */
export function asWishlistAdds<T extends { addedAt?: number | null; wishlistAddedAt?: number | null }>(items: T[]): T[] {
  return items.map((i) =>
    i.wishlistAddedAt != null && i.wishlistAddedAt !== i.addedAt ? { ...i, addedAt: i.wishlistAddedAt } : i
  );
}

export function filterByTab<T extends { inLibrary: boolean; inWishlist: boolean; rating?: number | null }>(
  items: T[], tab: MyStuffTab
): T[] {
  switch (tab) {
    case "wishlist": return items.filter((i) => i.inWishlist);
    // Everything you actually own/watched/played. Note this is NOT the old
    // "all": that folded in wishlist-only items, which is what made it a
    // superset rather than a place.
    case "library": return items.filter((i) => i.inLibrary);
    // Not an item filter at all — the Progress tab lists EPISODES from
    // /api/progress, and MyStuffView branches to its own component before
    // reaching here. Empty is the correct answer to the question this function
    // asks ("which of these items belong to that tab"), and it fails safe: if a
    // future caller does route progress through here, it renders nothing rather
    // than silently showing the whole library under the wrong heading.
    case "progress": return [];
  }
}
