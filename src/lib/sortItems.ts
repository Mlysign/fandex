// Client-side sort for already-loaded item lists (Wishlist, Library) so they
// honor the same unified sort options as Discover. Discover sorts server-side
// via find(); these pages sort the EnrichedItems they already hold.

import { SortKey } from "@/components/discovery/types";
import { averageCommunity } from "@/lib/ratings";
import { communityVotes, bayesRating, ratingPrior } from "@/lib/ratingsSort";
import { CommunityRating } from "@/types";

interface SortableItem {
  releaseDate?: string | null;
  rating?: number | null;                 // user's 0-10 score
  communityRatings?: CommunityRating[];
  fandexScore?: number | null;
}

// Platform-average rating normalized to 0-10 (for the rating-grouped layout's
// group bands — the ORDERING within uses the Bayesian score below).
export function platformRating10(item: SortableItem): number | null {
  const avg = averageCommunity(item.communityRatings);
  return avg == null ? null : avg / 10;
}

// Newest first, nulls always last (independent of direction).
function cmpDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;   // nulls last
  if (!b) return -1;
  return b.localeCompare(a);
}

export function sortItems<T extends SortableItem>(items: T[], sort: SortKey): T[] {
  const arr = [...items];
  switch (sort) {
    case "releaseDate":
      arr.sort((a, b) => cmpDateDesc(a.releaseDate, b.releaseDate));
      break;
    case "popularity":
      arr.sort((a, b) => communityVotes(b.communityRatings) - communityVotes(a.communityRatings));
      break;
    case "rating": {
      // Bayesian-damped (see ratingsSort.ts): prior from the loaded set's own
      // well-voted items, so a 1-vote 10 can't top a 5000-vote 8.
      const prior = ratingPrior(arr.map((i) => ({ score10: platformRating10(i), votes: communityVotes(i.communityRatings) })));
      const score = (i: T) => bayesRating(platformRating10(i), communityVotes(i.communityRatings), prior);
      arr.sort((a, b) => score(b) - score(a));
      break;
    }
    case "fandexScore":
      arr.sort((a, b) => (b.fandexScore ?? -1) - (a.fandexScore ?? -1));
      break;
  }
  return arr;
}
