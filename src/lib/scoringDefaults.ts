// Fandex Score default config + taxonomy seed (H5.1) — the ONE place these
// numbers live, so migrations.ts (seeding — must stay leaf/side-effect-free)
// and scoringConfig.ts (runtime loader) can't drift apart. This module must
// import nothing that opens a db connection or reads env at module scope;
// tags.ts qualifies (pure data + a pure function).

import { CATEGORIES } from "@/lib/tags";

export interface ScoringConfigValues {
  roleWeights: Record<string, number>; // director / creator / writer / cast / developer / publisher / studio / network / tag
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
}

// Mirrors discovery.ts's ROLE_WEIGHT + K_SHRINK verbatim, so seeding this table
// changes no live scoring behavior (that swap is H5.2).
//
// 2026-07-29 (this batch): the aggregate changed from a weighted MEAN (score
// compressed toward the center as facet count grew, and a tag's contribution
// was a share of the total — item-dependent) to an UNBOUNDED RAW SUM over a
// fixed-size top-N selection (topTagsPositive/topTagsNegative/topPeople/
// topCompanies below) — see computeFandexScore. K was recalibrated for the
// new math by scripts/calibrate-fandex.mjs against the owner's real library;
// see that script's output and docs/fandex-score.md for the measured
// before/after distribution. The OLD K=25 value (H5.5/S11, 2026-07-27) was
// calibrated for the mean and is not meaningful under the sum.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
    developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
  },
  priorStrength: 5,
  mappingConstantUp: 25,
  mappingConstantDown: 25,
  topTagsPositive: 5,
  topTagsNegative: 3,
  topPeople: 3,
  topCompanies: 2,
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
