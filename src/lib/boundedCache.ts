// A tiny dependency-free bounded cache: LRU eviction by entry count, plus an
// optional per-entry TTL. Built for the app's single long-lived Node process
// (P1 = single-instance) where module-level `Map` caches would otherwise grow
// without bound (P2). Map-like API (`has`/`get`/`set`/`delete`/`clear`/`keys`/
// `size`) so existing call sites change minimally.
//
//   - `max`   — hard cap on live entries; on overflow the least-recently-used
//               entry is evicted. `get()` counts as a use (LRU touch); `has()`
//               does not reorder.
//   - `ttlMs` — optional; an entry older than this is treated as absent and
//               dropped lazily on the next `has()`/`get()`.
//
// Not thread-safe by design: JS's single-threaded execution makes the
// `has()`→`get()` sequences in callers safe without locking.
export class BoundedCache<K, V> {
  private m = new Map<K, { v: V; at: number }>();
  private readonly max: number;
  private readonly ttlMs?: number;

  constructor(opts: { max: number; ttlMs?: number }) {
    this.max = Math.max(1, opts.max);
    this.ttlMs = opts.ttlMs;
  }

  private fresh(e: { at: number }): boolean {
    return this.ttlMs === undefined || Date.now() - e.at < this.ttlMs;
  }

  has(key: K): boolean {
    const e = this.m.get(key);
    if (!e) return false;
    if (!this.fresh(e)) {
      this.m.delete(key);
      return false;
    }
    return true;
  }

  get(key: K): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (!this.fresh(e)) {
      this.m.delete(key);
      return undefined;
    }
    // LRU touch: reinsert so this key becomes the most-recently-used.
    this.m.delete(key);
    this.m.set(key, e);
    return e.v;
  }

  set(key: K, value: V): void {
    this.m.delete(key); // reinsert at the most-recent position
    this.m.set(key, { v: value, at: Date.now() });
    if (this.m.size > this.max) {
      // Map preserves insertion order → the first key is the least-recent.
      const oldest = this.m.keys().next().value as K | undefined;
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.m.delete(key);
  }

  clear(): void {
    this.m.clear();
  }

  keys(): IterableIterator<K> {
    return this.m.keys();
  }

  /**
   * Up to `n` live values, for the byte sampler below. Not `values()`: handing
   * out the whole collection invites a caller to walk it on a request path,
   * which for `facetCache.derived` is thousands of objects.
   */
  sample(n: number): V[] {
    const out: V[] = [];
    for (const e of this.m.values()) {
      if (out.length >= n) break;
      if (this.fresh(e)) out.push(e.v);
    }
    return out;
  }

  get size(): number {
    return this.m.size;
  }
}

// ── Process-wide caches (2026-08-23) ─────────────────────────────────────────
//
// ⚠️ A BARE `new BoundedCache()` AT MODULE SCOPE IS NOT ONE CACHE. Next resolves
// a module into a different bundle per route kind, so the same declaration
// becomes SEVERAL independent caches — one per bundle that imports it. Proven on
// prod 2026-08-20: the same cold-month workload down a PAGE route never moved
// counters an API route had just moved. It had silently broken the circuit
// breaker since 2026-08-02, and `http.ts` pins `_breakers` and `_calls` to
// globalThis for exactly this reason.
//
// `docs/scalability.md` §3.4 flagged that roughly 20 other module-level caches
// have the same shape and were NOT measured. The honest problem with measuring
// first is that **duplication is not observable from inside one bundle** — the
// 2026-08-20 proof worked only because the counters it watched were already
// shared. So pinning IS the measurement here: once a cache is process-wide, the
// size reported by `cacheSnapshot()` is the true one, and a figure larger than
// the per-bundle budget assumed is the duplication showing itself.
//
// If duplicated, the cost was never neutral: retained memory was a multiple of
// the budgeted figure (Railway bills RAM at ~$10/GB-month against a $5 Hobby
// credit) and hit rates were lower than assumed, since each bundle had to warm
// its own copy.
//
// Use this instead of `new BoundedCache(...)` for any cache that is expensive
// to fill or expensive to hold. `name` must be unique and stable — it is the
// identity, so two different caches sharing a name would silently share
// STORAGE. Options are read only when the cache is first created; a later call
// with different options returns the existing instance rather than resizing it,
// which keeps a hot-reloaded module from quietly discarding a warm cache.
const _registry: Map<string, BoundedCache<unknown, unknown>> =
  ((globalThis as Record<string, unknown>).__fandexCaches ??= new Map()) as Map<string, BoundedCache<unknown, unknown>>;

export function sharedCache<K, V>(name: string, opts: { max: number; ttlMs?: number }): BoundedCache<K, V> {
  const existing = _registry.get(name);
  if (existing) return existing as BoundedCache<K, V>;
  const created = new BoundedCache<K, V>(opts);
  _registry.set(name, created as BoundedCache<unknown, unknown>);
  return created;
}

/** Live entry count per shared cache. Reported by /api/health so the figure can
 *  be read against the budget each cache was sized to. */
export function cacheSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, c] of _registry) out[name] = c.size;
  return out;
}

/** Test seam: empty every shared cache without discarding the instances. */
export function __clearSharedCaches(): void {
  for (const c of _registry.values()) c.clear();
}

// ── What a cache actually WEIGHS (2026-08-23) ────────────────────────────────
//
// ⚠️ EVERY CACHE HERE IS BOUNDED BY ENTRY COUNT, NOT BY BYTES, and those are
// very different budgets when the entries are payloads rather than ids.
// `docs/scalability.md` §3.5 has flagged this since the `facet_page_cache`
// incident, and it stayed open because nothing could answer "how many bytes is
// `max: 3000` actually authorising?" — `cacheSnapshot()` reports 3000 either way.
//
// This is that answer, by SAMPLING rather than by walking. `JSON.stringify` over
// every entry of `facetCache.derived` is thousands of objects and would be an
// expensive thing to expose; a sample of 25 gives a mean that is easily good
// enough to set a budget against, which is all this is for.
//
// ⚠️ IT IS AN ESTIMATE OF SERIALISED SIZE, NOT OF RETAINED HEAP, and the two
// differ in both directions. JSON has no object headers, pointers or Map
// overhead, so it UNDER-counts; but shared sub-objects (the same facet array
// referenced by several entries) are counted once in heap and once per entry
// here, so it OVER-counts. Treat it as an order of magnitude for budgeting, and
// never quote it as a memory figure — for that, read `memoryMb.heapUsed`
// against a time series (AGENTS.md: a spot sample has mis-diagnosed this twice).
//
// Admin-gated at the call site, and deliberately NOT in /api/health: that probe
// is public and Railway hits it constantly.
const SAMPLE_SIZE = 25;

export interface CacheWeight {
  entries: number;
  /** How many entries the sample actually covered. */
  sampled: number;
  /** Mean serialised bytes per entry, from the sample. */
  meanBytes: number | null;
  /** meanBytes x entries. Null when nothing could be measured. */
  estimatedBytes: number | null;
}

export function cacheWeights(): Record<string, CacheWeight> {
  const out: Record<string, CacheWeight> = {};
  for (const [name, c] of _registry) {
    const entries = c.size;
    if (entries === 0) {
      out[name] = { entries: 0, sampled: 0, meanBytes: null, estimatedBytes: 0 };
      continue;
    }
    const vals = c.sample(SAMPLE_SIZE);
    let total = 0, ok = 0;
    for (const v of vals) {
      try {
        // A cache of primitives (id lookups) stringifies to a few bytes, which
        // is the correct answer for those and worth seeing next to the fat ones.
        total += JSON.stringify(v)?.length ?? 0;
        ok++;
      } catch {
        // Circular or non-serialisable: skip it rather than fail the report.
      }
    }
    const mean = ok > 0 ? Math.round(total / ok) : null;
    out[name] = {
      entries,
      sampled: ok,
      meanBytes: mean,
      estimatedBytes: mean === null ? null : mean * entries,
    };
  }
  return out;
}
