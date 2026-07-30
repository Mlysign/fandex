// C8 (2026-07-28) — the pure merge + tab-filter logic behind the merged
// Library/Wishlist view (MyStuffView.tsx). Extracted so it's unit-testable
// without a DOM: dedupe an item present in both sets, and each of the four
// tab predicates.
import type { EnrichedItem } from "@/types";

export type MyStuffTab = "all" | "wishlist" | "unrated" | "rated";
const TABS: MyStuffTab[] = ["all", "wishlist", "unrated", "rated"];

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
}

// Both `/api/library` and `/api/calendar` already cross-populate the OTHER
// collection's membership signal (getUserStateMap, both routes) — a library
// item's `platformSources` IS its true wishlist-provider list, and a
// wishlist item's `libraryStatus`/`rating` are its true library state. So an
// item present in both fetches needs no field-by-field reconciliation: keep
// the library fetch's copy (it has the richer library-side fields) and just
// confirm `inWishlist`.
export function mergeMyStuff(libraryItems: EnrichedItem[], wishlistItems: EnrichedItem[]): MyStuffItem[] {
  const byId = new Map<string, MyStuffItem>();
  for (const it of libraryItems) {
    byId.set(it.id, { ...it, inLibrary: true, inWishlist: (it.platformSources?.length ?? 0) > 0 });
  }
  for (const it of wishlistItems) {
    const existing = byId.get(it.id);
    if (existing) byId.set(it.id, { ...existing, inWishlist: true });
    else byId.set(it.id, { ...it, inLibrary: it.libraryStatus != null, inWishlist: true });
  }
  return [...byId.values()];
}

export function filterByTab<T extends { inLibrary: boolean; inWishlist: boolean; rating?: number | null }>(
  items: T[], tab: MyStuffTab
): T[] {
  switch (tab) {
    case "all": return items;
    case "wishlist": return items.filter((i) => i.inWishlist);
    case "unrated": return items.filter((i) => i.inLibrary && i.rating == null);
    case "rated": return items.filter((i) => i.inLibrary && i.rating != null);
  }
}
