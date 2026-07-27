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
  mappingConstantUp: number;   // K_up — gain applied when weightedDev >= 0
  mappingConstantDown: number; // K_down — gain applied when weightedDev < 0
  perCategoryCap: number;  // top-N tags per category counted toward the aggregate (§3.3, D3)
}

// Mirrors discovery.ts's ROLE_WEIGHT + K_SHRINK verbatim, so seeding this table
// changes no live scoring behavior (that swap is H5.2). perCategoryCap is
// still a provisional default. The K constants were originally 10/10
// (unchanged from the pre-H5 behavior) pending real calibration — that
// calibration happened in H5.5/S11 (2026-07-27, see SM13): measured against a
// real 1,855-item library, K=10 compressed the whole score range into
// 58.8–79.1 (p10–p90 of just 9 points), making "weak match" unreachable.
// K=25 is the largest value that library supports with ZERO clamping at 0/100
// (K=30 already clips the top item) — see fandex-score.md §3.3/D1 for the
// projection math. Still symmetric: Q19's asymmetric-gain idea (K_up > K_down)
// remains a live option but wasn't part of this calibration pass.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
    developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
  },
  priorStrength: 5,
  mappingConstantUp: 25,
  mappingConstantDown: 25,
  perCategoryCap: 3,
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
