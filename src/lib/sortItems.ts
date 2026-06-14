// Client-side sort for already-loaded item lists (Wishlist, Library) so they
// honor the same T8 sort options as Discover. Discover sorts server-side via
// find(); these pages sort the EnrichedItems they already hold.

import { SortKey } from "@/components/discovery/types";
import { averageCommunity } from "@/lib/ratings";
import { CommunityRating } from "@/types";

interface SortableItem {
  releaseDate?: string | null;
  rating?: number | null;                 // user's 0-10 score
  communityRatings?: CommunityRating[];
}

// Platform-average rating normalized to 0-10 (for the rating-grouped layout).
export function platformRating10(item: SortableItem): number | null {
  const avg = averageCommunity(item.communityRatings);
  return avg == null ? null : avg / 10;
}

function cmpDate(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;   // nulls last
  if (!b) return -1;
  return a.localeCompare(b);
}

export function sortItems<T extends SortableItem>(items: T[], sort: SortKey): T[] {
  const arr = [...items];
  switch (sort) {
    case "releaseNew": arr.sort((a, b) => cmpDate(b.releaseDate, a.releaseDate)); break;
    case "releaseOld": arr.sort((a, b) => cmpDate(a.releaseDate, b.releaseDate)); break;
    case "userRating": arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)); break;
    case "platformRating": arr.sort((a, b) => (platformRating10(b) ?? -1) - (platformRating10(a) ?? -1)); break;
    case "match": break; // taste ranking isn't computed client-side — keep current order
  }
  return arr;
}
