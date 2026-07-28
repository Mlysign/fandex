// Cross-source, cross-type ranking for the calendar's "popular releases this
// month" scope (2026-07-28).
//
// THE PROBLEM: each provider's popularity metric lives on its own scale. A
// typical TMDB `popularity` is ~15, a typical RAWG `added` is ~300, a typical
// IGDB `hypes` is ~5. Sorting the merged pool by the raw number doesn't rank by
// popularity at all — it ranks by which provider happens to use bigger numbers,
// and RAWG wins every month by construction.
//
// THE FIX: score each candidate against the MEDIAN of its own source+type
// bucket for that month — "how much bigger than a typical release of its kind
// this month". A movie 8× its bucket's median outranks a game 3× its own, and
// the mix that comes out is whatever the month actually looks like. That's the
// explicit requirement (Nils, 2026-07-28): a month may legitimately be 15
// movies / 1 show / 4 games, and must NOT be re-balanced into per-type quotas.
//
// The tradeoff to know about: this measures "standout for its medium", not
// absolute reach. A quiet month for games will still surface its biggest game,
// because that game towers over its own median. That's intended — a calendar
// with nothing in it is worse than one with the month's best available — but
// it's the reason a month can look game-heavy when nothing huge shipped.
//
// KNOBS, if a month ever looks wrong: POPULAR_PER_MONTH (how many survive) and
// MIN_BUCKET (when a median is trustworthy). Both live here; the calendar UI
// never needs to change to retune this.

import { FeedCandidate } from "@/lib/discoverFeed";
// Straight from lib/normalize (merge.ts only re-exports it) — this module is
// pure logic and the calendar client shares the same dedupe key.
import { normalizeName } from "@/lib/normalize";

/** How many popular items a month contributes. Nils's brief: 10–20 total. */
export const POPULAR_PER_MONTH = 15;

/** Below this, a bucket's median is noise — fall back to the provider's own order. */
const MIN_BUCKET = 5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Dedupe key for the same game reaching us from both RAWG and IGDB. Same
 * `normalizeName(title)|releaseDate` shape /api/discover's searchAll already
 * uses for its RAWG-vs-IGDB merge, so the two paths agree on what "the same
 * game" means.
 */
function dedupeKey(c: FeedCandidate): string {
  return `${c.type}|${normalizeName(c.title ?? "")}|${c.releaseDate ?? ""}`;
}

/**
 * Rank a month's candidates from every source into one list, most popular
 * first, and take the top `limit`.
 *
 * Input order matters for one thing only: within a source+type bucket too small
 * to have a meaningful median, candidates keep the order the provider returned
 * them in (each provider is already sorted by its own popularity), so pass each
 * source's results in provider order.
 */
export function rankPopularMonth(
  candidates: FeedCandidate[],
  limit: number = POPULAR_PER_MONTH
): FeedCandidate[] {
  // Dedupe first, so a title present in two sources doesn't skew either
  // bucket's median or take two of the month's slots. Keep the first seen —
  // callers pass the richer source first.
  const seen = new Set<string>();
  const unique: FeedCandidate[] = [];
  for (const c of candidates) {
    if (!c.releaseDate) continue; // undated items can't be placed on a calendar
    const key = dedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  // Bucket by source+type. TMDB movies and TMDB shows are separate buckets:
  // same provider, but `popularity` is distributed differently per medium.
  const buckets = new Map<string, FeedCandidate[]>();
  for (const c of unique) {
    const key = `${c.source}:${c.type}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(c);
    else buckets.set(key, [c]);
  }

  const scored: { candidate: FeedCandidate; score: number }[] = [];
  for (const bucket of buckets.values()) {
    const values = bucket
      .map((c) => c.popularity)
      .filter((p): p is number => typeof p === "number" && p > 0);

    if (values.length < MIN_BUCKET) {
      // Too few real numbers to normalize against. Fall back to provider rank:
      // first returned scores highest, decaying so a small bucket can still
      // place its leader near the top but can't flood the whole month.
      bucket.forEach((candidate, i) => scored.push({ candidate, score: 1 / (i + 1) }));
      continue;
    }

    const med = Math.max(median(values), 1e-6);
    bucket.forEach((candidate, i) => {
      const p = candidate.popularity;
      // A candidate with no popularity number in an otherwise-populated bucket
      // is ranked as if it were typical, minus a nudge for its provider rank —
      // better than dropping it, since a missing metric isn't evidence of
      // being unpopular.
      const score = typeof p === "number" && p > 0 ? p / med : 1 / (i + 1);
      scored.push({ candidate, score });
    });
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    (b.candidate.voteCount ?? 0) - (a.candidate.voteCount ?? 0) ||
    a.candidate.title.localeCompare(b.candidate.title)
  );

  return scored.slice(0, Math.max(0, limit)).map((s) => s.candidate);
}
