// The Fandex Score, computed on the device.
//
// Since 2026-10-25 the score answers one question, "how much more likely than
// usual are you to love this?", from two axes (docs/fandex-score.md §3):
//
//   taste  "do you rate this kind of thing well?"   your ratings of titles
//          carrying each facet, against your own average (the 2026-07 maths)
//   pull   "do you seek this kind of thing out?"    how much of the catalog's
//          titles carrying each facet you have consumed, against your usual
//          share of the catalog
//
// Both are sums of named rows, so the breakdown IS the computation. The label
// ("sure thing", "hidden gem", "bycatch", "not for you", "your usual") is where
// the two axes land against your usual; the number underneath ranks rails and
// feeds the admin goalpost chart, and is not shown as a number any more.
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
    pullWeight: { ...DEFAULT_SCORING_CONFIG.pullWeight, ...(stored.pullWeight ?? {}) },
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

/** A title you consumed: in your library, or on your wishlist at a lower weight. */
export interface ConsumedTitle {
  id: string;
  facets: ScoreFacet[];
  /** 1 for a title in your library, `WISHLIST_WEIGHT` for one you only wishlisted. */
  weight: number;
}

/**
 * `/catalog/reference.json`: facet counts over the most popular titles per
 * medium, from the providers (mobile/web/referencePopulation.mjs). What "the
 * catalog" looks like when it is not one person's library (§3.7).
 */
export interface ReferenceJson {
  version: number;
  builtAt: string;
  /** Per medium: how many titles, and every facet on two or more of them as [kind, role, key, count]. */
  media: Record<string, { total: number; facets: [string, string, string, number][] }>;
}

/** What the catalog copy holds, as the pull's denominator (§3.7). */
export interface CatalogCounts {
  /** Titles in the catalog copy, every medium. */
  total: number;
  /** Facet id (after the taxonomy) → titles carrying it. */
  byFacet: Map<string, number>;
  /**
   * Facet id → how many titles a catalog this size would carry with it if it
   * were nobody's library: the reference population's share per medium, scaled
   * to the copy's size in that medium, plus the copy's own count on the media
   * the reference does not cover. Only for facets on a covered medium; absent
   * without a reference, when the copy's counts are the denominator.
   */
  expected?: Map<string, number>;
  /** The media the expectation covers. */
  referenceMedia?: string[];
}

/** What a follow does to a facet's pull: `follow` sets it to the maximum, `avoid` to the minimum. */
export type FollowMode = 'follow' | 'avoid';

/** A wishlisted title is half the evidence a consumed one is: you chose it, you have not been through it. */
export const WISHLIST_WEIGHT = 0.5;
/** A facet on fewer catalog titles than this says nothing about pull. */
export const PULL_MIN_CATALOG = 3;

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
  /** Pull: facet id → the weight of the titles you consumed that carry it. */
  consumed: Map<string, number>;
  /** The weight of every title you consumed, so `consumedTotal / catalog.total` is your usual share. */
  consumedTotal: number;
  /** Consumed title id → its weight, so scoring one of them can leave it out. */
  consumedIds: Map<string, number>;
  /** The catalog's counts, or null when the device has not counted it: then there is no pull axis. */
  catalog: CatalogCounts | null;
  follows: Map<string, FollowMode>;
}

/** Below this many rated titles there is no score at all, rather than one built on two samples. */
export const MIN_RATED_FOR_FANDEX_SCORE = 3;

/**
 * The catalog's facet counts, from its rows, with the taxonomy applied so a
 * bundled tag is counted once. With a reference population and rows that
 * carry their medium, also what a catalog this size would carry if it were
 * nobody's (`expected`): the pool's films are 68% the owner's and its shows
 * 97%, so measured against the pool anime lifted him almost nothing, because
 * he had put most of the pool's anime there himself.
 */
export function catalogCountsFrom(rows: { id: string; facets: ScoreFacet[]; type?: string }[], tax: Taxonomy, reference?: ReferenceJson | null): CatalogCounts {
  const byFacet = new Map<string, number>();
  const byType = new Map<string, number>();
  const byFacetType = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.type) byType.set(row.type, (byType.get(row.type) ?? 0) + 1);
    const seen = new Set<string>();
    for (const f of resolveFacets(row.facets, row.id, tax)) {
      const id = facetId(f);
      if (seen.has(id)) continue;
      seen.add(id);
      byFacet.set(id, (byFacet.get(id) ?? 0) + 1);
      if (row.type) {
        const perType = byFacetType.get(id) ?? new Map<string, number>();
        perType.set(row.type, (perType.get(row.type) ?? 0) + 1);
        byFacetType.set(id, perType);
      }
    }
  }
  const counts: CatalogCounts = { total: rows.length, byFacet };
  // How much the reference counts is the scoring config's (`pullReferenceBlend`), so the admin can tune it without a deploy.
  const blend = Math.max(0, Math.min(1, tax.config.pullReferenceBlend ?? 0));
  const covered = reference && blend > 0 ? Object.keys(reference.media).filter((m) => (reference.media[m]?.total ?? 0) > 0 && (byType.get(m) ?? 0) > 0) : [];
  if (!covered.length) return counts;

  // The reference's share of each facet, scaled to this copy's size in that
  // medium, through the taxonomy so a bundled tag lands on the same id.
  const expected = new Map<string, number>();
  for (const medium of covered) {
    const ref = reference!.media[medium];
    const scale = (byType.get(medium) ?? 0) / ref.total;
    for (const [kind, role, key, n] of ref.facets) {
      if (!(n > 0)) continue;
      const raw: ScoreFacet = { kind: kind as ScoreFacet['kind'], key, label: key, ...(role ? { role } : {}) };
      const id = facetId(resolveFacets([raw], null, tax)[0] ?? raw);
      expected.set(id, (expected.get(id) ?? 0) + n * scale);
    }
  }
  // A facet this copy carries on a covered medium is expected as the reference
  // says, zero where the reference lacks it there (rarer than one in two
  // thousand); its titles on the other media count as this copy has them. A
  // facet only on uncovered media keeps the copy's count as its denominator.
  for (const [id, perType] of byFacetType) {
    let outside = 0;
    let onCovered = false;
    for (const [type, n] of perType) {
      if (covered.includes(type)) onCovered = true; else outside += n;
    }
    if (!onCovered && !expected.has(id)) continue;
    expected.set(id, (expected.get(id) ?? 0) + outside);
  }
  // The mix: the copy's own count where the reference counts less than fully.
  if (blend < 1) for (const [id, e] of expected) expected.set(id, blend * e + (1 - blend) * (byFacet.get(id) ?? 0));
  return { ...counts, expected, referenceMedia: covered };
}

export function buildProfile(
  rated: RatedTitle[],
  tax: Taxonomy,
  extras: { consumed?: ConsumedTitle[]; catalog?: CatalogCounts; follows?: Map<string, FollowMode> } = {},
): Profile {
  // The medium offset: each rating is moved by the gap between its medium's
  // average and your overall average, so a facet's deviation is about the
  // facet and not about the medium. The mean of the moved ratings is still
  // your overall average, so the centre does not move.
  const typeSums = new Map<string, { sum: number; n: number }>();
  let rawSum = 0;
  for (const item of rated) {
    rawSum += item.rating;
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

  // Pull: what you consumed, per facet, weighted.
  const consumed = new Map<string, number>();
  const consumedIds = new Map<string, number>();
  let consumedTotal = 0;
  for (const item of extras.consumed ?? []) {
    if (consumedIds.has(item.id)) continue;
    consumedIds.set(item.id, item.weight);
    consumedTotal += item.weight;
    const seen = new Set<string>();
    for (const f of resolveFacets(item.facets, item.id, tax)) {
      const id = facetId(f);
      if (seen.has(id)) continue;
      seen.add(id);
      consumed.set(id, (consumed.get(id) ?? 0) + item.weight);
    }
  }

  return {
    w, meta, baseline, ratedItemCount: rated.length, ratings, ratingSum, typeMeans,
    consumed, consumedTotal, consumedIds, catalog: extras.catalog ?? null, follows: extras.follows ?? new Map(),
  };
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

/**
 * How specific a facet is: 1 for one on ten catalog titles or fewer, down to
 * a floor for one on most of them ("action"). A broad tag you have consumed
 * all of says less about you than a narrow one.
 */
export function salienceOf(catalogCount: number, catalogTotal: number): number {
  if (catalogTotal <= 10) return 1;
  return Math.min(1, Math.max(0.15, Math.log(catalogTotal / Math.max(1, catalogCount)) / Math.log(catalogTotal / 10)));
}

/**
 * A facet's pull: log2 of your share of the catalog titles carrying it over
 * your usual share, with `prior` pseudo-titles at your usual share so three
 * titles cannot read as "all of them". 0 is your usual; 1 is twice it.
 */
export function pullLift(consumed: number, catalogCount: number, usualShare: number, prior: number): number {
  return Math.log2(((consumed + prior * usualShare) / (catalogCount + prior)) / usualShare);
}

export interface FacetPull {
  /** The weight of your consumed titles carrying it (a wishlisted one counts `WISHLIST_WEIGHT`). */
  consumed: number;
  /** Catalog titles carrying it. */
  catalog: number;
  /** How many a catalog this size would carry if it were nobody's (the reference population, §3.7). Absent when the catalog's own count was the denominator. */
  expected?: number;
  lift: number;
  /** Points on a title of medium `type` (the pull weight of that medium applied), or on one of unknown medium. */
  points: number;
  followed?: FollowMode;
}

/** Your usual share of the catalog, or null when the device has not counted it. */
function usualShare(profile: Profile): number | null {
  if (!profile.catalog || profile.catalog.total <= 0 || profile.consumedTotal <= 0) return null;
  return Math.min(0.95, profile.consumedTotal / profile.catalog.total);
}

/**
 * A facet's pull as a facet page prints it, or null when the catalog has not
 * been counted, the facet sits on too few catalog titles, or the score ignores
 * its class. `leaveOut` takes one consumed title back out, for a title you hold.
 */
export function facetPull(f: ScoreFacet, profile: Profile, tax: Taxonomy, type?: string, leaveOut?: { id: string }): FacetPull | null {
  const share = usualShare(profile);
  if (share == null) return null;
  const { weight: classWeight } = classWeightOf(f, tax);
  if (!classWeight) return null;
  const id = facetId(f);
  let catalog = profile.catalog!.byFacet.get(id) ?? 0;
  let consumed = profile.consumed.get(id) ?? 0;
  if (leaveOut) {
    const own = profile.consumedIds.get(leaveOut.id);
    if (own !== undefined) { catalog -= 1; consumed = Math.max(0, consumed - own); }
  }
  if (catalog < PULL_MIN_CATALOG) return null;
  const cfg = tax.config;
  const followed = profile.follows.get(id);
  const maxLift = Math.log2(1 / share);
  // The denominator: what a catalog this size would carry if it were nobody's
  // library, where the reference population knows the facet's media; the
  // catalog's own count otherwise. Your consumed titles can outnumber the
  // expectation, so the lift is held to the most anyone can seek out.
  const expected = profile.catalog!.expected?.get(id);
  const population = expected ?? catalog;
  const lift = followed === 'follow' ? maxLift : followed === 'avoid' ? -maxLift
    : Math.max(-maxLift, Math.min(maxLift, pullLift(consumed, population, share, cfg.pullPrior)));
  // A tag's tier weighs its pull as it weighs its taste; cast billing does not (a title's choice is a choice, lead or cameo).
  const roleWeight = f.kind === 'tag' ? (f.tier ? (cfg.tagTierWeights[f.tier] ?? 1) : 1) : (cfg.roleWeights[f.role ?? 'tag'] ?? 1);
  const value = lift * salienceOf(population, profile.catalog!.total) * roleWeight;
  const medium = type ? (cfg.pullWeight[type] ?? 1) : 1;
  return {
    consumed, catalog, lift, points: Math.round(cfg.pullGain * medium * value * 10) / 10,
    ...(expected !== undefined ? { expected: Math.round(expected * 10) / 10 } : {}),
    ...(followed ? { followed } : {}),
  };
}

// ── Scoring one title ────────────────────────────────────────────────────────

/**
 * How far a score may move from your average, bent so it never passes 100 or
 * 0. Unchanged up to halfway to the edge, which is where nearly every score
 * sits (the band margin is 10), then a tanh that meets the edge only in the
 * limit: a strong match still outranks a slightly weaker one, nothing reads 101.
 * `offset` is the points the facets add to the centre; the answer is the same
 * kind of number.
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
export type AxisBand = 'high' | 'usual' | 'low';
/** Nils's matrix of 2026-10-25: what to DO with the title, from where the two axes land (docs/fandex-score.md §3.8). */
export type ScoreLabel = 'safe-bet' | 'hidden-gem' | 'tryout' | 'bycatch' | 'skip' | 'usual';

export interface ScoreReason {
  axis: ScoreAxis;
  kind: string;
  role?: string;
  /** The facet's key, so `facetId(reason)` is the id the profile and a follow use. */
  key: string;
  label: string;
  category?: string;
  /** Points this facet added to or took from the score. 0 when it was not counted. */
  contribution: number;
  /** What the facet is worth on any title of this medium, counted or not. */
  impact: number;
  /** Taste: your average rating for titles carrying it, and how many there are. 0 on a pull row. */
  BA: number;
  n: number;
  /** Outside the top few for this title: shown, not counted. */
  capped?: boolean;
  /** A tag row: its tier on this title, so the sheet can say "core" or "detail". */
  tier?: string;
  /** Pull rows only: the titles behind the number. */
  consumed?: number;
  catalog?: number;
  /** Pull rows only: the reference population's expectation for a catalog this size, when it was the denominator. */
  expected?: number;
  lift?: number;
  followed?: FollowMode;
}

export interface AxisResult {
  /** Points this axis moved the score by, after the bend. */
  points: number;
  band: AxisBand;
}

export interface FandexScore {
  score: number;
  /** Your own mean rating × 10: the score of a title you have no opinion about. */
  center: number;
  taste: AxisResult;
  /** Null when the device has not counted its catalog: then there is no pull axis. */
  pull: AxisResult | null;
  label: ScoreLabel;
  reasons: ScoreReason[];
  /** A title you rated, scored with your rating of it left out. */
  leftOut?: boolean;
}

const bandOf = (points: number, margin: number): AxisBand => (points >= margin ? 'high' : points <= -margin ? 'low' : 'usual');

/**
 * Where the two axes land is the label (Nils's matrix, 2026-10-25):
 *
 *                      pull low      pull usual    pull high
 *   taste above usual  hidden gem    hidden gem    safe bet
 *   taste usual        your usual    your usual    tryout
 *   taste below usual  skip          skip          bycatch
 *
 * Without a pull axis the taste axis alone names it: above usual is a hidden gem
 * (you rate this kind well, whether or not you go for it), below usual a skip.
 */
export function labelFor(taste: AxisBand, pull: AxisBand | null): ScoreLabel {
  if (pull === 'high') return taste === 'high' ? 'safe-bet' : taste === 'low' ? 'bycatch' : 'tryout';
  return taste === 'high' ? 'hidden-gem' : taste === 'low' ? 'skip' : 'usual';
}

interface Contrib { f: ScoreFacet; dev: number; classWeight: number; meta: FacetMeta }
interface PullContrib { f: ScoreFacet; pull: FacetPull; value: number }

/**
 * Score one title. `facets` are the catalog's raw facets; the taxonomy is
 * applied here, as the site applies it inside computeFandexScore, so no caller
 * can score a title against keys the profile did not learn under. `type` is
 * the title's medium, for the pull weight; without it pull counts in full.
 */
export function computeFandexScore(facets: ScoreFacet[], itemId: string | null, profile: Profile, tax: Taxonomy, type?: string): FandexScore | null {
  // A title you rated is scored as if you had not (decided 2026-10-23): its own
  // rating left out of the baseline and of every facet it carries. Read with
  // its own rating in, The Last of Us Part I scored 101, +11.3 of it from a
  // franchise average its own 10 had raised. Only this title's facets enter the
  // score, so taking it out of those is the whole leave-one-out, exactly.
  const own = itemId != null ? profile.ratings.get(itemId) : undefined;
  const ratedCount = profile.ratedItemCount - (own === undefined ? 0 : 1);
  if (profile.w.size === 0 || ratedCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  const cfg = tax.config;
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

  // The pull rows: every facet with a catalog count, this title's own place in the counts left out.
  const leaveOut = itemId != null && profile.consumedIds.has(itemId) ? { id: itemId } : undefined;
  const pulls: PullContrib[] = [];
  const hasPull = usualShare(profile) != null;
  if (hasPull) {
    for (const f of resolved) {
      const pull = facetPull(f, profile, tax, type, leaveOut);
      if (pull) pulls.push({ f, pull, value: pull.points });
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

  const pullValue = (p: PullContrib) => p.value;
  const pullTags = byMagnitude(pulls.filter((p) => p.f.kind === 'tag'), pullValue);
  const pullPeople = byMagnitude(pulls.filter((p) => p.f.kind === 'person'), pullValue);
  const pullCompanies = byMagnitude(pulls.filter((p) => p.f.kind === 'company'), pullValue);
  const pullIps = byMagnitude(pulls.filter((p) => p.f.kind === 'ip'), pullValue);
  const pullKept = [
    ...pullTags.slice(0, cfg.pullTopTags), ...pullPeople.slice(0, cfg.pullTopPeople),
    ...pullCompanies.slice(0, cfg.pullTopCompanies), ...pullIps.slice(0, cfg.pullTopIps),
  ];
  const pullCapped = [
    ...pullTags.slice(cfg.pullTopTags), ...pullPeople.slice(cfg.pullTopPeople),
    ...pullCompanies.slice(cfg.pullTopCompanies), ...pullIps.slice(cfg.pullTopIps),
  ];

  // Two raw sums, not means (spec §3.3), then bent together so 100 is the max
  // and 0 the min (decided 2026-10-23). Every counted row shrinks by the same
  // share, so the breakdown still adds up to the score.
  const tasteSum = kept.reduce((acc, c) => acc + weighted(c), 0);
  const center = baseline * 10;
  const gain = tasteSum >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  const tasteRaw = gain * tasteSum;
  const pullRaw = pullKept.reduce((acc, p) => acc + p.value, 0);
  const raw = tasteRaw + pullRaw;
  const bent = softRange(center, raw);
  const share = raw === 0 ? 1 : bent / raw;
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
  const pullReason = (p: PullContrib, counted: boolean): ScoreReason => ({
    axis: 'pull', kind: p.f.kind, role: p.f.role, key: p.f.key, label: p.f.label, category: classWeightOf(p.f, tax).category ?? p.f.category,
    contribution: counted ? round1(p.value * share) : 0,
    impact: p.pull.points, BA: 0, n: Math.round(p.pull.consumed),
    consumed: p.pull.consumed, catalog: p.pull.catalog, lift: p.pull.lift,
    ...(p.pull.expected !== undefined ? { expected: p.pull.expected } : {}),
    ...(p.f.tier ? { tier: p.f.tier } : {}),
    ...(p.pull.followed ? { followed: p.pull.followed } : {}),
    ...(counted ? {} : { capped: true }),
  });

  // The bands read each axis BEFORE the bend: the bend shrinks both axes by
  // the same share, so a strong pull could otherwise squeeze a strong taste
  // under its margin and the label would change with the other axis. The
  // points are after the bend, so the two add up to the score.
  //
  // The pull band also reads the axis before the medium's weight: that weight
  // says how much pull counts in the NUMBER for a game, not whether you seek
  // games out. With it applied, no game ever read as a sure thing.
  const mediumWeight = type ? (cfg.pullWeight[type] ?? 1) : 1;
  const taste: AxisResult = { points: round1(tasteRaw * share), band: bandOf(tasteRaw, cfg.tasteBandMargin) };
  const pull: AxisResult | null = hasPull
    ? { points: round1(pullRaw * share), band: mediumWeight > 0 ? bandOf(pullRaw / mediumWeight, cfg.pullBandMargin) : 'usual' }
    : null;

  return {
    score: round1(center + bent),
    center: round1(center),
    taste, pull,
    label: labelFor(taste.band, pull?.band ?? null),
    ...(own === undefined ? {} : { leftOut: true }),
    reasons: [
      ...[...kept].sort((a, b) => weighted(b) - weighted(a)).map((c) => tasteReason(c, true)),
      ...[...pullKept].sort((a, b) => b.value - a.value).map((p) => pullReason(p, true)),
      ...[...capped].sort((a, b) => Math.abs(weighted(b)) - Math.abs(weighted(a))).map((c) => tasteReason(c, false)),
      ...[...pullCapped].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map((p) => pullReason(p, false)),
    ],
  };
}
