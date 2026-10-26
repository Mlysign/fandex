// Fandex Score default config + taxonomy seed (H5.1) — the ONE place these
// numbers live, so migrations.ts (seeding — must stay leaf/side-effect-free)
// and scoringConfig.ts (runtime loader) can't drift apart. This module must
// import nothing that opens a db connection or reads env at module scope;
// tags.ts qualifies (pure data + a pure function).

import { CATEGORIES } from "@/lib/tags";

export interface ScoringConfigValues {
  roleWeights: Record<string, number>; // director / creator / writer / cast / developer / publisher / studio / network / ip / tag
  priorStrength: number;   // C — Bayesian shrinkage prior strength (§3.1)
  // Q19 (2026-07-19): the score now centers on the user's OWN mean rating (not
  // a fixed 50 — see computeFandexScore), with an asymmetric gain so a
  // above-your-average item swings up faster than a below-average one swings
  // down (skews the visible range toward enthusiasm rather than half the
  // library reading as "you won't like this"). The center itself is derived,
  // never a knob — only the two gains are.
  mappingConstantUp: number;   // K_up — gain applied when rawSum >= 0
  mappingConstantDown: number; // K_down — gain applied when rawSum < 0
  // 2026-07-29: replaced `perCategoryCap` (top-N per category, capped an item's
  // OWN 5 genre tags to 3) with a fixed-size top-N selection across the whole
  // item — see computeFandexScore. This is what makes a tag's contribution
  // item-independent (no divisor) and therefore printable on a chip.
  topTagsPositive: number; // top-N tags with dev > 0, by dev descending
  topTagsNegative: number; // top-N tags with dev < 0, by dev ascending (most negative first)
  topPeople: number;       // top-N director/creator/writer/cast facets, by |dev| descending
  topCompanies: number;    // top-N developer/publisher/studio/network facets, by |dev| descending
  // 2026-08-14: franchise / IP facets get their OWN bucket for the same reason
  // people and companies do — an IP shouldn't have to out-compete a genre tag
  // for a slot. Defaults to 1: an item belongs to one franchise, and the only
  // way to hold two is TMDB and IGDB naming the same one differently enough to
  // survive `ipKey` — in which case counting both would double-count one IP.
  topIps: number;          // top-N ip facets, by |dev| descending
  // The second axis, "do you seek this out" (docs/fandex-score.md §3.7). Since
  // 2026-10-26 one model over all facets: your picks against the baseline, a
  // random draw of ordinary titles (mobile/src/lib/pullModel.ts). These are its knobs.
  /** The evidence a facet needs before it counts, as a z-score: how many standard errors its count among your picks sits from what the baseline expects (pullModel.ts). */
  pullL1: number;
  /** A small ridge on top, so facets that always come together share their weight steadily. */
  pullL2: number;
  /** Points per bit of pull (a doubling of how often you pick it), the job `mappingConstantUp` does for taste. */
  pullGain: number;
  /** Per medium, how much the pull points count in the number: a game you own is weaker evidence than a film you chose (measured 2026-10-25). Missing media count 1. */
  pullWeight: Record<string, number>;
  /** Points off your usual that make an axis read as high or low. The old BAND_MARGIN, now two. */
  tasteBandMargin: number;
  pullBandMargin: number;
  /**
   * 2026-10-25: how much a tag occurrence counts by where the tag came from
   * (docs/fandex-score.md §3.9): a provider's genre or theme and a crowd's
   * voted tag in full, an editorial keyword less. Applied per occurrence on
   * both axes, the way a cast member's billing is; a tag facet derived before
   * tiers existed carries none and counts in full. Keyed by TagTier.
   */
  tagTierWeights: Record<string, number>;
}

// Mirrors discovery.ts's ROLE_WEIGHT + K_SHRINK verbatim, so seeding this table
// changes no live scoring behavior (that swap is H5.2).
//
// 2026-07-29 (this batch): the aggregate changed from a weighted MEAN (score
// compressed toward the center as facet count grew, and a tag's contribution
// was a share of the total — item-dependent) to an UNBOUNDED RAW SUM over a
// fixed-size top-N selection (topTagsPositive/topTagsNegative/topPeople/
// topCompanies below) — see computeFandexScore. The OLD K=25 value (H5.5/S11,
// 2026-07-27) was calibrated for the mean and is meaningless under the sum —
// a mean's weightedDev tops out around ±10, a raw sum over up to 13 selected
// facets does not.
//
// K=5.4 was computed by scripts/calibrate-fandex.mjs against the owner's real
// ~1,921-item library (1,857 of them score): with K=1, rawSum's real p10-p90
// spread was 7.40 points; K = round(40 / 7.40, 1) = 5.4 targets a 40-point
// spread. Measured result: p10 50.6 · median 71.3 · p90 90.2 (min 27.5, max
// 129.2 — genuinely unbounded, unlike the old clamped mean). See
// docs/fandex-score.md for the full before/after and the script's own output
// for the exact numbers.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
    developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6,
    ip: 1.3, tag: 1.0,
  },
  priorStrength: 5,
  mappingConstantUp: 5.4,
  mappingConstantDown: 5.4,
  topTagsPositive: 5,
  topTagsNegative: 3,
  topPeople: 3,
  topCompanies: 2,
  topIps: 1,
  // Pull defaults: a gain of 3.5 per bit gives the pull rows the same spread as
  // the taste rows over unseen titles (2026-10-25); games at half, because what
  // the owner plays and what he rates disagree there (memory:
  // fandex-score-pull-vs-fit). The evidence level is measured in §3.7: 1.5
  // kept del Toro (10 films) and held firefighter at zero; 1 let twice the
  // facets through, 2 dropped del Toro and four points of films' wishlist bar.
  pullL1: 1.5,
  pullL2: 0.5,
  pullGain: 3.5,
  pullWeight: { movie: 1, show: 1, game: 0.5, book: 1, boardgame: 1 },
  tasteBandMargin: 10,
  pullBandMargin: 10,
  tagTierWeights: { genre: 1, theme: 1, voted: 1, keyword: 0.5 },
};

/**
 * The odds line under a label: how much more often than usual a title with
 * that label was rated 8 or more, per medium, with `all` as the fallback for a
 * medium or a label without enough titles. Seeded from the owner's 1,705
 * ratings on 2026-10-26 under the tuned config (`scripts/score-backtest.mjs
 * --ladder`, docs/fandex-score.md §3.10); the admin goalpost summed over every
 * user replaces it once there is one.
 */
export const DEFAULT_LABEL_ODDS: Record<string, Partial<Record<string, number>>> = {
  // Re-seeded 2026-10-26 under pull against the baseline (§3.7), provisional until the baseline is in the pool.
  all: { usual: 0.79, tryout: 0.97, 'safe-bet': 1.57, 'hidden-gem': 1.46, bycatch: 0.74, skip: 0.6 },
  movie: { usual: 0.88, tryout: 1.09, 'safe-bet': 1.65, 'hidden-gem': 1.64, bycatch: 0.65, skip: 0.41 },
  show: { usual: 1.03, tryout: 0.99, 'safe-bet': 1.31, 'hidden-gem': 1.44, bycatch: 0.87, skip: 0.61 },
  game: { usual: 0.8, tryout: 0.91, 'safe-bet': 1.23, 'hidden-gem': 1.13, bycatch: 0.72, skip: 0.79 },
};

export interface TagCategorySeed {
  id: string;
  label: string;
  color: string;
  weight: number;
  ignored: boolean;
  sortOrder: number;
}

// Faithful mirror of tags.ts's CATEGORIES: `meta` stays ignored (weight 0),
// every other category defaults to weight 1 — i.e. today's un-weighted
// behavior, until the dev backend (H5.4) is used to rebalance.
export const DEFAULT_TAG_CATEGORIES: TagCategorySeed[] = CATEGORIES.map((c, i) => ({
  id: c.id,
  label: c.label,
  color: c.color,
  weight: c.defaultIgnored ? 0 : 1,
  ignored: !!c.defaultIgnored,
  sortOrder: i,
}));
