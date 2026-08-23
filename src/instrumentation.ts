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

    // Bound the persisted facet cache (2026-08-13, rewritten 2026-08-19).
    // `readFacetCache` already treats an over-age row as a miss, so this is
    // purely about DISK: `facet_page_cache` is written by crawler traffic over
    // the person/tag/studio long tail, and an unbounded table fed by somebody
    // else's crawler is precisely the shape that took prod down on 2026-07-22.
    //
    // ⚠️ THE 2026-08-19 CORRECTION, because the first version of this looked
    // like it did the job and did not. It ran ONCE per boot, at 2000 rows, with
    // an age cap and no size cap. Prod runs for days, so nothing expired
    // in-process, and the table reached **24,953 rows / 222.8 MB — 80.2% of a
    // 331 MB database** that had measured 37.7 MB the day before the cache
    // shipped. Two independent bugs, both fixed here:
    //   1. Boot-only is not a schedule. It now runs on an INTERVAL.
    //   2. An age cap is not a size cap. Inside one 24 h TTL window every row a
    //      crawler writes is "fresh", so the age sweep had nothing to collect
    //      while the table grew all day. trimFacetCacheToRows is the ceiling.
    //
    // Deferred off the boot tick and bounded (both passes delete in batches),
    // for the same reason bootPrune is: better-sqlite3 is synchronous and
    // Litestream holds a second connection, so a long write transaction here
    // would block both. Deliberately NOT gated behind PRUNE_ON_BOOT — that
    // switch exists to stop an unattended delete of CATALOG rows a user might
    // still reach; this only drops cache entries.
    const FACET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    const FACET_CACHE_INTERVAL_MS = 15 * 60 * 1000;

    const boundFacetCache = async () => {
      const { sweepFacetCache, trimFacetCacheToRows } = await import("./lib/facetCacheStore");
      const expired = sweepFacetCache(FACET_CACHE_TTL_MS, 2000);
      const trimmed = trimFacetCacheToRows();
      if (expired > 0 || trimmed > 0) log.info("facet_cache_bounded", { expired, trimmed });
    };

    void boundFacetCache().catch((e) => log.error("facet_cache_sweep_uncaught", errorFields(e)));

    // unref'd so this timer can never hold the process open on shutdown. One
    // pass is bounded, so a backlog (the 25k-row one this shipped against)
    // drains over successive ticks instead of in one long write transaction.
    const timer = setInterval(() => {
      void boundFacetCache().catch((e) => log.error("facet_cache_sweep_uncaught", errorFields(e)));
    }, FACET_CACHE_INTERVAL_MS);
    timer.unref?.();

    // PL4 — the same treatment for import staging, and for the same reason.
    // `import_staging` holds a parsed import for somebody who has no account
    // yet, so it is written on a request path by anonymous callers: the exact
    // shape that grew facet_page_cache above. It also holds personal data that
    // account erasure can never reach, because it has no user_id to be found by,
    // which makes this sweep a correctness requirement and not housekeeping.
    const { startStagingSweep, sweepStaging } = await import("./lib/import/staging");
    try {
      const swept = sweepStaging();
      if (swept > 0) log.info("import_staging_swept", { removed: swept });
    } catch (e) {
      log.error("import_staging_sweep_uncaught", errorFields(e));
    }
    startStagingSweep();
  }
}
