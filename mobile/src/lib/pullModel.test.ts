import { describe, expect, it } from 'vitest';
import { fitPullModel, fitPullModelSteps, foldFor, parseStoredFit, storedFitOf, timesAverage, type PullPick, type PullTitle } from './pullModel';
import { drain } from './timeSlice';

// The pull model on its own (docs/fandex-score.md §3.7). The score's own
// tests (fandexScore.test.ts) cover what a reader sees; these pin the maths.

const titles = (prefix: string, n: number, type: string, facets: string[]): PullTitle[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type, facets }));
const picked = (list: PullTitle[], weight = 1): PullPick[] => list.map((t) => ({ ...t, weight }));
const OPTS = { l1: 1, l2: 0.1, folds: 0 };

describe('the pull model', () => {
  it('compares within a medium: a facet common in games is not pull for somebody who mostly plays', () => {
    // "open world" is on half of all games and on no film. You play a lot, and half your games are open world: the usual rate.
    const baseline = [...titles('bg', 100, 'game', ['open world']), ...titles('bh', 100, 'game', []), ...titles('bf', 200, 'movie', [])];
    const picks = picked([...titles('g', 30, 'game', ['open world']), ...titles('h', 30, 'game', []), ...titles('f', 10, 'movie', [])]);
    const model = fitPullModel(picks, baseline, OPTS)!;
    expect(model.beta.get('open world') ?? 0).toBeCloseTo(0, 1);
    expect(timesAverage(model, 'open world')!.times).toBeCloseTo(1, 1);
  });

  it('weighs a wishlisted title by its weight, in the fit and in the counts', () => {
    const baseline = [...titles('b', 180, 'movie', []), ...titles('n', 20, 'movie', ['noir'])];
    const full = fitPullModel(picked(titles('p', 20, 'movie', ['noir'])), baseline, OPTS)!;
    const half = fitPullModel(picked(titles('p', 20, 'movie', ['noir']), 0.5), baseline, OPTS)!;
    expect(timesAverage(full, 'noir')!.titles).toBe(20);
    expect(timesAverage(half, 'noir')!.titles).toBe(20);
    // All your picks are noir, against one in ten of the baseline, either way: the weights move the evidence, not the share.
    expect(full.counts.get('noir')!.picked).toBe(20);
    expect(half.counts.get('noir')!.picked).toBe(10);
  });

  it('takes a tag as a feature only when the titles the draw itself added carry it', () => {
    // "singleplayer" is RAWG's: on your games and on two drawn games that were in the pool already, never on a fresh one.
    const fresh = titles('f', 180, 'game', ['tag||open world']).map((t) => ({ ...t, fresh: true }));
    const stale = titles('s', 20, 'game', ['tag||open world', 'tag||singleplayer']);
    const picks = picked([...titles('p', 30, 'game', ['tag||singleplayer', 'tag||open world']), ...titles('q', 30, 'game', [])]);
    expect(fitPullModel(picks, [...fresh, ...stale], OPTS)!.beta.has('tag||singleplayer')).toBe(false);
    // Without any fresh title (a baseline from before the flag), every baseline title vouches.
    expect(fitPullModel(picks, [...fresh.map(({ fresh: _f, ...t }) => t), ...stale], OPTS)!.beta.has('tag||singleplayer')).toBe(true);
  });

  it('leaves out a medium it has nothing to compare with', () => {
    const model = fitPullModel(picked(titles('b', 5, 'book', ['fantasy'])), titles('m', 10, 'movie', ['fantasy']), OPTS);
    expect(model).toBeNull();
  });

  it('fits each fold without its own picks, and puts a title in the same fold every time', () => {
    const baseline = [...titles('b', 180, 'movie', []), ...titles('n', 20, 'movie', ['noir'])];
    const model = fitPullModel(picked([...titles('p', 30, 'movie', ['noir']), ...titles('q', 30, 'movie', [])]), baseline, { ...OPTS, folds: 5 })!;
    expect(model.foldBeta).toHaveLength(5);
    expect(model.foldOf.get('p0')).toBe(foldFor('p0', 5));
    expect(foldFor('p0', 5)).toBe(foldFor('p0', 5));
    // Each fold still sees most of the evidence, so it agrees with the whole on the direction.
    for (const beta of model.foldBeta) expect(beta.get('noir')).toBeGreaterThan(0);
  });

  it('takes a title you picked back out of its own counts', () => {
    const baseline = [...titles('b', 180, 'movie', []), ...titles('n', 20, 'movie', ['noir'])];
    const model = fitPullModel(picked(titles('p', 10, 'movie', ['noir'])), baseline, OPTS)!;
    const all = timesAverage(model, 'noir')!;
    const without = timesAverage(model, 'noir', { type: 'movie', weight: 1 })!;
    expect(without.titles).toBe(all.titles - 1);
    expect(without.times).toBeLessThanOrEqual(all.times);
  });
});

describe('a stored fit', () => {
  // Kept on the device so a start does not fit again (ScoreProvider): only the
  // coefficients are kept, and the counts and folds are rebuilt from the rows.
  const picks = picked([...titles('p', 40, 'movie', ['noir', 'heist']), ...titles('q', 40, 'movie', ['noir'])]);
  const baseline = [...titles('b', 200, 'movie', []), ...titles('c', 20, 'movie', ['noir']), ...titles('d', 20, 'movie', ['heist'])];
  const opts = { ...OPTS, folds: 5 };

  it('rebuilds the same model a fresh fit gives, through JSON', () => {
    const fresh = fitPullModel(picks, baseline, opts)!;
    const stored = parseStoredFit(JSON.parse(JSON.stringify(storedFitOf(fresh))))!;
    const reused = drain(fitPullModelSteps(picks, baseline, opts, stored))!;
    expect(reused).toEqual(fresh);
    expect(fresh.beta.get('noir')).toBeGreaterThan(0);
  });

  it('is refused when the row is not one', () => {
    expect(parseStoredFit(null)).toBeNull();
    expect(parseStoredFit({ beta: [['noir', 1]], sweeps: 3 })).toBeNull();
    expect(parseStoredFit({ beta: [['noir', '1']], foldBeta: [], sweeps: 3 })).toBeNull();
    expect(parseStoredFit({ beta: [['noir', 1]], foldBeta: [[['noir', 0.9]]], sweeps: 3 })).toEqual({ beta: [['noir', 1]], foldBeta: [[['noir', 0.9]]], sweeps: 3 });
  });
});
