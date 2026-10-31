// Long work on the JavaScript thread, cut into slices so a tap still lands.
//
// React Native runs every press handler, every Pressable's pressed style and
// every state update on one thread. A computation that holds it for seconds
// leaves a tap with no feedback and no effect until it ends, which reads as a
// frozen app (the pull model's fit: about 1.2 s on a laptop for a 2,500-pick
// library against 6,800 baseline titles, several times that under Hermes).
//
// Such work is written as a generator that yields wherever stopping is safe.
// `drain` runs it in one go (tests, scripts under Node); `runSliced` runs it
// for `budgetMs` at a time and gives the event loop a turn in between. Pure,
// no imports, so scripts/score-backtest.mjs can load what imports it.

/** Work that yields at safe points and returns `T` at the end. */
export type Steps<T> = Generator<void, T, void>;

/** Run the work to its end without a pause. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Thrown by `runSliced` when `alive` said no: nobody wants the answer any more. */
export class SliceCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SliceCancelled';
  }
}

/**
 * Milliseconds of work between two turns of the event loop: about a frame, so
 * a tap waits at most that long for its handler.
 */
export const SLICE_BUDGET_MS = 16;

const nextTurn = () => new Promise<void>((done) => setTimeout(done, 0));

/**
 * Run the work in slices of `budgetMs`, a `setTimeout(0)` between them (which,
 * unlike a microtask, lets touches through). `alive` is asked after each pause;
 * a no stops the work there and rejects with `SliceCancelled`.
 */
export async function runSliced<T>(steps: Steps<T>, opts: { budgetMs?: number; alive?: () => boolean } = {}): Promise<T> {
  const budget = opts.budgetMs ?? SLICE_BUDGET_MS;
  for (;;) {
    const start = Date.now();
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
      if (Date.now() - start >= budget) break;
    }
    await nextTurn();
    if (opts.alive && !opts.alive()) {
      steps.return(undefined as T);
      throw new SliceCancelled();
    }
  }
}
