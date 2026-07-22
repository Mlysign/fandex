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
