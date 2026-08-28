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
    // Held so the home-snapshot refresh below can wait for it. See there.
    const pruneDone = bootPrune().catch((e) => log.error("boot_prune_uncaught", errorFields(e)));
    void pruneDone;

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

    // media_item_projection — facetCache's disk L2 (2026-08-28), written on a
    // request path, so it needs a ROW ceiling and not just a TTL. It has no TTL
    // at all on purpose: a projection is stale only when its item's links
    // change, and (last_synced, raw_len) already catches that on read.
    //
    // Same interval and the same bounded-batch shape as the sweep above, for the
    // same reason: PR16 deleted 546,754 rows in one go for 12.8 GB of WAL churn
    // to S3 and blew the Railway spend cap. The danger is the catch-up burst.
    const boundProjections = async () => {
      const { sweepProjections } = await import("./lib/facetCache");
      const { rows, deleted } = sweepProjections();
      if (deleted > 0) log.info("projection_table_bounded", { rows, deleted });
    };
    void boundProjections().catch((e) => log.error("projection_sweep_uncaught", errorFields(e)));
    const projectionTimer = setInterval(() => {
      void boundProjections().catch((e) => log.error("projection_sweep_uncaught", errorFields(e)));
    }, FACET_CACHE_INTERVAL_MS);
    projectionTimer.unref?.();

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

    // ── The daily snapshots: home, then calendar (2026-08-26) ──────────────
    //
    // `/` serves its public rails out of one `home_snapshot` row, and the
    // calendar serves its Popular scope out of twelve `calendar_snapshot` rows.
    // Both are built here rather than on a request path. That is the whole
    // point: a crawler walking the homepage or the month pages a thousand times
    // now causes ZERO provider calls, where every cold cache entry used to cost
    // a full TMDB + Trakt + IGDB + RAWG fan-out.
    // → src/lib/homeSnapshot.ts and src/lib/calendarSnapshot.ts for the rules
    //   each builder holds.
    //
    // ⚠️ BOOT *AND* INTERVAL, not either. Boot alone is not a schedule: prod
    // runs for days, which is exactly how the facet-cache sweep above shipped
    // broken and let that table reach 222.8 MB. Interval alone would leave a
    // freshly deployed container serving whatever the volume happened to hold,
    // which after a week of no deploys could be a week-stale page. The check is
    // cheap (`snapshotIsDue` is one indexed SELECT), so it runs hourly and
    // rebuilds only when the stored day has actually turned over.
    //
    // NOT awaited, same as bootPrune: this makes provider calls and must never
    // sit in front of the server accepting its first request.
    const HOME_SNAPSHOT_CHECK_MS = 60 * 60 * 1000;

    // ⚠️ THE CALENDAR SNAPSHOT RUNS FIRST, AND THE ORDER IS WORTH KEEPING.
    // `buildHomeSnapshot`'s Upcoming rail goes through `upcomingPool`, which
    // calls `candidatesForMonth` for the current month and the two after it.
    // All three are inside the calendar window, so building the calendar first
    // means Home's upcoming rail costs ZERO additional provider calls. Reversed,
    // the same three months get fetched twice every day.
    const refreshSnapshots = async () => {
      const { calendarSnapshotIsDue, buildCalendarSnapshot } = await import("./lib/calendarSnapshot");
      if (calendarSnapshotIsDue()) {
        const { fetchMonthCandidates } = await import("./lib/popularMonthFeed");
        await buildCalendarSnapshot(fetchMonthCandidates);
      }

      const { snapshotIsDue, buildHomeSnapshot } = await import("./lib/homeSnapshot");
      if (snapshotIsDue()) await buildHomeSnapshot();
    };

    // ⚠️ AFTER THE BOOT PRUNE, and this ordering is the whole reason
    // `pruneDone` is held above. Both run at boot. The prune computes its list
    // of prunable ids and then deletes them, so a title the snapshot pins in
    // between those two steps is not protected by `PRUNABLE_WHERE`. It was
    // already on the kill list. The window is milliseconds and the damage is a
    // dead link on the highest-authority page in the app until tomorrow's
    // build, which is exactly the kind of intermittent, unreproducible
    // 404 nobody would trace back to here. Sequencing them costs nothing:
    // neither is awaited by `register`, so boot is not delayed either way.
    void pruneDone
      .then(() => refreshSnapshots())
      .catch((e) => log.error("home_snapshot_uncaught", errorFields(e)));

    // unref'd for the same reason as the facet-cache timer: a background
    // refresher must never hold the process open on shutdown.
    const homeTimer = setInterval(() => {
      void refreshSnapshots().catch((e) => log.error("home_snapshot_uncaught", errorFields(e)));
    }, HOME_SNAPSHOT_CHECK_MS);
    homeTimer.unref?.();

    // ── Catalog fill (docs/catalog-growth.md phase 1) ──────────────────────
    // Heals thin, list-payload rows on a timer instead of waiting for somebody
    // to open the title. Same `healLinks` the detail route uses, a bounded
    // batch per pass, and it costs one cheap SELECT once the backlog is empty
    // — which is the steady state, not the exception.
    //
    // ⚠️ AFTER the boot prune, same ordering rule as the snapshots above: the
    // prune computes its kill list and then deletes, so healing a row inside
    // that window would spend a provider call on something about to vanish.
    const runFill = async () => {
      // ── Retention first (2026-08-28) ────────────────────────────────────
      // TMDB's terms cap caching at SIX MONTHS, and nothing enforced it:
      // `healLinks` re-fetches on projection VERSION, never on age, so a healed
      // row's last_synced never moved again. This marks ageing links
      // un-projected, which is the queue `fillCatalogBatch` below already
      // drains — so a contract deadline reuses the existing fetch path rather
      // than adding a second one. It runs BEFORE the fill so a refresh that is
      // on a clock outranks an enrichment that is not. → lib/retention.ts
      const { retentionSweep, retentionStatus } = await import("./lib/retention");
      const swept = retentionSweep();
      const status = retentionStatus();
      if (swept.marked > 0) log.info("retention_sweep", { ...swept, expired: status.expired, due: status.due });
      // Not a warning: a provider term being breached. Unreachable while the
      // fill drains, which is exactly why it is measured and not assumed.
      if (status.expired > 0) log.error("retention_expired", { ...status });

      const { fillCatalogBatch, FILL_INTERVAL_MS } = await import("./lib/catalogFill");
      const res = await fillCatalogBatch();
      // Log only when something happened. A line every 30 minutes saying "0 of
      // 0" is how a log stops being read.
      if (res.considered > 0) log.info("catalog_fill", { ...res, everyMs: FILL_INTERVAL_MS });
    };

    const { FILL_INTERVAL_MS, FILL_START_DELAY_MS } = await import("./lib/catalogFill");
    // ⚠️ And NOT immediately after the prune, unlike the snapshots. Boot is the
    // slowest this process ever is, and the first measured pass healed 0 of 10
    // items that heal fine a minute later — every call spent its budget waiting
    // on a cold route and an unfetched Twitch token. The homepage needs its
    // snapshot at boot; nothing needs this.
    const firstFill = setTimeout(() => {
      void pruneDone
        .then(() => runFill())
        .catch((e) => log.error("catalog_fill_uncaught", errorFields(e)));
    }, FILL_START_DELAY_MS);
    firstFill.unref?.();
    const fillTimer = setInterval(() => {
      void runFill().catch((e) => log.error("catalog_fill_uncaught", errorFields(e)));
    }, FILL_INTERVAL_MS);
    fillTimer.unref?.();
  }
}
