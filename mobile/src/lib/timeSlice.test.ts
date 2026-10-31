import { describe, expect, it } from 'vitest';
import { fitPullModel, fitPullModelSteps, type PullPick, type PullTitle } from './pullModel';
import { drain, runSliced, SliceCancelled, type Steps } from './timeSlice';

// Long work cut into slices so a tap still lands (timeSlice.ts). The pull
// model's fit is the reason it exists: seconds on a phone, all of it on the
// thread that answers taps.

function* count(n: number, log: number[]): Steps<number> {
  for (let i = 0; i < n; i++) { log.push(i); yield; }
  return n;
}

describe('time slices', () => {
  it('drain runs the work to its end at once', () => {
    const log: number[] = [];
    expect(drain(count(5, log))).toBe(5);
    expect(log).toEqual([0, 1, 2, 3, 4]);
  });

  it('runSliced pauses between slices, so other work gets a turn', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    function* slow(): Steps<string> {
      for (let i = 0; i < 20; i++) {
        const until = Date.now() + 5;
        while (Date.now() < until) { /* busy, as a fit is */ }
        yield;
      }
      return 'done';
    }
    try {
      expect(await runSliced(slow(), { budgetMs: 8 })).toBe('done');
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it('stops when nobody wants the answer any more', async () => {
    const log: number[] = [];
    let live = true;
    const run = runSliced(count(1_000_000, log), { budgetMs: 1, alive: () => live });
    live = false;
    await expect(run).rejects.toBeInstanceOf(SliceCancelled);
    expect(log.length).toBeLessThan(1_000_000);
  });

  it('the sliced pull fit is the same model as the one-shot fit', async () => {
    const titles = (prefix: string, n: number, type: string, facets: (i: number) => string[]): PullTitle[] =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type, facets: facets(i) }));
    const picks: PullPick[] = titles('p', 300, 'movie', (i) => [`f${i % 7}`, `g${i % 11}`, ...(i % 3 ? ['noir'] : [])]).map((t) => ({ ...t, weight: 1 }));
    const baseline = titles('b', 900, 'movie', (i) => [`f${i % 13}`, `g${i % 5}`, ...(i % 9 ? [] : ['noir'])]);
    const opts = { l1: 1, l2: 0.1, folds: 5 };
    const once = fitPullModel(picks, baseline, opts)!;
    const sliced = (await runSliced(fitPullModelSteps(picks, baseline, opts), { budgetMs: 1 }))!;
    expect([...sliced.beta]).toEqual([...once.beta]);
    expect(sliced.foldBeta.map((m) => [...m])).toEqual(once.foldBeta.map((m) => [...m]));
    expect(sliced.sweeps).toBe(once.sweeps);
    expect(once.beta.get('noir')).toBeGreaterThan(0);
  });
});
