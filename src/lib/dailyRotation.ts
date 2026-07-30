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
