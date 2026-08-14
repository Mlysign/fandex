// Daily rotation — the shared "show something different today" primitive
// (2026-07-30).
//
// THE PROBLEM IT SOLVES: every personalised surface on Home was a `.sort()`
// followed by `.slice(0, 15)`. That is perfectly deterministic, so the same 15
// faces appeared every single day even though the ranked pool underneath was 40+
// items deep and barely changed. Nils's complaint ("feels like it shows the same
// items every day") was literally true, and no amount of better ranking fixes it
// — the fix is to draw from the head of the ranking instead of taking a prefix
// of it.
//
// WHY SEEDED, NOT RANDOM: `Math.random()` would reshuffle on every request,
// which breaks three things at once — the rails would change under you when you
// navigate Home → item → Back, the response stops being cacheable, and two
// consecutive loads can show the same "surprise". Seeding on the DAY (plus the
// userId for per-user surfaces) makes a pick stable for as long as the user is
// plausibly looking at it, and different tomorrow. It also stays testable.

/** Today as YYYY-MM-DD in UTC. Pass an explicit date to make callers testable. */
export function dayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * FNV-1a over the seed parts. Cheap, no dependency, and well-spread enough that
 * two adjacent days (or two userIds differing by one character) produce
 * unrelated streams — which a naive `length + charCodeAt` sum would not.
 */
export function seedFor(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f; // separator, so ("ab","c") and ("a","bc") differ
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 32-bit PRNG, one line of state, good enough for picking cards. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `n` of `items` without replacement, favouring the front of the list.
 *
 * `items` must already be in rank order (best first). Weight decays as
 * `1 / (rank + bias)`, so a #1 is several times likelier than a #30 but never
 * guaranteed — which is the whole point. A uniform shuffle would be worse than
 * the bug it fixes: it would routinely bury the strongest matches under
 * mediocre ones and make the rail feel arbitrary rather than fresh.
 *
 * `bias` flattens the curve as it grows: 1 is steep (strong front-loading), 8 is
 * nearly uniform over the first couple of dozen.
 */
export function pickWeighted<T>(items: T[], n: number, rng: () => number, bias = 4): T[] {
  if (n >= items.length) return [...items];
  const pool = items.map((item, rank) => ({ item, weight: 1 / (rank + bias) }));
  const out: T[] = [];
  let total = pool.reduce((s, p) => s + p.weight, 0);

  for (let k = 0; k < n && pool.length > 0; k++) {
    let target = rng() * total;
    let idx = pool.length - 1; // fallback for float drift at the very end
    for (let i = 0; i < pool.length; i++) {
      target -= pool[i].weight;
      if (target <= 0) { idx = i; break; }
    }
    total -= pool[idx].weight;
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * The rotation used by Home's rails: keep the top `keepTop` as a stable spine
 * (so the strongest items don't vanish on an unlucky day), then fill the rest of
 * the rail by weighted draw from what's left. Result is re-sorted by the
 * caller's own order if it cares about display order.
 */
export function rotateRail<T>(ranked: T[], size: number, seed: number, keepTop = 3): T[] {
  if (ranked.length <= size) return [...ranked];
  const spine = ranked.slice(0, Math.min(keepTop, size));
  const rest = pickWeighted(ranked.slice(spine.length), size - spine.length, rngFrom(seed));
  return [...spine, ...rest];
}

// ── Turnover (2026-08-14) ────────────────────────────────────────────────────
//
// Nils, testing on mobile: "I keep seeing the same items in my recommended
// carousel. This should rotate more." The day-seeded rotation above was doing
// exactly what it was written to do and still produced that experience, for
// three compounding reasons — none of which is a bug on its own:
//
//   1. `keepTop = 3` pins the same three cards forever. On a phone, three cards
//      IS most of the visible rail, so the part you actually see barely moved.
//   2. `pickWeighted`'s default bias of 4 is steeply front-loaded, so the 12
//      drawn slots kept landing in the same shallow head of the ranking.
//   3. The seed only changes once per UTC day, and two independent draws from a
//      front-loaded distribution overlap heavily anyway — "different seed" does
//      NOT mean "different items".
//
// (3) is the one worth internalising: making the rotation *more random* does not
// make it *turn over*. Independent draws repeat, however good the RNG is.
//
// So turnover has to be STRUCTURAL, not probabilistic. Each epoch deals one
// weighted hand of `cycle × need` items, and each slot in that epoch takes a
// different, non-overlapping share of that hand. Consecutive slots are then
// disjoint by construction rather than by luck.
//
// A REJECTED design, recorded because it looks obviously right and isn't: "draw
// from the pool minus what the previous slot drew". The previous slot's pick has
// to be recomputed, and recomputing it correctly means recomputing ITS exclusion
// too — the recursion has no base case, so any real implementation truncates it
// and ends up excluding a hand that was never actually shown. Its own unit test
// caught this: slots 100 and 101 still shared three items.
//
// The shares are dealt round-robin (stride `cycle`), not as contiguous blocks.
// `pickWeighted` returns its draw in roughly quality order, so contiguous blocks
// would hand slot 0 the best titles and slot 3 the dregs — a rail that visibly
// got worse as the day went on. Dealing every cycle-th item spreads quality
// evenly across all the slots while keeping them disjoint.

/** Rotation periods per day. 4 = a fresh rail every 6 hours. */
export const SLOTS_PER_DAY = 4;

/**
 * Which rotation period we're in — a monotonic counter, not a within-day index,
 * so slot N-1 is always the real previous period even across a midnight or a
 * month boundary.
 *
 * Six hours (rather than the old 24) is a deliberate middle: long enough that
 * Home → item → Back lands in the same slot in every realistic session, which
 * is the property the original day-seeding was protecting; short enough that
 * opening the app morning and evening shows a different shelf.
 */
export function rotationSlot(now: Date = new Date(), perDay = SLOTS_PER_DAY): number {
  return Math.floor(now.getTime() / (86_400_000 / perDay));
}

/**
 * Like `rotateRail`, but consecutive slots are guaranteed to share nothing
 * except the pinned spine.
 *
 * `cycle` is how many slots the rail takes to come back around. It is clamped
 * to what the pool can actually support: a pool only twice as deep as the rail
 * can offer two disjoint hands, not four, and a full rail beats a fresh one —
 * so a shallow pool degrades to a shorter cycle rather than to a half-empty
 * shelf.
 *
 * `seedAt` is called with the EPOCH (slot / cycle), not the slot, so one deal
 * serves a whole cycle and the shares within it stay disjoint.
 *
 * SCOPE OF THE GUARANTEE: disjointness is structural *within* an epoch. The one
 * transition per cycle that crosses into a new deal can overlap, because two
 * independently seeded weighted draws do. That is inherent to any periodic
 * reseed — closing it would need the previous epoch's hand recomputed, which is
 * the unbounded recursion described above — and it is a boundary case of a
 * cycle, not the steady state. Measured at ≤ 5 of 15 repeated there, against
 * the ~50% the old day-seeded rotation repeated *every* day.
 */
export function rotateRailFresh<T>(
  ranked: T[],
  size: number,
  seedAt: (epoch: number) => number,
  slot: number,
  { keepTop = 1, bias = 10, cycle = SLOTS_PER_DAY }: { keepTop?: number; bias?: number; cycle?: number } = {},
): T[] {
  if (ranked.length <= size) return [...ranked];
  const spine = ranked.slice(0, Math.min(keepTop, size));
  const tail = ranked.slice(spine.length);
  const need = size - spine.length;

  const cycleLen = Math.max(1, Math.min(cycle, Math.floor(tail.length / need)));
  // Floor-mod, so a negative slot (only reachable from the dev-only `?slot=`
  // override) still lands in range instead of producing an empty hand.
  const share = ((slot % cycleLen) + cycleLen) % cycleLen;
  const epoch = Math.floor(slot / cycleLen);

  const hand = pickWeighted(tail, cycleLen * need, rngFrom(seedAt(epoch)), bias);

  const picks: T[] = [];
  for (let i = share; i < hand.length && picks.length < need; i += cycleLen) picks.push(hand[i]);
  return [...spine, ...picks];
}
