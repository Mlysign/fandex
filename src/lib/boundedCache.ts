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
