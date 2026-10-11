// The two crowd sorts every list offers, in one place: Search, the tag, person
// and studio pages, and your own lists each had a copy.
//
// Both had a flaw the old site had already fixed or never met:
//
//   Rating. Sorting by the bare score puts a title one person rated 10 above a
//   classic thousands rated 9. The site damps a score by its votes
//   (src/lib/ratingsSort.ts, imported here): few votes pull it toward the
//   list's own average.
//
//   Popularity. It is the vote count, and a vote count is not the same thing
//   from one type to the next: a game's includes its Steam reviews, hundreds of
//   thousands of them, and a film's is TMDB's. Sorted raw, a list of all three
//   types opened with 35 games in its first 48 (2026-10-11). The site never
//   showed the three in one popularity list: its browse had a shelf per type.

import { bayesRating, ratingPrior } from '@/lib/ratingsSort';

export interface Crowd {
  type: string;
  /** The crowd's rating, 0 to 100, or null for none. */
  score: number | null;
  votes: number;
}

/** Best rated first, a score counting for more the more people gave it. Unrated last. */
export function byRating<T>(list: T[], crowd: (item: T) => Crowd): T[] {
  const entries = list.map((item) => {
    const c = crowd(item);
    return { item, score10: c.score == null ? null : c.score / 10, votes: c.votes };
  });
  const prior = ratingPrior(entries);
  return entries
    .map((e) => ({ ...e, damped: bayesRating(e.score10, e.votes, prior) }))
    .sort((a, b) => b.damped - a.damped || b.votes - a.votes)
    .map((e) => e.item);
}

/**
 * Most voted first.
 *
 * `acrossTypes` is for a list somebody is browsing, not searching: each title
 * is placed by its rank among its OWN type, so the list opens with the most
 * popular game, film and show, then the second of each. A type that runs out
 * simply stops appearing. For a search it stays off: there the question is
 * which of these few matches people know, and the raw count answers it.
 */
export function byPopularity<T>(list: T[], crowd: (item: T) => Crowd, acrossTypes = false): T[] {
  const entries = list.map((item) => ({ item, ...crowd(item) }));
  const byVotes = (a: { votes: number }, b: { votes: number }) => b.votes - a.votes;
  if (!acrossTypes) return entries.sort(byVotes).map((e) => e.item);

  const byType = new Map<string, typeof entries>();
  for (const e of entries) {
    const group = byType.get(e.type);
    if (group) group.push(e); else byType.set(e.type, [e]);
  }
  if (byType.size < 2) return entries.sort(byVotes).map((e) => e.item);

  const ranked: { item: T; rank: number; votes: number }[] = [];
  for (const group of byType.values()) group.sort(byVotes).forEach((e, rank) => ranked.push({ item: e.item, rank, votes: e.votes }));
  // Within one rank the bigger count goes first, which only settles the order of three cards.
  return ranked.sort((a, b) => a.rank - b.rank || b.votes - a.votes).map((e) => e.item);
}
