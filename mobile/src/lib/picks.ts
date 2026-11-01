// Search's "Picks": what the grid opens on with nothing typed (Nils,
// 2026-10-30: "always starts with Cyberpunk"). It used to open on Popularity,
// a vote count, so the same titles led every visit. Picks deals a fresh hand
// of strong titles each visit instead.
//
// Strong means the top of its OWN type by quality: your Fandex Score where you
// have one, the crowd's rating damped by its votes where you don't. Per type,
// because the two scales and the three crowds differ (sortCards.ts). The most
// obscure quarter of a type by votes is left out of the hand, so a title three
// people rated 10 does not lead.
//
// The hand is a uniform shuffle of that top tier, dealt one type at a time, so
// the first cards are one of each and two visits share few of their first
// screen. A front-loaded weighted draw would repeat the same head every visit
// (src/lib/dailyRotation.ts, "Turnover"). Below the hand, the rest by quality.

import { bayesRating, ratingPrior } from '@/lib/ratingsSort';
import { rngFrom } from '@/lib/dailyRotation';

/** A title is in the hand from this share of its type up. */
export const PICKS_TOP_SHARE = 0.2;
/** And only from this share of its type's vote counts up. */
export const PICKS_MIN_VOTES_SHARE = 0.25;

export interface PickInput {
  type: string;
  /** Your Fandex Score, 0 to 100, or null for none. */
  fandexScore: number | null;
  /** The crowd's rating, 0 to 100, or null for none. */
  communityScore: number | null;
  communityVotes: number;
}

/**
 * Every item in Picks order: the strong ones shuffled by `seed` and dealt by
 * type, then the rest best first. Same items and seed, same order.
 */
export function drawPicks<T>(items: T[], input: (item: T) => PickInput, seed: number): T[] {
  type Entry = { item: T; fandexScore: number | null; score10: number | null; votes: number; quality: number };
  const byType = new Map<string, Entry[]>();
  for (const item of items) {
    const p = input(item);
    const list = byType.get(p.type) ?? [];
    list.push({
      item, fandexScore: p.fandexScore, votes: p.communityVotes, quality: -1,
      score10: p.communityScore == null ? null : p.communityScore / 10,
    });
    byType.set(p.type, list);
  }

  const rng = rngFrom(seed);
  const hands: T[][] = [];
  const rest: Entry[] = [];
  for (const type of [...byType.keys()].sort()) {
    const list = byType.get(type)!;
    // Both on 0 to 100: the score is what you would rate it times ten, the damped rating likewise. Unrated is -1.
    const prior = ratingPrior(list);
    for (const e of list) e.quality = e.fandexScore ?? (e.score10 == null ? -1 : bayesRating(e.score10, e.votes, prior) * 10);
    const rated = list.filter((e) => e.quality >= 0).sort((a, b) => b.quality - a.quality);
    const votesFloor = quantile(list.map((e) => e.votes), PICKS_MIN_VOTES_SHARE);
    const top = Math.ceil(rated.length * PICKS_TOP_SHARE);
    const hand = rated.slice(0, top).filter((e) => e.votes >= votesFloor);
    const inHand = new Set(hand);
    hands.push(shuffle(hand.map((e) => e.item), rng));
    rest.push(...list.filter((e) => !inHand.has(e)));
  }

  const out: T[] = [];
  for (let i = 0; hands.some((h) => i < h.length); i++) {
    for (const h of hands) if (i < h.length) out.push(h[i]);
  }
  return [...out, ...rest.sort((a, b) => b.quality - a.quality).map((e) => e.item)];
}

/** The value `share` of the way up `values`. */
function quantile(values: number[], share: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

/** Fisher–Yates, from the seeded stream. */
function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
