// Fandex Score default config + taxonomy seed (H5.1) — the ONE place these
// numbers live, so migrations.ts (seeding — must stay leaf/side-effect-free)
// and scoringConfig.ts (runtime loader) can't drift apart. This module must
// import nothing that opens a db connection or reads env at module scope;
// tags.ts qualifies (pure data + a pure function).

import { CATEGORIES } from "@/lib/tags";

export interface ScoringConfigValues {
  roleWeights: Record<string, number>; // director / creator / writer / cast / developer / publisher / studio / network / ip / tag
  priorStrength: number;   // C — Bayesian shrinkage prior strength (§3.1)
  // The score is what you would probably rate the title, times ten (§3.3,
  // since 2026-10-27): your average for the medium, plus the facets' raw sum
  // times a gain FITTED to your own ratings by least squares, one gain for a
  // sum above zero and one below (scripts/score-backtest.mjs --fit-gains
  // prints the pair the current weights imply). The centre itself is derived,
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
  // The pull axis, "do you seek this out" (docs/fandex-score.md §3.7). Since
  // 2026-10-26 one model over all facets: your picks against the baseline, a
  // random draw of ordinary titles (mobile/src/lib/pullModel.ts). These are its
  // knobs. Since 2026-10-27 pull is said beside the score and is not in it.
  /** The evidence a facet needs before it counts, as a z-score: how many standard errors its count among your picks sits from what the baseline expects (pullModel.ts). */
  pullL1: number;
  /** A small ridge on top, so facets that always come together share their weight steadily. */
  pullL2: number;
  /** Points per bit of pull (a doubling of how often you pick it): the pull axis's own scale, for its band and its bar. */
  pullGain: number;
  /** Points off the centre that make the score read as high or low: what colours a badge and fills Home's Recommended rail (§3.8). */
  tasteBandMargin: number;
  /** The same for the pull axis's own points. */
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

// The tuned config of 2026-10-27 (docs/fandex-score.md §3.10): every knob
// searched for ONE goal, the score ÷ 10 as close as possible to the owner's
// own rating, out of fold, tuned on half his titles and checked on the other
// half. Cast and writers count nothing, developers double, IGDB and TMDB
// genres nothing (a genre is what every title of its kind carries). The two
// gains are the least-squares fit of rating − medium average on the raw sum,
// up and down: 0.12 and 0.53 per rating point, times ten for the score.
// Measured out of fold on 1,696 ratings: films within one point 44% (41%
// guessing the average), games 38% (38%), shows 36% (36%); rank order ρ
// films 0.29, games 0.37, shows 0.11.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1, creator: 1.3, writer: 0, cast: 0,
    developer: 2, publisher: 1, studio: 0.7, network: 1,
    ip: 1.5, tag: 1,
  },
  // 2 rather than the 0.5 the search picked: it costs nothing on films and
  // stops a facet rated once from driving a title (Joe Johnston, one film,
  // put Jurassic Park III at 73).
  priorStrength: 2,
  mappingConstantUp: 1.2,
  mappingConstantDown: 5.3,
  topTagsPositive: 12,
  topTagsNegative: 2,
  topPeople: 1,
  topCompanies: 1,
  topIps: 1,
  // Pull: the evidence level is measured in §3.7: 1.5 kept del Toro (10 films)
  // and held firefighter at zero; 1 let twice the facets through, 2 dropped
  // del Toro. The gain gives the pull bar the spread the taste rows had.
  pullL1: 1.5,
  pullL2: 0.5,
  pullGain: 3.5,
  // 4 points: the score says you would give it 0.4 above your usual for the
  // medium. Measured 2026-10-27 on rated titles: films in the high band were
  // given 7.1 (44% an 8 or more) against 6.4 overall, games 8.1 against 7.3;
  // 7% of unseen films and 16% of unseen games read high. At 5, no show did.
  tasteBandMargin: 4,
  pullBandMargin: 6,
  tagTierWeights: { genre: 0.5, theme: 1, voted: 1, keyword: 0.5 },
};

export interface TagCategorySeed {
  id: string;
  label: string;
  color: string;
  weight: number;
  ignored: boolean;
  sortOrder: number;
}

/**
 * The tuned weight per category (§3.10, 2026-10-27), for the nine categories
 * the code knows. Prod's five custom ones (character 1.5, object 0.25, mode
 * 1.5, mechanics 0, perspective 0) live only in D1.
 */
const TUNED_CATEGORY_WEIGHTS: Record<string, number> = {
  genre: 0, setting: 1.5, artstyle: 0, mood: 1, theme: 1, audience: 0.25, other: 0.5,
};

// Mirror of tags.ts's CATEGORIES with the tuned weights: `meta` and `source`
// stay ignored (weight 0).
export const DEFAULT_TAG_CATEGORIES: TagCategorySeed[] = CATEGORIES.map((c, i) => ({
  id: c.id,
  label: c.label,
  color: c.color,
  weight: c.defaultIgnored ? 0 : TUNED_CATEGORY_WEIGHTS[c.id] ?? 1,
  ignored: !!c.defaultIgnored,
  sortOrder: i,
}));
