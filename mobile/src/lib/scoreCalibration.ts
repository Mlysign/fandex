// The score's own check, on the device: every title you rated, scored with
// its rating left out, against what you gave. The honesty lines in the Why
// sheet read it ("within one point 44% of the time", "when it said 70 to 75
// you gave 7.4"), and the goalpost report sends its counts to the Worker
// (ScoreProvider.sendScoreReport, worker/src/scoreReport.ts). Pure, apart
// from yielding between chunks so a phone's screen keeps up.

import { computeFandexScore, type Profile, type RatedTitle, type ScoreBand, type Taxonomy } from '~/lib/fandexScore';

/** The score bands the rung lines read: under 50, by tens to 60, by fives to 80, 80 and up. */
export const RUNGS: [number, number][] = [[0, 50], [50, 60], [60, 65], [65, 70], [70, 75], [75, 80], [80, 101]];
/** The report's bins: (rating − score ÷ 10) rounded, from −6 to +5. */
export const BIN_FROM = -6;
export const BIN_COUNT = 12;
/** Titles scored between two yields. */
const CHUNK = 150;

export interface Rung { lo: number; hi: number; n: number; mean: number }

export interface MediumCalibration {
  medium: string;
  /** Rated titles the device could score. */
  n: number;
  /** Of those, the score ÷ 10 landed within one point, and within two, of the rating given. */
  withinOne: number;
  withinTwo: number;
  bins: number[];
  /** Per band the score put a title in: [titles, of those rated 8 or more]. */
  bands: Record<ScoreBand, [number, number]>;
  rungs: Rung[];
}

const empty = (medium: string): MediumCalibration => ({
  medium, n: 0, withinOne: 0, withinTwo: 0, bins: new Array<number>(BIN_COUNT).fill(0),
  bands: { high: [0, 0], usual: [0, 0], low: [0, 0] },
  rungs: RUNGS.map(([lo, hi]) => ({ lo, hi, n: 0, mean: 0 })),
});

/**
 * Per medium, and summed under `all`. `yield_` is awaited between chunks; the
 * default gives the event loop a turn. A rated title without a medium counts
 * in `all` only.
 */
export async function calibrate(
  rated: RatedTitle[], profile: Profile, tax: Taxonomy,
  yield_: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<Map<string, MediumCalibration>> {
  const per = new Map<string, MediumCalibration>();
  const sums = new Map<string, number[]>();
  const add = (medium: string, rating: number, score: number, band: ScoreBand) => {
    let m = per.get(medium);
    if (!m) { per.set(medium, (m = empty(medium))); sums.set(medium, RUNGS.map(() => 0)); }
    const gap = rating - score / 10;
    m.n++;
    if (Math.abs(gap) <= 1) m.withinOne++;
    if (Math.abs(gap) <= 2) m.withinTwo++;
    m.bins[Math.max(0, Math.min(BIN_COUNT - 1, Math.round(gap) - BIN_FROM))]++;
    const pair = m.bands[band];
    pair[0]++;
    if (rating >= 8) pair[1]++;
    const at = RUNGS.findIndex(([lo, hi]) => score >= lo && score < hi);
    if (at >= 0) { m.rungs[at].n++; sums.get(medium)![at] += rating; }
  };
  for (let i = 0; i < rated.length; i++) {
    if (i > 0 && i % CHUNK === 0) await yield_();
    const r = rated[i];
    const fx = computeFandexScore(r.facets, r.id, profile, tax, r.type);
    if (!fx) continue;
    if (r.type) add(r.type, r.rating, fx.score, fx.band);
    add('all', r.rating, fx.score, fx.band);
  }
  for (const [medium, m] of per) m.rungs.forEach((rung, i) => { rung.mean = rung.n ? sums.get(medium)![i] / rung.n : 0; });
  return per;
}
