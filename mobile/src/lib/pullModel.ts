// The pull axis as one model (docs/fandex-score.md §3.7, 2026-10-26).
//
// "Do you seek this kind of thing out?" is answered by comparing the titles you
// picked (your library, your wishlist at half weight) with the baseline: titles
// drawn at random from everything the providers know above a vote floor, put
// in the pool and tagged like every other title (worker/src/baseline.ts). The
// pool alone could not answer it: it was mostly the owner's library, so it
// counted itself ("you've seen 4 of 4 firefighter films").
//
// All facets are weighed at once, in a logistic regression of "is this one of
// your picks or a baseline title?" over the facets the titles carry, with one
// intercept per medium. Two things follow from fitting them together, and they
// are why it is a model and not a ratio per facet:
//
//   - A facet that only rides along gets no credit. Firefighter is on three
//     anime films; once anime explains those, firefighter has nothing left.
//   - A penalty (lasso) holds every facet at zero until it has evidence: at the
//     start a facet's gradient is half its excess of titles over what the
//     baseline expects, so `l1` 2.5 means about five titles more than expected
//     before it counts at all. Three films is a hint, not a habit.
//
// The baseline's weight per medium equals your picks' weight in that medium
// (a balanced design), so the intercepts absorb how much of each medium you
// pick, and a facet common in games is not read as pull by someone who plays
// a lot. A coefficient is the log of how much more often a title with the
// facet is one of your picks, other facets held equal.
//
// A title you picked is scored by a model that did not see it: the picks are
// split into folds, and each fold has a model fitted without it. Pure
// TypeScript, importing only timeSlice.ts (itself pure), so
// scripts/score-backtest.mjs runs it under Node.
//
// The fit is seconds on a phone, so it is written as steps (timeSlice.ts):
// `fitPullModelSteps` yields every few hundred rows or facets, and the device
// runs it in slices so the app keeps answering taps while it fits.

import { drain, type Steps } from './timeSlice';

export interface PullTitle {
  id: string;
  type: string;
  /** Facet ids, as the score keys them (`kind|role|key`), after the taxonomy. */
  facets: string[];
  /**
   * A baseline title the draw itself put in the pool, so it is tagged by
   * today's pipeline alone. A drawn title that was in the pool already may
   * carry tags from a source that is gone (RAWG's), and must not vouch for them.
   */
  fresh?: boolean;
}

export interface PullPick extends PullTitle {
  /** 1 for a title in your library, less for one you only wishlisted. */
  weight: number;
}

export interface PullOptions {
  /**
   * The evidence a facet needs before it counts, as a z-score: how many
   * standard errors its count among your picks sits away from what the
   * baseline expects, (picked − expected) / √(picked + expected). 3 holds a
   * facet back unless that gap would come by chance about one time in four
   * hundred, which with thousands of facets is what keeps the coincidences out.
   */
  l1: number;
  /** A small ridge on top, which keeps facets that always come together from trading their weight back and forth. */
  l2: number;
  /** Folds for scoring your own picks out of sample. 0 or 1 scores them with the full model. */
  folds: number;
  /** A facet on fewer titles than this, picks and baseline together, is not a feature at all. */
  minSupport?: number;
  /**
   * A TAG the fresh baseline titles (`fresh`, the ones the draw itself added)
   * carry fewer times than this is not a feature: a tag they never show is
   * mostly one whose source they lack (RAWG's genres are on titles stored
   * before RAWG was retired, never on a drawn one; Trakt's and Letterboxd's
   * come from a person's own sync). Counted on the fresh ones only, because a
   * drawn title that was already in the pool carries the old sources too: with
   * every baseline title counted, "singleplayer" (RAWG's) read as 17 times
   * your usual. People, studios and franchises come from the same provider
   * records for a drawn title as for yours, so a director the draw happened to
   * miss is still a feature: rarity is what makes "five of his films" telling.
   * Without any fresh title, every baseline title counts.
   */
  minBaseline?: number;
  maxSweeps?: number;
  tol?: number;
}

export interface PullModel {
  /** Facet id → coefficient (natural log). Facets at zero are absent. */
  beta: Map<string, number>;
  /** One per fold: the coefficients fitted without that fold's picks. */
  foldBeta: Map<string, number>[];
  /** Pick id → its fold, for picks the folds cover. */
  foldOf: Map<string, number>;
  /** Per medium: the weight of your picks and the size of the baseline the model compared them with. */
  media: Map<string, { picks: number; baseline: number }>;
  /** Per facet id: what the plain counts say, for the sentence a row shows. */
  counts: Map<string, FacetCounts>;
  /** Sweeps the full fit took, for the profile's log line. */
  sweeps: number;
}

export interface FacetCounts {
  /** The weight of your picks carrying it (a wishlisted title counts its weight). */
  picked: number;
  /** How many of your picks carry it, whatever their weight. */
  titles: number;
  /** The media those picks are in. */
  pickedMedia: Set<string>;
  /** Medium → baseline titles carrying it. */
  baseline: Map<string, number>;
}

const sigmoid = (x: number) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const softThreshold = (x: number, l: number) => (x > l ? x - l : x < -l ? x + l : 0);
/**
 * The fit's own version, part of what a stored fit is keyed by (ScoreProvider):
 * raise it with any change to what `fitPullModelSteps` computes, or a device
 * keeps the coefficients the old code fitted.
 */
export const PULL_FIT_VERSION = 1;
/** Rows or facets handled between two yields: small enough that a slice ends near its budget on a phone. */
const YIELD_EVERY = 256;

/** A stable fold for an id: the same title lands in the same fold on every device and every rebuild. */
export function foldFor(id: string, folds: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % folds;
}

interface Design {
  n: number;
  y: Uint8Array;
  medium: Int32Array;
  /** Feature index → the samples carrying it. */
  cols: Int32Array[];
  /** Medium index → its samples. */
  byMedium: Int32Array[];
}

/**
 * Coordinate descent for a weighted lasso logistic regression with unpenalised
 * per-medium intercepts. `penalty[j]` is facet j's own lasso weight.
 */
function* fit(d: Design, w: Float64Array, penalty: Float64Array, opts: PullOptions, init?: { beta: Float64Array; b0: Float64Array }): Steps<{ beta: Float64Array; b0: Float64Array; sweeps: number }> {
  const p = d.cols.length;
  const beta = init ? Float64Array.from(init.beta) : new Float64Array(p);
  const b0 = init ? Float64Array.from(init.b0) : new Float64Array(d.byMedium.length);
  const eta = new Float64Array(d.n);
  for (let i = 0; i < d.n; i++) eta[i] = b0[d.medium[i]];
  for (let j = 0; j < p; j++) if (beta[j] !== 0) for (const i of d.cols[j]) eta[i] += beta[j];
  const prob = new Float64Array(d.n);
  for (let i = 0; i < d.n; i++) prob[i] = sigmoid(eta[i]);

  const move = (rows: Int32Array, delta: number) => {
    for (const i of rows) { eta[i] += delta; prob[i] = sigmoid(eta[i]); }
  };
  const step = (rows: Int32Array, current: number, l1: number, l2: number): number => {
    let g = 0;
    let h = 0;
    for (const i of rows) {
      const wi = w[i];
      if (wi === 0) continue;
      g += wi * (prob[i] - d.y[i]);
      h += wi * prob[i] * (1 - prob[i]);
    }
    if (h < 1e-9) return 0;
    const next = softThreshold(h * current - g, l1) / (h + l2);
    // A trust region: one step moves a coefficient by at most 1, so a facet on few titles cannot jump.
    return Math.max(-1, Math.min(1, next - current));
  };

  const maxSweeps = opts.maxSweeps ?? 200;
  const tol = opts.tol ?? 1e-4;
  let full = true;
  let sweeps = 0;
  for (; sweeps < maxSweeps; sweeps++) {
    for (let m = 0; m < d.byMedium.length; m++) {
      const delta = step(d.byMedium[m], b0[m], 0, 0);
      if (delta !== 0) { b0[m] += delta; move(d.byMedium[m], delta); }
    }
    let biggest = 0;
    for (let j = 0; j < p; j++) {
      if (j % YIELD_EVERY === YIELD_EVERY - 1) yield;
      if (!full && beta[j] === 0) continue;
      const delta = step(d.cols[j], beta[j], penalty[j], opts.l2);
      if (delta === 0) continue;
      beta[j] += delta;
      move(d.cols[j], delta);
      biggest = Math.max(biggest, Math.abs(delta));
    }
    yield;
    if (biggest < tol) {
      // Settled on the facets already counted: one sweep over all of them says whether any other wants in.
      if (full) break;
      full = true;
    } else {
      full = false;
    }
  }
  return { beta, b0, sweeps };
}

/**
 * Fit the pull model: your picks against the baseline. Media with picks but no
 * baseline (or a baseline but no picks) are left out, since there is nothing
 * to compare them with. Null when no medium has both.
 */
export function fitPullModel(picks: PullPick[], baseline: PullTitle[], opts: PullOptions): PullModel | null {
  return drain(fitPullModelSteps(picks, baseline, opts));
}

/**
 * What a fit found, without what can be counted again: the coefficients and
 * the sweeps. Small enough to keep on the device (a few hundred facets), where
 * the counts (every facet any title carries) are megabytes and a pass over the
 * rows to rebuild.
 */
export interface StoredPullFit {
  beta: [string, number][];
  foldBeta: [string, number][][];
  sweeps: number;
}

export function storedFitOf(model: PullModel): StoredPullFit {
  return { beta: [...model.beta], foldBeta: model.foldBeta.map((m) => [...m]), sweeps: model.sweeps };
}

/** A stored fit read back, or null when it is not one (an older shape, a damaged row). */
export function parseStoredFit(v: unknown): StoredPullFit | null {
  const pairs = (x: unknown): x is [string, number][] =>
    Array.isArray(x) && x.every((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number');
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<StoredPullFit>;
  if (!pairs(o.beta) || !Array.isArray(o.foldBeta) || !o.foldBeta.every(pairs) || typeof o.sweeps !== 'number') return null;
  return { beta: o.beta, foldBeta: o.foldBeta, sweeps: o.sweeps };
}

/**
 * `fitPullModel` as steps, for a caller that runs it in slices (timeSlice.ts
 * `runSliced`). With `stored`, a fit made earlier on exactly these picks and
 * this baseline, the fits are skipped: the counts and the folds are rebuilt
 * from the rows and the stored coefficients are used as they are. That pass is
 * a small part of the work; the sweeps are the rest.
 */
export function* fitPullModelSteps(picks: PullPick[], baseline: PullTitle[], opts: PullOptions, stored?: StoredPullFit): Steps<PullModel | null> {
  const pickWeight = new Map<string, number>();
  const baselineSize = new Map<string, number>();
  for (const t of picks) if (t.weight > 0) pickWeight.set(t.type, (pickWeight.get(t.type) ?? 0) + t.weight);
  for (const t of baseline) baselineSize.set(t.type, (baselineSize.get(t.type) ?? 0) + 1);
  const mediaList = [...pickWeight.keys()].filter((m) => (baselineSize.get(m) ?? 0) > 0).sort();
  if (!mediaList.length) return null;
  const mediumIndex = new Map(mediaList.map((m, i) => [m, i]));

  const rows: { t: PullTitle; y: 0 | 1; weight: number }[] = [];
  for (const t of picks) if (t.weight > 0 && mediumIndex.has(t.type)) rows.push({ t, y: 1, weight: t.weight });
  const firstBaseline = rows.length;
  for (const t of baseline) if (mediumIndex.has(t.type)) rows.push({ t, y: 0, weight: 0 });

  // The plain counts, for every facet: what the sentence on a row is made of.
  const counts = new Map<string, FacetCounts>();
  const support = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    if (i % YIELD_EVERY === YIELD_EVERY - 1) yield;
    const r = rows[i];
    const seen = new Set<string>();
    for (const f of r.t.facets) {
      if (seen.has(f)) continue;
      seen.add(f);
      support.set(f, (support.get(f) ?? 0) + 1);
      let c = counts.get(f);
      if (!c) counts.set(f, (c = { picked: 0, titles: 0, pickedMedia: new Set(), baseline: new Map() }));
      if (r.y === 1) { c.picked += r.weight; c.titles++; c.pickedMedia.add(r.t.type); }
      else c.baseline.set(r.t.type, (c.baseline.get(r.t.type) ?? 0) + 1);
    }
  }
  const media = new Map(mediaList.map((m) => [m, { picks: pickWeight.get(m) ?? 0, baseline: baselineSize.get(m) ?? 0 }]));
  const foldOf = new Map<string, number>();
  const fold = new Int32Array(firstBaseline);
  if (opts.folds > 1) {
    for (let i = 0; i < firstBaseline; i++) {
      fold[i] = foldFor(rows[i].t.id, opts.folds);
      foldOf.set(rows[i].t.id, fold[i]);
    }
  }
  if (stored) {
    return { beta: new Map(stored.beta), foldBeta: stored.foldBeta.map((m) => new Map(m)), foldOf, media, counts, sweeps: stored.sweeps };
  }

  const minSupport = opts.minSupport ?? 3;
  const minBaseline = opts.minBaseline ?? 2;
  // Which tags today's pipeline puts on a drawn title: counted on the fresh ones.
  const anyFresh = baseline.some((t) => t.fresh);
  const vouched = new Map<string, number>();
  for (let i = 0; i < baseline.length; i++) {
    if (i % YIELD_EVERY === YIELD_EVERY - 1) yield;
    const t = baseline[i];
    if (anyFresh && !t.fresh) continue;
    for (const f of new Set(t.facets)) if (f.startsWith('tag|')) vouched.set(f, (vouched.get(f) ?? 0) + 1);
  }
  yield;
  const features = [...support].filter(([f, n]) => n >= minSupport && (!f.startsWith('tag|') || (vouched.get(f) ?? 0) >= minBaseline)).map(([f]) => f).sort();
  const featureIndex = new Map(features.map((f, j) => [f, j]));
  const colLists: number[][] = features.map(() => []);
  const n = rows.length;
  const y = new Uint8Array(n);
  const medium = new Int32Array(n);
  const mediumRows: number[][] = mediaList.map(() => []);
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === YIELD_EVERY - 1) yield;
    const r = rows[i];
    y[i] = r.y;
    medium[i] = mediumIndex.get(r.t.type)!;
    mediumRows[medium[i]].push(i);
    const seen = new Set<number>();
    for (const f of r.t.facets) {
      const j = featureIndex.get(f);
      if (j === undefined || seen.has(j)) continue;
      seen.add(j);
      colLists[j].push(i);
    }
  }
  yield;
  const design: Design = { n, y, medium, cols: colLists.map((c) => Int32Array.from(c)), byMedium: mediumRows.map((c) => Int32Array.from(c)) };

  /** The weights for a fit that leaves out the picks for which `out` is true: each medium's baseline weighs what its picks weigh. */
  const weights = (out: (i: number) => boolean) => {
    const w = new Float64Array(n);
    const picked = new Float64Array(mediaList.length);
    for (let i = 0; i < firstBaseline; i++) if (!out(i)) { w[i] = rows[i].weight; picked[medium[i]] += w[i]; }
    for (let i = firstBaseline; i < n; i++) w[i] = picked[medium[i]] / (baselineSize.get(rows[i].t.type) ?? 1);
    return w;
  };

  // Each facet's penalty scales with the square root of the weight it sits on
  // (your picks plus the baseline's share), the standard error of the gap
  // between what you picked and what the baseline expects. At the start a
  // facet's gradient is half that gap, so it enters once the gap passes `l1`
  // standard errors: a franchise you finished four of four (0.1 expected) does,
  // three firefighter films against 1.75 expected does not. Without the scaling
  // the bar is a count of titles, which favours big facets over telling ones.
  yield;
  const wholeWeights = weights(() => false);
  const penalty = new Float64Array(features.length);
  design.cols.forEach((col, j) => {
    let m = 0;
    for (const i of col) m += wholeWeights[i];
    penalty[j] = (opts.l1 / 2) * Math.sqrt(m);
  });
  yield;
  const whole = yield* fit(design, wholeWeights, penalty, opts);
  const toMap = (beta: Float64Array) => {
    const m = new Map<string, number>();
    beta.forEach((b, j) => { if (b !== 0) m.set(features[j], b); });
    return m;
  };

  const foldBeta: Map<string, number>[] = [];
  if (opts.folds > 1) {
    for (let k = 0; k < opts.folds; k++) {
      // Warm from the whole fit: a fold moves few coefficients, so it settles in a few sweeps.
      foldBeta.push(toMap((yield* fit(design, weights((i) => fold[i] === k), penalty, opts, whole)).beta));
    }
  }

  return {
    beta: toMap(whole.beta),
    foldBeta,
    foldOf,
    media,
    counts,
    sweeps: whole.sweeps,
  };
}

/**
 * What the plain counts say about a facet: how many times more (or less) often
 * your picks carry it than the baseline says they would, medium by medium
 * (each medium's baseline share times what you picked in that medium). Half a
 * title is added to both sides, so a facet the baseline has never seen is not
 * "infinitely" yours. `leaveOut` takes one of your picks back out.
 */
export function timesAverage(model: PullModel, facet: string, leaveOut?: { type: string; weight: number }): { times: number; titles: number; media: Set<string> } | null {
  const c = model.counts.get(facet);
  if (!c) return null;
  let expected = 0;
  for (const [m, { picks, baseline }] of model.media) {
    const own = leaveOut?.type === m ? leaveOut.weight : 0;
    expected += ((c.baseline.get(m) ?? 0) / baseline) * Math.max(0, picks - own);
  }
  const picked = Math.max(0, c.picked - (leaveOut?.weight ?? 0));
  const titles = Math.max(0, c.titles - (leaveOut ? 1 : 0));
  return { times: (picked + 0.5) / (expected + 0.5), titles, media: c.pickedMedia };
}
