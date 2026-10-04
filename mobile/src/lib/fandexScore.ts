// The Fandex Score, computed on the device.
//
// A port of the site's maths (src/lib/discovery.ts → buildProfile and
// computeFandexScore, and src/lib/libraryAnalysis.ts → analyzeLibraryFacets),
// with the database taken out. Everything here is a pure function of three
// inputs the device already holds: the titles you rated with their facets, the
// taxonomy the Worker serves, and the facets of the title being scored. The
// spec is docs/fandex-score.md.
//
// ⚠️ This file and the site's code must give the same number for the same
// inputs. `scripts/probe-app-score.mjs` runs both over a database snapshot and
// compares every score; run it after changing either side. It loads this file
// under plain Node, so keep it to erasable TypeScript and to imports that
// resolve there (`@/` only, no `~/`).
//
// What the score must never read is unchanged (spec §4): community ratings,
// popularity, release dates. Nothing here takes them as input.

import { DEFAULT_SCORING_CONFIG, type ScoringConfigValues } from '@/lib/scoringDefaults';

export interface ScoreFacet {
  kind: 'tag' | 'person' | 'company' | 'ip';
  key: string;
  label: string;
  role?: string;
  category?: string;
  /** Cast billing weight, 1 for a lead down to a floor for a bit part. Absent means 1. */
  prominence?: number;
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
  // The site's merge: defaults, then what is stored, with roleWeights spread the
  // same way so a role added after the row was written still has a weight.
  const config: ScoringConfigValues = {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    roleWeights: { ...DEFAULT_SCORING_CONFIG.roleWeights, ...(stored.roleWeights ?? {}) },
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

// ── The taste profile ────────────────────────────────────────────────────────

export interface RatedTitle {
  id: string;
  /** Your score, 0-10: the average across the providers that hold one. */
  rating: number;
  /** The catalog's raw facets for the title. */
  facets: ScoreFacet[];
}

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
}

export interface Profile {
  /** facet id → deviation from your baseline × the facet's class weight. */
  w: Map<string, number>;
  meta: Map<string, FacetMeta>;
  /** Your mean rating, 0-10. */
  baseline: number;
  ratedItemCount: number;
}

/** Below this many rated titles there is no score at all, rather than one built on two samples. */
export const MIN_RATED_FOR_FANDEX_SCORE = 3;

export function buildProfile(rated: RatedTitle[], tax: Taxonomy): Profile {
  const stats = new Map<string, { kind: string; role?: string; key: string; label: string; category?: string; count: number; weightedCount: number; weightedSum: number }>();
  let ratingSum = 0;
  for (const item of rated) {
    ratingSum += item.rating;
    for (const f of resolveFacets(item.facets, item.id, tax)) {
      const id = facetId(f);
      const prominence = f.prominence ?? 1;
      const st = stats.get(id);
      if (st) {
        st.count++;
        st.weightedCount += prominence;
        st.weightedSum += item.rating * prominence;
      } else {
        const category = f.kind === 'tag' ? (tax.tagCategoryOverrides.get(f.key) ?? f.category) : f.category;
        stats.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category, count: 1, weightedCount: prominence, weightedSum: item.rating * prominence });
      }
    }
  }
  const baseline = rated.length ? ratingSum / rated.length : 0;
  const C = tax.config.priorStrength;

  const w = new Map<string, number>();
  const meta = new Map<string, FacetMeta>();
  for (const [id, f] of stats) {
    let classWeight: number;
    let category = f.category;
    if (f.kind === 'tag') {
      category = tax.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other';
      const cat = tax.categories.get(category);
      // An ignored category (platform and noise tags) is left out entirely.
      if (cat?.ignored || cat?.weight === 0) continue;
      classWeight = cat?.weight ?? 1;
    } else {
      classWeight = tax.config.roleWeights[f.role ?? 'tag'] ?? 1;
    }
    const BA = (C * baseline + f.weightedSum) / (C + f.weightedCount);
    w.set(id, (BA - baseline) * classWeight);
    meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category, classWeight, BA, n: f.count });
  }
  return { w, meta, baseline, ratedItemCount: rated.length };
}

// ── Scoring one title ────────────────────────────────────────────────────────

export interface ScoreReason {
  kind: string;
  role?: string;
  label: string;
  category?: string;
  /** Points this facet added to or took from the score. 0 when it was not counted. */
  contribution: number;
  /** What the facet is worth on any title, counted or not. */
  impact: number;
  /** Your average rating for titles carrying it, and how many there are. */
  BA: number;
  n: number;
  /** Outside the top few for this title: shown, not counted. */
  capped?: boolean;
}

export interface FandexScore {
  score: number;
  /** Your own mean rating × 10: the score of a title you have no opinion about. */
  center: number;
  reasons: ScoreReason[];
}

interface Contrib { f: ScoreFacet; dev: number; classWeight: number; meta: FacetMeta }

/**
 * Score one title. `facets` are the catalog's raw facets; the taxonomy is
 * applied here, as the site applies it inside computeFandexScore, so no caller
 * can score a title against keys the profile did not learn under.
 */
export function computeFandexScore(facets: ScoreFacet[], itemId: string | null, profile: Profile, tax: Taxonomy): FandexScore | null {
  if (profile.w.size === 0 || profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  const cfg = tax.config;

  const matched: Contrib[] = [];
  for (const f of resolveFacets(facets, itemId, tax)) {
    const id = facetId(f);
    const w = profile.w.get(id);
    const meta = profile.meta.get(id);
    if (w == null || !meta?.classWeight) continue;
    // The profile's weight recovers the deviation; THIS title's cast billing scales what it is worth here.
    matched.push({ f, dev: w / meta.classWeight, classWeight: meta.classWeight * (f.prominence ?? 1), meta });
  }
  if (!matched.length) return null;

  // Selected by the same quantity the score is made of (spec §3.3).
  const weighted = (c: Contrib) => c.dev * c.classWeight;
  const byMagnitude = (list: Contrib[]) => [...list].sort((a, b) => Math.abs(weighted(b)) - Math.abs(weighted(a)));
  const tags = matched.filter((c) => c.f.kind === 'tag');
  const tagsPositive = tags.filter((c) => c.dev > 0).sort((a, b) => weighted(b) - weighted(a));
  const tagsNegative = tags.filter((c) => c.dev < 0).sort((a, b) => weighted(a) - weighted(b));
  const people = byMagnitude(matched.filter((c) => c.f.kind === 'person'));
  const companies = byMagnitude(matched.filter((c) => c.f.kind === 'company'));
  const ips = byMagnitude(matched.filter((c) => c.f.kind === 'ip'));

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
  if (!kept.length) return null;

  // A raw sum, not a mean, and not clamped: 0-100 is a target, not a rule (spec §1).
  const rawSum = kept.reduce((acc, c) => acc + weighted(c), 0);
  const center = profile.baseline * 10;
  const gain = rawSum >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const impactOf = (c: Contrib) => {
    const w = profile.w.get(facetId(c.f)) ?? 0;
    return round1((w >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown) * w);
  };
  const reason = (c: Contrib, counted: boolean): ScoreReason => ({
    kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.meta.category ?? c.f.category,
    contribution: counted ? round1(gain * weighted(c)) : 0,
    impact: impactOf(c), BA: c.meta.BA, n: c.meta.n,
    ...(counted ? {} : { capped: true }),
  });

  return {
    score: round1(center + gain * rawSum),
    center: round1(center),
    reasons: [
      ...[...kept].sort((a, b) => weighted(b) - weighted(a)).map((c) => reason(c, true)),
      ...[...capped].sort((a, b) => Math.abs(weighted(b)) - Math.abs(weighted(a))).map((c) => reason(c, false)),
    ],
  };
}
