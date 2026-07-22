import fs from "fs";
import path from "path";
import { get, getDb, query, transaction } from "@/lib/db";
import { log } from "@/lib/logger";

// PR16 — reclaim the catalog-pool blowup (2026-07-22).
//
// PR13-PR15 stopped the growth; this removes what already accumulated:
// ~673k of 675k `media_items` rows were titles a crawler walked past on a
// public facet page, never anything a user owns. See TASKS.md "Catalog-pool
// blowup + memory ramp" and the prod-db-size-and-page-cache memory note.
//
// ── Why the predicate names FOUR tables, not one ─────────────────────────────
// The plan's predicate was `browsed = 1 AND id NOT IN user_item_state`, which
// is correct ONLY IF user_item_state is a strict superset of user_library and
// user_watchlist. On the dev DB it is (verified: 0 rows at risk). But
// user_library and user_watchlist BOTH carry
// `media_item_id REFERENCES media_items(id) ON DELETE CASCADE`, so if that
// invariant is off by even one row in prod, this silently deletes a library
// entry — the user's own rating and review with it, unrecoverable.
//
// So the predicate excludes every table that references media_items. Retaining
// a few hundred extra rows costs nothing; depending on an invariant we can only
// verify on a different database is the kind of bet that loses data. The
// preview reports both numbers so the difference is visible before applying.
const PRUNABLE_WHERE = `
  browsed = 1
  AND id NOT IN (SELECT media_item_id FROM user_item_state)
  AND id NOT IN (SELECT media_item_id FROM user_library)
  AND id NOT IN (SELECT media_item_id FROM user_watchlist)
`;

function n(sql: string): number {
  return get<{ n: number }>(sql)?.n ?? 0;
}

export type PrunePreview = {
  mediaItems: number;
  browsed: number;
  /** Rows the safe predicate would delete. */
  prunable: number;
  /** Rows kept because a user acted on them (the promotion half of the pool rule). */
  protectedByUserState: number;
  protectedByLibrary: number;
  protectedByWatchlist: number;
  /**
   * Rows the PLAN's narrower `NOT IN user_item_state` predicate would have
   * deleted despite a library/watchlist row pointing at them. Must be 0. If it
   * ever isn't, the extra clauses above just prevented real data loss.
   */
  wouldHaveLostLibraryRows: number;
  wouldHaveLostWatchlistRows: number;
  linkRowsToDelete: number;
  externalIdRowsToDelete: number;
};

export function previewPrune(): PrunePreview {
  return {
    mediaItems: n("SELECT COUNT(*) n FROM media_items"),
    browsed: n("SELECT COUNT(*) n FROM media_items WHERE browsed = 1"),
    prunable: n(`SELECT COUNT(*) n FROM media_items WHERE ${PRUNABLE_WHERE}`),
    protectedByUserState: n(
      "SELECT COUNT(*) n FROM media_items WHERE browsed = 1 AND id IN (SELECT media_item_id FROM user_item_state)",
    ),
    protectedByLibrary: n(
      "SELECT COUNT(*) n FROM media_items WHERE browsed = 1 AND id IN (SELECT media_item_id FROM user_library)",
    ),
    protectedByWatchlist: n(
      "SELECT COUNT(*) n FROM media_items WHERE browsed = 1 AND id IN (SELECT media_item_id FROM user_watchlist)",
    ),
    wouldHaveLostLibraryRows: n(`
      SELECT COUNT(*) n FROM user_library ul
       WHERE ul.media_item_id IN (
         SELECT id FROM media_items
          WHERE browsed = 1 AND id NOT IN (SELECT media_item_id FROM user_item_state)
       )`),
    wouldHaveLostWatchlistRows: n(`
      SELECT COUNT(*) n FROM user_watchlist uw
       WHERE uw.media_item_id IN (
         SELECT id FROM media_items
          WHERE browsed = 1 AND id NOT IN (SELECT media_item_id FROM user_item_state)
       )`),
    linkRowsToDelete: n(`
      SELECT COUNT(*) n FROM media_links
       WHERE media_item_id IN (SELECT id FROM media_items WHERE ${PRUNABLE_WHERE})`),
    externalIdRowsToDelete: n(`
      SELECT COUNT(*) n FROM media_external_ids
       WHERE media_item_id IN (SELECT id FROM media_items WHERE ${PRUNABLE_WHERE})`),
  };
}

export type PruneResult = {
  deleted: number;
  batches: number;
  remaining: number;
  timedOut: boolean;
  libraryRowsBefore: number;
  libraryRowsAfter: number;
  watchlistRowsBefore: number;
  watchlistRowsAfter: number;
};

/**
 * Delete the prunable rows in bounded batches.
 *
 * Batched deliberately, not one big DELETE: 673k rows plus their cascades in a
 * single transaction means a multi-GB WAL, which Litestream then has to ship in
 * one burst — the same shape of problem as the 2026-07-20 lock incident. Small
 * committed batches let replication keep pace and keep peak memory flat.
 *
 * Bounded by a wall-clock budget too, so one HTTP request can't hang past a
 * proxy timeout. The caller repeats until `remaining` is 0, which also makes the
 * whole operation resumable if anything interrupts it.
 */
export function runPrune(opts: { batchSize?: number; budgetMs?: number } = {}): PruneResult {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 5000, 100), 20000);
  const budgetMs = Math.min(Math.max(opts.budgetMs ?? 20000, 1000), 60000);
  const startedAt = Date.now();

  // Guard rails, re-checked at run time rather than trusted from the preview.
  const libraryRowsBefore = n("SELECT COUNT(*) n FROM user_library");
  const watchlistRowsBefore = n("SELECT COUNT(*) n FROM user_watchlist");

  let deleted = 0;
  let batches = 0;
  let timedOut = false;

  for (;;) {
    if (Date.now() - startedAt > budgetMs) {
      timedOut = true;
      break;
    }
    // SQLite is not built with SQLITE_ENABLE_UPDATE_DELETE_LIMIT here, so the
    // batch bound goes in a subquery rather than DELETE ... LIMIT.
    const info = transaction(() =>
      getDb()
        .prepare(
          `DELETE FROM media_items WHERE id IN (
             SELECT id FROM media_items WHERE ${PRUNABLE_WHERE} LIMIT ?
           )`,
        )
        .run(batchSize),
    );
    if (info.changes === 0) break;
    deleted += info.changes;
    batches++;
  }

  const result: PruneResult = {
    deleted,
    batches,
    remaining: n(`SELECT COUNT(*) n FROM media_items WHERE ${PRUNABLE_WHERE}`),
    timedOut,
    libraryRowsBefore,
    libraryRowsAfter: n("SELECT COUNT(*) n FROM user_library"),
    watchlistRowsBefore,
    watchlistRowsAfter: n("SELECT COUNT(*) n FROM user_watchlist"),
  };

  // If a cascade ever reached user data, that is the one outcome worth shouting
  // about — the counts are returned either way so the caller can see it too.
  if (
    result.libraryRowsAfter !== libraryRowsBefore ||
    result.watchlistRowsAfter !== watchlistRowsBefore
  ) {
    log.error("prune_touched_user_rows", {
      libraryRowsBefore,
      libraryRowsAfter: result.libraryRowsAfter,
      watchlistRowsBefore,
      watchlistRowsAfter: result.watchlistRowsAfter,
    });
  }

  log.info("prune_batch_complete", { deleted, batches, remaining: result.remaining });
  return result;
}

// ── Paced background prune (PR16, 2026-07-22) ───────────────────────────────
//
// Deleting rows grows the WAL and Litestream's shadow WAL faster than a burst
// can be reclaimed: measured ~40 MB of volume per 1,000 rows. That space DOES
// come back — Litestream replicates and expires segments continuously (observed
// +131 MB reclaimed while idle) — but an on-demand `wal_checkpoint(TRUNCATE)`
// usually returns busy=1, because Litestream holds a read lock to protect
// frames it hasn't shipped. So the constraint is not total disk, it is RATE.
//
// Hence a self-pacing server-side job rather than ~40 hand-driven requests: it
// deletes a batch, watches free space, and simply waits when the volume gets
// tight, letting Litestream catch up before continuing. It is safe to
// interrupt — the predicate is idempotent and progress is durable, so a restart
// just resumes.
export type PruneJobState = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  deleted: number;
  batches: number;
  waits: number;
  /** SQLITE_BUSY backoffs — expected under Litestream contention, not errors. */
  busyRetries: number;
  remaining: number | null;
  freeMb: number | null;
  lastError: string | null;
  /** Set if a cascade ever reached user rows — the job halts immediately. */
  abortedForSafety: boolean;
};

let _job: PruneJobState = {
  running: false, startedAt: null, finishedAt: null,
  deleted: 0, batches: 0, waits: 0, busyRetries: 0, remaining: null, freeMb: null,
  lastError: null, abortedForSafety: false,
};

export function pruneJobState(): PruneJobState {
  return { ..._job };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the paced prune. Returns immediately; poll pruneJobState().
 *
 * Guards, in order of how much they matter:
 *  1. user rows — re-counted every batch; any change halts the job on the spot.
 *  2. free space — never let the volume approach full, since that takes the
 *     database down. Below `floorMb` it waits instead of deleting.
 *  3. wall clock — a hard stop so a stuck job can't run forever.
 */
export function startPruneJob(opts: {
  batchSize?: number;
  floorMb?: number;
  maxMs?: number;
} = {}): PruneJobState {
  if (_job.running) return pruneJobState();

  const batchSize = Math.min(Math.max(opts.batchSize ?? 2000, 100), 20000);
  const floorMb = Math.max(opts.floorMb ?? 700, 300);
  const maxMs = Math.min(Math.max(opts.maxMs ?? 4 * 60 * 60 * 1000, 60000), 6 * 60 * 60 * 1000);

  _job = {
    running: true, startedAt: Date.now(), finishedAt: null,
    deleted: 0, batches: 0, waits: 0, busyRetries: 0, remaining: null, freeMb: null,
    lastError: null, abortedForSafety: false,
  };

  void (async () => {
    const libBefore = n("SELECT COUNT(*) n FROM user_library");
    const wlBefore = n("SELECT COUNT(*) n FROM user_watchlist");
    try {
      while (Date.now() - (_job.startedAt ?? 0) < maxMs) {
        const free = volumeInfo().freeMb;
        _job.freeMb = free;

        // Tight on space — stop deleting and let Litestream drain.
        if (free != null && free < floorMb) {
          _job.waits++;
          await sleep(30000);
          continue;
        }

        // SQLITE_BUSY is EXPECTED here, not exceptional. Litestream takes its
        // own locks to checkpoint and ship the WAL, and under the write volume
        // a prune generates it can hold them past db.ts's 5s busy_timeout —
        // this is the same contention that caused the 2026-07-20 lock incident.
        // A job meant to run for hours must treat that as backpressure and wait,
        // not die (the first run stopped after 4,000 rows on exactly this).
        let info: { changes: number } | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            info = transaction(() =>
              getDb()
                .prepare(
                  `DELETE FROM media_items WHERE id IN (
                     SELECT id FROM media_items WHERE ${PRUNABLE_WHERE} LIMIT ?
                   )`,
                )
                .run(batchSize),
            );
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!/database is locked|SQLITE_BUSY/i.test(msg)) throw e;
            _job.busyRetries++;
            // Linear backoff: Litestream's cycle is seconds, not minutes.
            await sleep(2000 * (attempt + 1));
          }
        }
        if (info === null) {
          // Ten straight failures means sustained contention, not a blip —
          // stop and surface it rather than hammering the write lock.
          _job.lastError = "database is locked (gave up after 10 retries)";
          log.error("prune_job_busy_exhausted", { deleted: _job.deleted });
          break;
        }

        if (info.changes === 0) break; // drained
        _job.deleted += info.changes;
        _job.batches++;
        _job.remaining = n(`SELECT COUNT(*) n FROM media_items WHERE ${PRUNABLE_WHERE}`);

        // The one check worth halting for.
        if (
          n("SELECT COUNT(*) n FROM user_library") !== libBefore ||
          n("SELECT COUNT(*) n FROM user_watchlist") !== wlBefore
        ) {
          _job.abortedForSafety = true;
          log.error("prune_job_aborted_user_rows_changed", { deleted: _job.deleted });
          break;
        }

        // Breathe between batches so replication keeps pace instead of the WAL
        // outrunning it.
        await sleep(1500);
      }
    } catch (e) {
      _job.lastError = e instanceof Error ? e.message : String(e);
      log.error("prune_job_failed", { message: _job.lastError, deleted: _job.deleted });
    } finally {
      _job.running = false;
      _job.finishedAt = Date.now();
      _job.remaining = n(`SELECT COUNT(*) n FROM media_items WHERE ${PRUNABLE_WHERE}`);
      _job.freeMb = volumeInfo().freeMb;
      log.info("prune_job_done", { deleted: _job.deleted, remaining: _job.remaining, waits: _job.waits });
    }
  })();

  return pruneJobState();
}

export type VolumeInfo = {
  dbMb: number | null;
  freeMb: number | null;
  totalMb: number | null;
  /**
   * What the file would collapse to if vacuumed right now: the live (non-free)
   * pages only. After a prune this is FAR below dbMb — which is the whole point
   * of measuring it rather than the current file size.
   */
  liveDataMb: number | null;
  /** Headroom test, against liveDataMb — see the comment in volumeInfo(). */
  hasRoomToVacuum: boolean | null;
};

/**
 * Free space on the volume holding the DB, plus what a VACUUM would actually
 * need.
 *
 * The naive check is `free > currentFileSize`, on the theory that VACUUM writes
 * a full second copy. That's wrong in the direction that matters here: VACUUM's
 * temp copy is the COMPACTED size, not the current size. Post-prune this DB is
 * ~2.5 GB of mostly-free pages holding maybe 50 MB of live data, so a
 * file-size-based check would refuse to run the very VACUUM that fixes it —
 * exactly when the volume is most likely to be tight.
 */
export function volumeInfo(): VolumeInfo {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
  const mb = (b: number) => Math.round(b / 1048576);
  let dbMb: number | null = null;
  try {
    dbMb = mb(fs.statSync(dbPath).size);
  } catch {
    dbMb = null;
  }

  let liveDataMb: number | null = null;
  try {
    const pageSize = get<Record<string, number>>("PRAGMA page_size");
    const pageCount = get<Record<string, number>>("PRAGMA page_count");
    const freelist = get<Record<string, number>>("PRAGMA freelist_count");
    const ps = pageSize ? Object.values(pageSize)[0] : null;
    const pc = pageCount ? Object.values(pageCount)[0] : null;
    const fl = freelist ? Object.values(freelist)[0] : null;
    if (ps != null && pc != null && fl != null) liveDataMb = mb((pc - fl) * ps);
  } catch {
    liveDataMb = null;
  }

  try {
    const s = fs.statfsSync(path.dirname(dbPath));
    const freeMb = mb(Number(s.bavail) * Number(s.bsize));
    const totalMb = mb(Number(s.blocks) * Number(s.bsize));
    // 1.5x the live data, plus a floor: the rewrite needs the compacted copy
    // plus the WAL it churns through, and taking a volume to literally 0 free
    // is its own outage.
    const needMb = liveDataMb == null ? null : Math.max(liveDataMb * 1.5, 64);
    return {
      dbMb,
      freeMb,
      totalMb,
      liveDataMb,
      hasRoomToVacuum: needMb == null ? null : freeMb > needMb,
    };
  } catch {
    return { dbMb, freeMb: null, totalMb: null, liveDataMb, hasRoomToVacuum: null };
  }
}

/**
 * Full VACUUM. Separate from the prune on purpose.
 *
 * The prune alone already fixes the MEMORY problem: the freed pages stop being
 * read, so the page cache working set collapses even though the file stays 2.5
 * GB on disk. VACUUM is purely about giving the disk back — a different,
 * lower-urgency goal with a much worse risk profile:
 *   · it rewrites the entire file, so it needs room for a second copy;
 *   · it cannot run inside a transaction;
 *   · under Litestream it invalidates the replica generation and forces a full
 *     re-snapshot of whatever the new file is.
 * So it is its own explicit call, gated on volumeInfo().hasRoomToVacuum.
 */
export function runVacuum(): { ok: boolean; beforeMb: number | null; afterMb: number | null; error?: string } {
  const vol = volumeInfo();
  if (vol.hasRoomToVacuum === false) {
    return {
      ok: false,
      beforeMb: vol.dbMb,
      afterMb: vol.dbMb,
      error: `Not enough free space: ${vol.freeMb}MB free, need ~1.5x the ${vol.liveDataMb}MB of live data.`,
    };
  }
  const beforeMb = vol.dbMb;
  try {
    getDb().exec("VACUUM");
  } catch (e) {
    return { ok: false, beforeMb, afterMb: beforeMb, error: e instanceof Error ? e.message : String(e) };
  }
  const afterMb = volumeInfo().dbMb;
  log.info("vacuum_complete", { beforeMb, afterMb });
  return { ok: true, beforeMb, afterMb };
}

export type WalDiagnostics = {
  journalMode: string | null;
  /**
   * Litestream sets this to 0 on databases it manages, taking sole control of
   * checkpointing. If it IS 0, SQLite's own 4 MB autocheckpoint never fires and
   * a stalled Litestream checkpointer means an unbounded WAL — which is exactly
   * the 2026-07-22 symptom (walMb pinned at 60.7 across 12 h and several
   * restarts, then at 130.3 for 200 s with zero writes).
   */
  autocheckpoint: number | null;
  walMb: number | null;
  /** Frames currently in the WAL, and how many are already in the main DB. */
  busy: number | null;
  logFrames: number | null;
  checkpointedFrames: number | null;
  /** logFrames - checkpointedFrames: real un-checkpointed backlog. */
  pendingFrames: number | null;
  pendingMb: number | null;
};

/**
 * Read-only WAL state, plus a PASSIVE checkpoint probe.
 *
 * PASSIVE is the safe mode: it copies frames into the main DB and NEVER
 * truncates or removes anything, so it cannot drop frames Litestream hasn't
 * shipped yet. (Litestream's read lock exists specifically to block the
 * RESTART/TRUNCATE modes that could.) Its return triple is the diagnostic worth
 * having: `busy` non-zero means something is holding the checkpoint back, and
 * logFrames vs checkpointedFrames says whether the WAL is genuinely full of
 * pending data or is just a large file being reused at its high-water mark —
 * the difference between "the prune needs 22 GB" and "the prune plateaus".
 */
export function walDiagnostics(opts: { probe?: boolean } = {}): WalDiagnostics {
  // The PASSIVE probe writes frames into the main DB. Harmless and something
  // SQLite does routinely, but it IS a mutation — so it's opt-in, and the
  // dry-run GET asks for the pure pragma reads only.
  const probe = opts.probe ?? false;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
  const one = (sql: string): number | null => {
    try {
      const row = get<Record<string, unknown>>(sql);
      if (!row) return null;
      const v = Object.values(row)[0];
      return typeof v === "number" ? v : null;
    } catch {
      return null;
    }
  };

  let journalMode: string | null = null;
  try {
    const row = get<Record<string, unknown>>("PRAGMA journal_mode");
    const v = row ? Object.values(row)[0] : null;
    journalMode = typeof v === "string" ? v : null;
  } catch {
    journalMode = null;
  }

  let busy: number | null = null;
  let logFrames: number | null = null;
  let checkpointedFrames: number | null = null;
  if (probe) {
    try {
      const row = getDb().prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as
        | Record<string, number>
        | undefined;
      if (row) {
        const vals = Object.values(row);
        [busy, logFrames, checkpointedFrames] = [vals[0] ?? null, vals[1] ?? null, vals[2] ?? null];
      }
    } catch {
      /* leave nulls */
    }
  }

  let walMb: number | null = null;
  try {
    walMb = Math.round((fs.statSync(`${dbPath}-wal`).size / 1048576) * 10) / 10;
  } catch {
    walMb = null;
  }

  const pendingFrames =
    logFrames != null && checkpointedFrames != null ? logFrames - checkpointedFrames : null;

  return {
    journalMode,
    autocheckpoint: one("PRAGMA wal_autocheckpoint"),
    walMb,
    busy,
    logFrames,
    checkpointedFrames,
    pendingFrames,
    // WAL frames carry a page plus a 24-byte header.
    pendingMb: pendingFrames == null ? null : Math.round((pendingFrames * 4120) / 1048576),
  };
}

/**
 * Force a TRUNCATE checkpoint, shrinking the WAL file back to zero.
 *
 * Safe despite appearances: SQLite will not truncate past frames another
 * connection still needs, and Litestream holds a read lock precisely to protect
 * frames it hasn't replicated. So this either succeeds (everything shipped) or
 * returns busy — it cannot silently drop un-replicated frames.
 */
export function checkpointTruncate(): { busy: number | null; logFrames: number | null; checkpointedFrames: number | null; walMbBefore: number | null; walMbAfter: number | null } {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
  const walMb = (): number | null => {
    try {
      return Math.round((fs.statSync(`${dbPath}-wal`).size / 1048576) * 10) / 10;
    } catch {
      return null;
    }
  };
  const walMbBefore = walMb();
  let busy: number | null = null;
  let logFrames: number | null = null;
  let checkpointedFrames: number | null = null;
  try {
    const row = getDb().prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | Record<string, number>
      | undefined;
    if (row) {
      const vals = Object.values(row);
      [busy, logFrames, checkpointedFrames] = [vals[0] ?? null, vals[1] ?? null, vals[2] ?? null];
    }
  } catch (e) {
    log.error("wal_checkpoint_truncate_failed", { message: e instanceof Error ? e.message : String(e) });
  }
  const walMbAfter = walMb();
  log.info("wal_checkpoint_truncate", { busy, logFrames, checkpointedFrames, walMbBefore, walMbAfter });
  return { busy, logFrames, checkpointedFrames, walMbBefore, walMbAfter };
}

/** Post-prune sanity: nothing in the pool should reference a deleted item. */
export function orphanCheck(): { orphanLinks: number; orphanExternalIds: number } {
  return {
    orphanLinks: n(
      "SELECT COUNT(*) n FROM media_links WHERE media_item_id NOT IN (SELECT id FROM media_items)",
    ),
    orphanExternalIds: n(
      "SELECT COUNT(*) n FROM media_external_ids WHERE media_item_id NOT IN (SELECT id FROM media_items)",
    ),
  };
}

export const _PRUNABLE_WHERE_FOR_TEST = PRUNABLE_WHERE;

/** Convenience for tests + the route: is a given id prunable right now? */
export function prunableIds(limit = 10): string[] {
  return query<{ id: string }>(
    `SELECT id FROM media_items WHERE ${PRUNABLE_WHERE} LIMIT ?`,
    [limit],
  ).map((r) => r.id);
}
