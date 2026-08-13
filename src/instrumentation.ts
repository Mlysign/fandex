// Next.js calls register() once when a server instance boots, before it serves
// any request — the right place to validate configuration (P10). Guarded to the
// Node runtime (config.ts reads process.env, irrelevant on the edge runtime) and
// dynamically imported so it's never pulled into an edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/config");
    validateEnv();

    // Boot-time prune of the browsed-discover tail (2026-08-03), default ON —
    // set PRUNE_ON_BOOT=0 to disable. NOT awaited: bootPrune() defers its own
    // (synchronous, better-sqlite3) DB work past this tick, so register()
    // still returns immediately and a prune failure can never crash boot.
    const { bootPrune } = await import("./lib/dbPrune");
    const { log, errorFields } = await import("./lib/logger");
    void bootPrune().catch((e) => log.error("boot_prune_uncaught", errorFields(e)));

    // Expire the persisted facet cache (2026-08-13). `readFacetCache` already
    // treats an over-age row as a miss, so this is purely about DISK: without it
    // `facet_page_cache` only ever grows, and an unbounded table fed by crawler
    // traffic is precisely the shape that took prod down on 2026-07-22. Caught
    // immediately after shipping the cache, when prod's dbMb moved 37.2 -> 45.
    //
    // Deferred off the boot tick and bounded (the sweep deletes in batches), for
    // the same reason bootPrune is: better-sqlite3 is synchronous and Litestream
    // holds a second connection, so a long write transaction here would block
    // both. Deliberately NOT gated behind PRUNE_ON_BOOT — that switch exists to
    // stop an unattended delete of CATALOG rows a user might still reach; this
    // only drops cache entries that are already unreadable.
    void Promise.resolve().then(async () => {
      const { sweepFacetCache } = await import("./lib/facetCacheStore");
      const removed = sweepFacetCache(24 * 60 * 60 * 1000, 2000);
      if (removed > 0) log.info("facet_cache_swept", { removed });
    }).catch((e) => log.error("facet_cache_sweep_uncaught", errorFields(e)));
  }
}
