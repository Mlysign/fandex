// Shared popularity + Bayesian-rating helpers for the unified sort model
// (Release date / Popularity / Rating / Fandex Score). "Rating" mirrors the
// facet pages' bayesScore (publicFacetDetail.ts) so a handful of high votes
// can't outrank a well-voted classic — same semantics on every surface.

import { CommunityRating } from "@/types";

// Total community vote count across all sources (the "Popularity" signal).
// CommunityRating.votes is per-source; absent → 0.
export function communityVotes(ratings: CommunityRating[] | undefined | null): number {
  if (!ratings?.length) return 0;
  return ratings.reduce((s, r) => s + (r.votes ?? 0), 0);
}

const BAYES_PRIOR_VOTES = 50; // matches publicFacetDetail.BAYES_PRIOR_VOTES
const NEUTRAL_PRIOR = 6.5;
const MIN_VOTES_FOR_PRIOR = 10;

// Bayesian-damped score from a 0-10 rating + vote count: (v·R + m·C)/(v + m),
// where C is the list prior and m is the prior's vote weight. Unrated → -1
// (sorts last). Works from a plain (score, votes) pair so it serves both local
// items (communityAvg/10 + summed votes) and provider pools.
export function bayesRating(score10: number | null, votes: number, prior: number): number {
  if (score10 == null) return -1;
  return (votes * score10 + BAYES_PRIOR_VOTES * prior) / (votes + BAYES_PRIOR_VOTES);
}

// The list's prior: mean 0-10 score over well-voted entries only (so the
// low-vote outliers we're damping can't drag the prior toward themselves),
// neutral fallback when nothing qualifies.
export function ratingPrior(entries: { score10: number | null; votes: number }[]): number {
  const voted = entries.filter((e) => e.score10 != null && e.votes >= MIN_VOTES_FOR_PRIOR);
  if (!voted.length) return NEUTRAL_PRIOR;
  return voted.reduce((s, e) => s + (e.score10 as number), 0) / voted.length;
}
