// The Fandex Score, computed on the device.
//
// Since 2026-10-27 the score is one number that means one thing: what you
// would probably rate this, times ten (docs/fandex-score.md §1, §3.3). It
// starts from your average rating for the title's medium and moves by the
// taste axis, your ratings of titles carrying each facet against your own
// average (the 2026-07 maths), with the gain fitted so that the number lands
// on what you gave on titles you rated (§3.10). Measured on the owner's
// library: within one point of his rating 44% of the time on films, where
// guessing his average does it 41%; 70 to 75 meant 7.4, 80 and up 8.4.
//
// Pull, "do you seek this kind of thing out?" (your picks against ordinary
// titles, pullModel.ts), is NOT in the number since the same day: on a title
// you rated it reads high almost by construction, so it added an offset, not
// information (off by 1.63 with it, 1.40 without). It is still computed and
// said beside the number, with its rows in the Why sheet.
//
// The taste rows sum to the score, so the breakdown IS the computation.
//
// Everything here is a pure function of what the device already holds: the
// titles you rated and consumed, with the catalog copy's facets; the taxonomy
// the Worker serves; the facets of the title being scored. Keep it erasable
// TypeScript importing through `@/` only: scripts/score-backtest.mjs loads it
// under plain Node to measure a change against real ratings before it ships.
//
// What the score must never read is unchanged (spec §4): community ratings,
// popularity, release dates, episodes watched or playtime. A title you rated
// is scored without its own rating, and without its own place in the pull
// counts (leave-one-out, exact, since only this title's facets enter).

import { DEFAULT_SCORING_CONFIG, type ScoringConfigValues } from '@/lib/scoringDefaults';
import { fitPullModelSteps, timesAverage, type PullModel, type PullPick, type PullTitle, type StoredPullFit } from './pullModel';
import { drain, type Steps } from './timeSlice';

export interface ScoreFacet {
  kind: 'tag' | 'person' | 'company' | 'ip';
  key: string;
  label: string;
  role?: string;
  category?: string;
  /** Cast billing weight, 1 for a lead down to a floor for a bit part. Absent means 1. */
  prominence?: number;
  /** A game's franchise only: its IGDB collections, the series inside the franchise. [] is none, absent is not known (src/lib/facets.ts). */
  series?: string[];
  /** A tag's tier (genre, theme, voted, keyword) and its rank within it on this title (src/lib/facets.ts, 2026-10-25). Absent on a facet derived before, which counts in full. */
  tier?: string;
  rank?: number;
}

/** `/v1/taxonomy`, as the Worker answers it. */
export interface TaxonomyJson {
  tagCategories: { id: string; label: string; color: string; weight: number; ignored: number | boolean; sortOrder: number }[];
  tagCategoryOverrides: [string, string][];
  tagAliases: [string, string][];
  ipAliases: [string, string][];
  itemIpOverrides: { mediaItemId: string; ipKey: string; label: string; mode: string; source: string }[];
  facetLabels: [string, string, string][];
  scoring: { config: Partial<ScoringConfigValues>; version: number } | null;
}

export interface Taxonomy {
  config: ScoringConfigValues;
  categories: Map<string, { label: string; weight: number; ignored: boolean }>;
  tagCategoryOverrides: Map<string, string>;
  tagAliases: Map<string, string>;
  ipAliases: Map<string, string>;
  ipOverrides: Map<string, { ipKey: string; label: string; mode: 'add' | 'remove' }[]>;
  /** `kind|key` → the display name somebody chose. */
  labels: Map<string, string>;
}

export function prepareTaxonomy(json: TaxonomyJson): Taxonomy {
  const stored = json.scoring?.config ?? {};
  // The site's merge: defaults, then what is stored, with the two per-key maps
  // spread the same way so a role or medium added after the row was written
  // still has a weight.
  const config: ScoringConfigValues = {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    roleWeights: { ...DEFAULT_SCORING_CONFIG.roleWeights, ...(stored.roleWeights ?? {}) },
    tagTierWeights: { ...DEFAULT_SCORING_CONFIG.tagTierWeights, ...(stored.tagTierWeights ?? {}) },
  };
  const ipOverrides: Taxonomy['ipOverrides'] = new Map();
  for (const o of json.itemIpOverrides) {
    const list = ipOverrides.get(o.mediaItemId) ?? [];
    list.push({ ipKey: o.ipKey, label: o.label, mode: o.mode === 'remove' ? 'remove' : 'add' });
    ipOverrides.set(o.mediaItemId, list);
  }
  return {
    config,
    categories: new Map(json.tagCategories.map((c) => [c.id, { label: c.label, weight: c.weight, ignored: !!c.ignored }])),
    tagCategoryOverrides: new Map(json.tagCategoryOverrides),
    tagAliases: new Map(json.tagAliases),
    ipAliases: new Map(json.ipAliases),
    ipOverrides,
    labels: new Map(json.facetLabels.map(([kind, key, label]) => [`${kind}|${key}`, label])),
  };
}

export const facetId = (f: { kind: string; role?: string; key: string }) => `${f.kind}|${f.role ?? ''}|${f.key}`;

/** tagAlias.ts → applyTagAliases: bundled spellings become one tag, counted once. */
function applyTagAliases(facets: ScoreFacet[], tax: Taxonomy): ScoreFacet[] {
  if (tax.tagAliases.size === 0 && tax.labels.size === 0) return facets;
  const out: ScoreFacet[] = [];
  const at = new Map<string, number>();
  for (const f of facets) {
    if (f.kind !== 'tag') { out.push(f); continue; }
    const canonical = tax.tagAliases.get(f.key) ?? f.key;
    const label = tax.labels.get(`tag|${canonical}`) ?? f.label;
    const remapped = canonical === f.key && label === f.label ? f : { ...f, key: canonical, label };
    const id = facetId(remapped);
    const i = at.get(id);
    if (i === undefined) {
      at.set(id, out.length);
      out.push(remapped);
    } else if (f.key === canonical && !tax.labels.has(`tag|${canonical}`)) {
      out[i] = { ...out[i], label: f.label };
    }
  }
  return out;
}

/** ipAlias.ts → applyIpFacets: franchise bundles, and the per-title attach and detach. */
function applyIpFacets(facets: ScoreFacet[], itemId: string | null, tax: Taxonomy): ScoreFacet[] {
  const mine = itemId ? tax.ipOverrides.get(itemId) : undefined;
  if (tax.ipAliases.size === 0 && !mine && tax.labels.size === 0) return facets;
  const removed = new Set((mine ?? []).filter((o) => o.mode === 'remove').map((o) => tax.ipAliases.get(o.ipKey) ?? o.ipKey));

  const out: ScoreFacet[] = [];
  const seen = new Set<string>();
  const push = (f: ScoreFacet) => {
    const id = facetId(f);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(f);
  };
  for (const f of facets) {
    if (f.kind !== 'ip') { out.push(f); continue; }
    const canonical = tax.ipAliases.get(f.key) ?? f.key;
    if (removed.has(canonical)) continue;
    const label = tax.labels.get(`ip|${canonical}`) ?? f.label;
    push(canonical === f.key && label === f.label ? f : { ...f, key: canonical, label });
  }
  for (const o of mine ?? []) {
    if (o.mode !== 'add') continue;
    const canonical = tax.ipAliases.get(o.ipKey) ?? o.ipKey;
    if (removed.has(canonical)) continue;
    push({ kind: 'ip', role: 'ip', key: canonical, label: tax.labels.get(`ip|${canonical}`) ?? o.label });
  }
  return out;
}

/** A title's facets as the score reads them: the catalog's raw facets with the taxonomy applied. */
export function resolveFacets(raw: ScoreFacet[], itemId: string | null, tax: Taxonomy): ScoreFacet[] {
  return applyIpFacets(applyTagAliases(raw, tax), itemId, tax);
}

/**
 * The weight a facet's class carries, or 0 for one the score ignores (a tag in
 * an ignored category, or one whose category weighs nothing). The taxonomy's
 * category wins over the facet's own; a role reads `roleWeights`.
 */
export function classWeightOf(f: ScoreFacet, tax: Taxonomy): { weight: number; category?: string } {
  if (f.kind === 'tag') {
    const category = tax.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other';
    const cat = tax.categories.get(category);
    if (cat?.ignored || cat?.weight === 0) return { weight: 0, category };
    return { weight: cat?.weight ?? 1, category };
  }
  return { weight: tax.config.roleWeights[f.role ?? 'tag'] ?? 1, category: f.category };
}

/**
 * How strongly THIS title carries a facet, apart from the facet's class: a
 * cast member's billing, and a tag's tier (a keyword counts less than a genre
 * or a voted tag, §3.9). Applied when learning from a rated title and when
 * scoring one, so both sides weigh an occurrence the same way. 1 for a facet
 * that carries neither.
 */
export function occurrenceWeight(f: ScoreFacet, tax: Taxonomy): number {
  const tier = f.kind === 'tag' && f.tier ? (tax.config.tagTierWeights[f.tier] ?? 1) : 1;
  return (f.prominence ?? 1) * tier;
}

// ── The taste profile ────────────────────────────────────────────────────────

export interface RatedTitle {
  id: string;
  /** Your score, 0-10: the average across the providers that hold one. */
  rating: number;
  /** The catalog's raw facets for the title. */
  facets: ScoreFacet[];
  /**
   * The medium, for the rating offset (§3.1): you rate games 7.3 and films 6.4,
   * and without the offset that gap leaks into every tag games carry. Absent
   * means the rating is taken as it is.
   */
  type?: string;
}

/** A title you picked: in your library, or on your wishlist at a lower weight. */
export interface ConsumedTitle {
  id: string;
  /** The medium. A pick without one stays out of the pull model, which compares within a medium. */
  type?: string;
  facets: ScoreFacet[];
  /** 1 for a title in your library, `WISHLIST_WEIGHT` for one you only wishlisted. */
  weight: number;
}

/** A baseline title as the device holds it: one of the ordinary titles drawn at random (worker/src/baseline.ts). */
export interface BaselineTitle {
  id: string;
  type: string;
  facets: ScoreFacet[];
  /** The draw itself put it in the pool (the Worker's `added`): tagged by today's pipeline alone (pullModel.ts). */
  fresh?: boolean;
}

/** What a follow does to a facet's pull: `follow` sets it to the strongest anyone has, `avoid` to the weakest. */
export type FollowMode = 'follow' | 'avoid';

/** A wishlisted title is half the evidence a consumed one is: you chose it, you have not been through it. */
export const WISHLIST_WEIGHT = 0.5;
/** Folds for scoring your own picks with a model that did not see them (pullModel.ts). */
export const PULL_FOLDS = 5;

interface FacetMeta {
  kind: string;
  role?: string;
  key: string;
  label: string;
  category?: string;
  classWeight: number;
  /** Your Bayesian average for titles carrying this facet. */
  BA: number;
  /** How many of your rated titles carry it. */
  n: number;
  /** The sums BA is made of, kept so one title can be taken back out (leave-one-out). */
  weightedSum: number;
  weightedCount: number;
}

export interface Profile {
  /** facet id → deviation from your baseline × the facet's class weight. */
  w: Map<string, number>;
  meta: Map<string, FacetMeta>;
  /** Your mean rating, 0-10. */
  baseline: number;
  ratedItemCount: number;
  /** Your rating per rated title id (after the medium offset), so scoring one of them can leave it out. */
  ratings: Map<string, number>;
  /** The sum of every (offset) rating, for the baseline without one title. */
  ratingSum: number;
  /** Your mean rating per medium, before the offset. Empty when the titles came without a medium. */
  typeMeans: Map<string, number>;
  /** The sums behind `typeMeans`, so a medium's centre can be read without one title (`centreFor`). */
  typeStats: Map<string, { sum: number; n: number }>;
  /** Your rating per rated title as you gave it, with its medium, for the centre without that title. */
  rawRatings: Map<string, { rating: number; type?: string }>;
  /** The sum of every rating as given. */
  rawSum: number;
  /** The pull model (pullModel.ts), or null when the device holds no baseline yet: then there is no pull axis. */
  pull: PullModel | null;
  /** Your picks by id, with their medium and weight, so scoring one of them leaves it out of its own sentence. */
  picks: Map<string, { type: string; weight: number }>;
  follows: Map<string, FollowMode>;
  /** What a follow sets a facet's coefficient to: the strongest one in the model, and never under a doubling. */
  followBeta: number;
}

/** Below this many rated titles there is no score at all, rather than one built on two samples. */
export const MIN_RATED_FOR_FANDEX_SCORE = 3;

/**
 * The facet ids the pull model reads off a title: every facet the taxonomy
 * resolves, except tags in an IGNORED category (platforms, provider noise).
 * Category, role and tier weights are the taste axis's: the model weighs each
 * facet itself, and a category zeroed for taste can still be what you seek out
 * (anime is filed under art style, which weighs 0 for taste since 2026-10-25).
 */
export function pullFacetIds(raw: ScoreFacet[], itemId: string | null, tax: Taxonomy): string[] {
  const out = new Set<string>();
  for (const f of resolveFacets(raw, itemId, tax)) {
    if (f.kind === 'tag' && tax.categories.get(tax.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other')?.ignored) continue;
    out.add(facetId(f));
  }
  return [...out];
}

/**
 * Fit the pull model: your picks against the baseline (§3.7). Seconds on a
 * phone for a big library, so a caller keeps it until the picks, the baseline
 * or the taxonomy change, and the device runs `buildPullModelSteps` in slices
 * (timeSlice.ts) rather than this. Null without a baseline, or with no medium
 * both have.
 */
export function buildPullModel(picks: ConsumedTitle[], baseline: BaselineTitle[], tax: Taxonomy): PullModel | null {
  return drain(buildPullModelSteps(picks, baseline, tax));
}

/** Titles resolved between two yields of `buildPullModelSteps`. */
const RESOLVE_EVERY = 200;

/** `stored`: a fit made on exactly these picks, baseline and taxonomy, reused in place of fitting (pullModel.ts `fitPullModelSteps`). */
export function* buildPullModelSteps(picks: ConsumedTitle[], baseline: BaselineTitle[], tax: Taxonomy, stored?: StoredPullFit): Steps<PullModel | null> {
  if (!baseline.length) return null;
  const pickRows: PullPick[] = [];
  for (const t of picks) {
    if (!t.type) continue;
    if (pickRows.length % RESOLVE_EVERY === RESOLVE_EVERY - 1) yield;
    pickRows.push({ id: t.id, type: t.type, weight: t.weight, facets: pullFacetIds(t.facets, t.id, tax) });
  }
  const baselineRows: PullTitle[] = [];
  for (const t of baseline) {
    if (baselineRows.length % RESOLVE_EVERY === RESOLVE_EVERY - 1) yield;
    baselineRows.push({ id: t.id, type: t.type, facets: pullFacetIds(t.facets, t.id, tax), ...(t.fresh ? { fresh: true } : {}) });
  }
  return yield* fitPullModelSteps(pickRows, baselineRows, { l1: tax.config.pullL1, l2: tax.config.pullL2, folds: PULL_FOLDS }, stored);
}

export function buildProfile(
  rated: RatedTitle[],
  tax: Taxonomy,
  extras: { consumed?: ConsumedTitle[]; pull?: PullModel | null; follows?: Map<string, FollowMode> } = {},
): Profile {
  // The medium offset: each rating is moved by the gap between its medium's
  // average and your overall average, so a facet's deviation is about the
  // facet and not about the medium. The mean of the moved ratings is still
  // your overall average, so the centre does not move.
  const typeSums = new Map<string, { sum: number; n: number }>();
  const rawRatings = new Map<string, { rating: number; type?: string }>();
  let rawSum = 0;
  for (const item of rated) {
    rawSum += item.rating;
    rawRatings.set(item.id, { rating: item.rating, ...(item.type ? { type: item.type } : {}) });
    if (!item.type) continue;
    const t = typeSums.get(item.type) ?? { sum: 0, n: 0 };
    t.sum += item.rating; t.n++;
    typeSums.set(item.type, t);
  }
  const overall = rated.length ? rawSum / rated.length : 0;
  const typeMeans = new Map<string, number>();
  for (const [type, t] of typeSums) typeMeans.set(type, t.sum / t.n);
  const adjusted = (item: RatedTitle) => (item.type && typeMeans.has(item.type) ? item.rating - (typeMeans.get(item.type) as number) + overall : item.rating);

  const stats = new Map<string, { kind: string; role?: string; key: string; label: string; category?: string; count: number; weightedCount: number; weightedSum: number }>();
  const ratings = new Map<string, number>();
  let ratingSum = 0;
  for (const item of rated) {
    const rating = adjusted(item);
    ratingSum += rating;
    ratings.set(item.id, rating);
    for (const f of resolveFacets(item.facets, item.id, tax)) {
      const id = facetId(f);
      const prominence = occurrenceWeight(f, tax);
      const st = stats.get(id);
      if (st) {
        st.count++;
        st.weightedCount += prominence;
        st.weightedSum += rating * prominence;
      } else {
        const category = f.kind === 'tag' ? (tax.tagCategoryOverrides.get(f.key) ?? f.category) : f.category;
        stats.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category, count: 1, weightedCount: prominence, weightedSum: rating * prominence });
      }
    }
  }
  const baseline = rated.length ? ratingSum / rated.length : 0;
  const C = tax.config.priorStrength;

  const w = new Map<string, number>();
  const meta = new Map<string, FacetMeta>();
  for (const [id, f] of stats) {
    const { weight: classWeight, category } = classWeightOf({ kind: f.kind as ScoreFacet['kind'], role: f.role, key: f.key, label: f.label, category: f.category }, tax);
    // An ignored category (platform and noise tags) is left out entirely.
    if (!classWeight) continue;
    const BA = (C * baseline + f.weightedSum) / (C + f.weightedCount);
    w.set(id, (BA - baseline) * classWeight);
    meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category, classWeight, BA, n: f.count, weightedSum: f.weightedSum, weightedCount: f.weightedCount });
  }

  // Pull: the model is fitted by the caller (buildPullModel), which keeps it
  // while only ratings change. Your picks are kept by id for the sentences.
  const picks = new Map<string, { type: string; weight: number }>();
  for (const item of extras.consumed ?? []) if (item.type && !picks.has(item.id)) picks.set(item.id, { type: item.type, weight: item.weight });
  const pull = extras.pull ?? null;
  let strongest = 0;
  for (const b of pull?.beta.values() ?? []) strongest = Math.max(strongest, Math.abs(b));

  return {
    w, meta, baseline, ratedItemCount: rated.length, ratings, ratingSum, typeMeans, typeStats: typeSums, rawRatings, rawSum,
    pull, picks, follows: extras.follows ?? new Map(), followBeta: Math.max(Math.LN2, strongest),
  };
}

/** Below this many ratings in a medium, a title of it scores from your overall average instead of the medium's. */
export const MIN_RATED_FOR_MEDIUM_CENTRE = 10;

/**
 * Your average rating for a medium, 0 to 10: the centre a title of that medium
 * scores from (§3.3, since 2026-10-27). You rate games 7.3 and films 6.4, and
 * one centre for both read every game half a point low. Your overall average
 * when the medium has too few ratings to have one of its own, or the title has
 * no medium. `leaveOut` is a title you rated: its own rating is taken out.
 */
export function centreFor(profile: Profile, type: string | undefined, leaveOut?: { id: string }): number {
  const own = leaveOut ? profile.rawRatings.get(leaveOut.id) : undefined;
  const ts = type ? profile.typeStats.get(type) : undefined;
  if (ts) {
    const mine = own && own.type === type ? own.rating : undefined;
    const n = ts.n - (mine === undefined ? 0 : 1);
    if (n >= MIN_RATED_FOR_MEDIUM_CENTRE) return (ts.sum - (mine ?? 0)) / n;
  }
  const n = profile.ratedItemCount - (own === undefined ? 0 : 1);
  return n > 0 ? (profile.rawSum - (own?.rating ?? 0)) / n : 0;
}

/**
 * What a facet is worth on any title that carries it, whatever else the title
 * has: the site's facetImpact (discovery.ts). For cast this is the lead-billed
 * value, since billing belongs to a title and not to the person.
 */
export function facetImpact(id: string, profile: Profile, tax: Taxonomy): number | null {
  const w = profile.w.get(id);
  if (w == null) return null;
  const gain = w >= 0 ? tax.config.mappingConstantUp : tax.config.mappingConstantDown;
  return Math.round(gain * w * 10) / 10;
}

// ── Pull ─────────────────────────────────────────────────────────────────────

export interface FacetPull {
  /** The model's coefficient (natural log): how much more often a title with it is one of your picks, other facets held equal. A follow sets it. */
  beta: number;
  /** The coefficient as points, `pullGain` per doubling. Said beside the score, never in it (2026-10-27). */
  points: number;
  /** From the plain counts: how many times more often (above 1) or less often (below 1) your picks carry it than the baseline says they would. */
  times: number;
  /** How many of your picks carry it, and their media, for "88 of your films". */
  titles: number;
  media: string[];
  followed?: FollowMode;
}

/**
 * A facet's pull, or null when it has none: there is no model yet, the model
 * holds it at zero (too little evidence, or another facet explains the titles
 * it is on, as anime explains firefighter), or the model and the plain count
 * disagree on its direction. A row the score counts is a row the reader can
 * check against the counts, and nothing else moves the score (Nils,
 * 2026-10-26: "don't let firefighter influence the pull if it's explained by
 * anime, therefore don't show it either").
 *
 * `leaveOut` is a title you picked, scored by the model that did not see it
 * and left out of its own counts.
 */
export function facetPull(f: ScoreFacet, profile: Profile, tax: Taxonomy, leaveOut?: { id: string }): FacetPull | null {
  const model = profile.pull;
  if (!model) return null;
  const id = facetId(f);
  const pick = leaveOut ? profile.picks.get(leaveOut.id) : undefined;
  const fold = pick ? model.foldOf.get(leaveOut!.id) : undefined;
  let beta = (fold !== undefined ? model.foldBeta[fold] : model.beta)?.get(id) ?? 0;
  const followed = profile.follows.get(id);
  if (followed === 'follow') beta = Math.max(beta, profile.followBeta);
  else if (followed === 'avoid') beta = Math.min(beta, -profile.followBeta);
  if (beta === 0) return null;
  const plain = timesAverage(model, id, pick);
  if (!followed && (!plain || Math.sign(Math.log(plain.times)) !== Math.sign(beta))) return null;
  return {
    beta,
    points: Math.round(((tax.config.pullGain * beta) / Math.LN2) * 10) / 10,
    times: plain?.times ?? 1,
    titles: plain?.titles ?? 0,
    media: [...(plain?.media ?? [])],
    ...(followed ? { followed } : {}),
  };
}

/** Whether the pull axis can speak about a title of this medium: a model exists and compared this medium with a baseline. */
export function hasPullFor(profile: Profile, type?: string): boolean {
  return !!profile.pull && (!type || profile.pull.media.has(type));
}

// ── Scoring one title ────────────────────────────────────────────────────────

/**
 * How far a score may move from your average, bent so it never passes 100 or
 * 0. Unchanged up to halfway to the edge, which is where nearly every score
 * sits (unseen films read 48 to 75 around a centre of 64, 2026-10-27), then a
 * tanh that meets the edge only in the limit: a strong match still outranks a
 * slightly weaker one, nothing reads 101. `offset` is the points the facets
 * add to the centre; the answer is the same kind of number.
 */
export function softRange(center: number, offset: number): number {
  const room = offset >= 0 ? 100 - center : center;
  if (room <= 0) return 0;
  const knee = room / 2;
  const size = Math.abs(offset);
  if (size <= knee) return offset;
  return Math.sign(offset) * (knee + (room - knee) * Math.tanh((size - knee) / (room - knee)));
}

export type ScoreAxis = 'taste' | 'pull';
/**
 * Where a number sits against your usual: `high` at or above the margin over
 * it, `low` at or below. For the score it is the taste band margin (§3.8),
 * what colours a badge and fills Home's Recommended rail; for the pull axis
 * its own margin.
 */
export type ScoreBand = 'high' | 'usual' | 'low';
export type AxisBand = ScoreBand;

export interface ScoreReason {
  axis: ScoreAxis;
  kind: string;
  role?: string;
  /** The facet's key, so `facetId(reason)` is the id the profile and a follow use. */
  key: string;
  label: string;
  category?: string;
  /** Points this facet added to or took from the score. 0 when it was not counted, and always 0 on a pull row: pull is said beside the number, never in it. */
  contribution: number;
  /** What the facet is worth on any title, counted or not; on a pull row, its pull points. */
  impact: number;
  /** Taste: your average rating for titles carrying it, and how many there are. 0 on a pull row. */
  BA: number;
  n: number;
  /** Outside the top few for this title: shown, not counted. */
  capped?: boolean;
  /** A tag row: its tier on this title, so the sheet can say "core" or "detail". */
  tier?: string;
  /** Pull rows only: how many times more (above 1) or less (below 1) often your picks carry it than average, and how many of them do, in which media. */
  times?: number;
  titles?: number;
  media?: string[];
  followed?: FollowMode;
}

export interface AxisResult {
  /** Taste: the points the score sits off the centre, after the bend. Pull: its own points, `pullGain` per doubling, not in the score. */
  points: number;
  band: AxisBand;
}

export interface PullResult extends AxisResult {
  /** How many times more often (above 1) or less often (below 1) a title like this is one of your picks, by the model: e to the sum of its coefficients. */
  times: number;
}

export interface FandexScore {
  /** What you would probably rate this, times ten. */
  score: number;
  /** Your average rating for the medium, times ten (`centreFor`): the score of a title the facets say nothing about. */
  center: number;
  /** Your average over everything, times ten, with this title left out: what every row's "you rate it 7.6" is measured against (§3.1). */
  usual: number;
  /** Where the score sits against the centre, by the taste band margin. */
  band: ScoreBand;
  taste: AxisResult;
  /** How often you pick this kind of thing, said beside the number. Null when the device holds no baseline for this medium yet. */
  pull: PullResult | null;
  reasons: ScoreReason[];
  /** A title you rated, scored with your rating of it left out. */
  leftOut?: boolean;
}

export const bandOf = (points: number, margin: number): ScoreBand => (points >= margin ? 'high' : points <= -margin ? 'low' : 'usual');

interface Contrib { f: ScoreFacet; dev: number; classWeight: number; meta: FacetMeta }
interface PullContrib { f: ScoreFacet; pull: FacetPull; value: number }

/**
 * Score one title. `facets` are the catalog's raw facets; the taxonomy is
 * applied here, as the site applies it inside computeFandexScore, so no caller
 * can score a title against keys the profile did not learn under. `type` is
 * the title's medium: the centre is your average for it (`centreFor`), and
 * without it the centre is your overall average.
 */
export function computeFandexScore(facets: ScoreFacet[], itemId: string | null, profile: Profile, tax: Taxonomy, type?: string): FandexScore | null {
  // A title you rated is scored as if you had not (decided 2026-10-23): its own
  // rating left out of the centre and of every facet it carries. Read with
  // its own rating in, The Last of Us Part I scored 101, +11.3 of it from a
  // franchise average its own 10 had raised. Only this title's facets enter the
  // score, so taking it out of those is the whole leave-one-out, exactly.
  const own = itemId != null ? profile.ratings.get(itemId) : undefined;
  const ratedCount = profile.ratedItemCount - (own === undefined ? 0 : 1);
  if (profile.w.size === 0 || ratedCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  const cfg = tax.config;
  // The offset average every facet's deviation is measured from (§3.1), not the centre the score starts at.
  const baseline = own === undefined ? profile.baseline : (profile.ratingSum - own) / ratedCount;
  const resolved = resolveFacets(facets, itemId, tax);

  const matched: Contrib[] = [];
  for (const f of resolved) {
    const id = facetId(f);
    const stored = profile.meta.get(id);
    if (profile.w.get(id) == null || !stored?.classWeight) continue;
    let meta = stored;
    if (own !== undefined) {
      const p = occurrenceWeight(f, tax);
      const weightedCount = stored.weightedCount - p;
      // A facet only this title carried has no evidence left.
      if (stored.n <= 1 || weightedCount <= 0) continue;
      const weightedSum = stored.weightedSum - own * p;
      const C = cfg.priorStrength;
      meta = { ...stored, n: stored.n - 1, weightedSum, weightedCount, BA: (C * baseline + weightedSum) / (C + weightedCount) };
    }
    // THIS title's cast billing, or its tag's tier, scales what the facet is worth here.
    matched.push({ f, dev: meta.BA - baseline, classWeight: meta.classWeight * occurrenceWeight(f, tax), meta });
  }

  // The pull rows: every facet the model gives weight to, for a title you
  // picked from the model that did not see it. Tags in an ignored category are
  // not facets to the model (pullFacetIds).
  const leaveOut = itemId != null && profile.picks.has(itemId) ? { id: itemId } : undefined;
  const pulls: PullContrib[] = [];
  const hasPull = hasPullFor(profile, type);
  let pullBeta = 0;
  if (hasPull) {
    const ids = new Set(pullFacetIds(facets, itemId, tax));
    for (const f of resolved) {
      if (!ids.delete(facetId(f))) continue;
      const pull = facetPull(f, profile, tax, leaveOut);
      if (pull) { pulls.push({ f, pull, value: pull.points }); pullBeta += pull.beta; }
    }
  }
  if (!matched.length && !pulls.length) return null;

  // Selected by the same quantity the score is made of (spec §3.3).
  const weighted = (c: Contrib) => c.dev * c.classWeight;
  const byMagnitude = <T,>(list: T[], value: (x: T) => number) => [...list].sort((a, b) => Math.abs(value(b)) - Math.abs(value(a)));
  const tags = matched.filter((c) => c.f.kind === 'tag');
  const tagsPositive = tags.filter((c) => c.dev > 0).sort((a, b) => weighted(b) - weighted(a));
  const tagsNegative = tags.filter((c) => c.dev < 0).sort((a, b) => weighted(a) - weighted(b));
  const people = byMagnitude(matched.filter((c) => c.f.kind === 'person'), weighted);
  const companies = byMagnitude(matched.filter((c) => c.f.kind === 'company'), weighted);
  const ips = byMagnitude(matched.filter((c) => c.f.kind === 'ip'), weighted);

  const kept = [
    ...tagsPositive.slice(0, cfg.topTagsPositive),
    ...tagsNegative.slice(0, cfg.topTagsNegative),
    ...people.slice(0, cfg.topPeople),
    ...companies.slice(0, cfg.topCompanies),
    ...ips.slice(0, cfg.topIps),
  ];
  const capped = [
    ...tagsPositive.slice(cfg.topTagsPositive),
    ...tagsNegative.slice(cfg.topTagsNegative),
    ...people.slice(cfg.topPeople),
    ...companies.slice(cfg.topCompanies),
    ...ips.slice(cfg.topIps),
    ...tags.filter((c) => c.dev === 0),
  ];

  // Every pull row shows: the model has already picked which facets carry
  // weight and shared the credit among the ones that come together, so there
  // is no top few to choose here. None of them is in the number.
  const pullKept = pulls;

  // A raw sum, not a mean (spec §3.3), times the gain fitted to your ratings
  // (§3.10), from your average for the medium; then bent so 100 is the max
  // and 0 the min (decided 2026-10-23). Every counted row shrinks by the same
  // share, so the breakdown still adds up to the score.
  const tasteSum = kept.reduce((acc, c) => acc + weighted(c), 0);
  const center = centreFor(profile, type, own === undefined || itemId == null ? undefined : { id: itemId }) * 10;
  const gain = tasteSum >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  const tasteRaw = gain * tasteSum;
  const bent = softRange(center, tasteRaw);
  const share = tasteRaw === 0 ? 1 : bent / tasteRaw;
  const pullRaw = pullKept.reduce((acc, p) => acc + p.value, 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // What the facet is worth on any title; for a title you rated, without that title.
  const impactOf = (c: Contrib) => (own === undefined
    ? facetImpact(facetId(c.f), profile, tax) ?? 0
    : round1((c.dev * c.meta.classWeight >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown) * c.dev * c.meta.classWeight));
  const tasteReason = (c: Contrib, counted: boolean): ScoreReason => ({
    axis: 'taste', kind: c.f.kind, role: c.f.role, key: c.f.key, label: c.f.label, category: c.meta.category ?? c.f.category,
    contribution: counted ? round1(gain * weighted(c) * share) : 0,
    impact: impactOf(c), BA: c.meta.BA, n: c.meta.n,
    ...(c.f.tier ? { tier: c.f.tier } : {}),
    ...(counted ? {} : { capped: true }),
  });
  const pullReason = (p: PullContrib): ScoreReason => ({
    axis: 'pull', kind: p.f.kind, role: p.f.role, key: p.f.key, label: p.f.label, category: classWeightOf(p.f, tax).category ?? p.f.category,
    contribution: 0,
    impact: p.pull.points, BA: 0, n: p.pull.titles,
    times: p.pull.times, titles: p.pull.titles, media: p.pull.media,
    ...(p.f.tier ? { tier: p.f.tier } : {}),
    ...(p.pull.followed ? { followed: p.pull.followed } : {}),
  });

  // The score's band reads the bent points, the ones the number shows, so a
  // green badge always sits at least the margin over the centre. Pull's band
  // reads its own points against its own margin.
  const band = bandOf(bent, cfg.tasteBandMargin);
  const taste: AxisResult = { points: round1(bent), band };
  const pull: PullResult | null = hasPull
    ? { points: round1(pullRaw), band: bandOf(pullRaw, cfg.pullBandMargin), times: Math.round(Math.exp(pullBeta) * 100) / 100 }
    : null;

  return {
    score: round1(center + bent),
    center: round1(center),
    usual: round1(baseline * 10),
    band, taste, pull,
    ...(own === undefined ? {} : { leftOut: true }),
    reasons: [
      ...[...kept].sort((a, b) => weighted(b) - weighted(a)).map((c) => tasteReason(c, true)),
      ...[...pullKept].sort((a, b) => b.value - a.value).map((p) => pullReason(p)),
      ...[...capped].sort((a, b) => Math.abs(weighted(b)) - Math.abs(weighted(a))).map((c) => tasteReason(c, false)),
    ],
  };
}
