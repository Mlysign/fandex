import { randomUUID } from "node:crypto";
import { run, get, query } from "@/lib/db";
import type { ImportRow } from "./parse";

// PL4 — where a parsed import waits between "dropped the file" and "made an
// account". Nils approved importing BEFORE signup (2026-08-23) because the data
// is the pitch: seeing 1,400 films matched is a far better reason to sign up
// than a signup wall is.
//
// ⚠️ THIS TABLE IS WRITTEN ON A REQUEST PATH BY ANONYMOUS STRANGERS, which is
// exactly the shape that grew `facet_page_cache` to 24,953 rows / 222 MB, 80% of
// the database. The lessons from that incident are applied here from the start
// rather than after one:
//
//   · an AGE cap is not a SIZE cap        → row and byte ceilings, not just a TTL
//   · a boot-only sweep is not a schedule → prod runs for DAYS; sweep on an interval
//   · evict by WRITE time, never read     → tracking reads makes every hit a write
//
// ⚠️ It deliberately holds NO user_id, because there is no user yet. That means
// `deleteAccount()` cannot cover it: erasure finds tables by a literal `user_id`
// column, and by construction this has none. The TTL is therefore the ONLY thing
// protecting these rows, which makes the sweep a correctness requirement rather
// than housekeeping.
//
// ⚠️ It stages the PARSE, not match results. Two reasons: a media_items id
// staged today can be deleted by the boot prune before the person signs up, and
// re-matching at apply time picks up anything the catalog gained in between.

/** How long an un-claimed import survives. Long enough to sign up and verify. */
export const STAGING_TTL_SECONDS = 24 * 60 * 60;

/** Hard ceilings. Both are enforced on every write, not on a timer. */
export const MAX_STAGED_ROWS = 250_000;      // total rows across the table
export const MAX_ROWS_PER_IMPORT = 20_000;   // one person's archive
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface StagedImport {
  token: string;
  source: string;
  rows: ImportRow[];
  createdAt: number;
}

export class StagingFullError extends Error {}

/**
 * Park a parsed import and return the token that claims it.
 *
 * Sweeps first, so a table that has aged out reclaims itself before the ceiling
 * is tested. A caller that would push the table past its row ceiling is REFUSED
 * rather than accepted-and-trimmed: silently dropping somebody else's pending
 * import to make room is worse than telling this caller to retry.
 */
export function stageImport(source: string, rows: ImportRow[]): StagedImport {
  if (rows.length > MAX_ROWS_PER_IMPORT) {
    throw new StagingFullError(
      `That export has ${rows.length.toLocaleString()} rows, which is more than one import accepts.`,
    );
  }
  sweepStaging();

  const payload = JSON.stringify(rows);
  const byteSize = Buffer.byteLength(payload, "utf8");
  if (byteSize > MAX_PAYLOAD_BYTES) {
    throw new StagingFullError("That export is too large to hold while you sign up.");
  }

  const total = get<{ n: number }>("SELECT COALESCE(SUM(row_count), 0) n FROM import_staging")?.n ?? 0;
  if (total + rows.length > MAX_STAGED_ROWS) {
    throw new StagingFullError("Too many imports are waiting right now. Please try again in a few minutes.");
  }

  const token = randomUUID();
  run(
    "INSERT INTO import_staging (token, source, payload, row_count, byte_size) VALUES (?, ?, ?, ?, ?)",
    [token, source, payload, rows.length, byteSize],
  );
  return { token, source, rows, createdAt: Math.floor(Date.now() / 1000) };
}

/** Read a staged import back. Expired rows read as missing even before a sweep. */
export function readStagedImport(token: string): StagedImport | null {
  const row = get<{ token: string; source: string; payload: string; created_at: number }>(
    "SELECT token, source, payload, created_at FROM import_staging WHERE token = ?",
    [token],
  );
  if (!row) return null;
  if (Math.floor(Date.now() / 1000) - row.created_at > STAGING_TTL_SECONDS) return null;
  try {
    return { token: row.token, source: row.source, rows: JSON.parse(row.payload), createdAt: row.created_at };
  } catch {
    return null;   // a corrupt payload is a missing one, not a crash on a request path
  }
}

/** Drop a staged import. Called the moment it has been applied to an account. */
export function discardStagedImport(token: string): void {
  run("DELETE FROM import_staging WHERE token = ?", [token]);
}

/**
 * Delete rows past the TTL, in BOUNDED batches.
 *
 * Bounded because better-sqlite3 is synchronous and Litestream holds a second
 * connection: an unbounded DELETE on a table that has grown for days blocks the
 * process and stalls replication. Returns how many it removed so a caller can
 * loop or log.
 */
export function sweepStaging(batch = 500): number {
  const cutoff = Math.floor(Date.now() / 1000) - STAGING_TTL_SECONDS;
  const doomed = query<{ token: string }>(
    "SELECT token FROM import_staging WHERE created_at < ? LIMIT ?",
    [cutoff, batch],
  );
  for (const d of doomed) run("DELETE FROM import_staging WHERE token = ?", [d.token]);
  return doomed.length;
}

/** What the table currently holds. For /api/health and the dev size probe. */
export function stagingStats(): { rows: number; entries: number; bytes: number } {
  const r = get<{ entries: number; rows: number; bytes: number }>(
    "SELECT COUNT(*) entries, COALESCE(SUM(row_count),0) rows, COALESCE(SUM(byte_size),0) bytes FROM import_staging",
  );
  return { entries: r?.entries ?? 0, rows: r?.rows ?? 0, bytes: r?.bytes ?? 0 };
}

// ── the interval sweep ───────────────────────────────────────────────────────
// NOT boot-only. `facet_page_cache` shipped with a boot-only sweep, prod ran for
// days without rebooting, and the sweep therefore never ran while the table grew
// all day. `unref()` so this never holds the process open.
let timer: ReturnType<typeof setInterval> | null = null;

export function startStagingSweep(intervalMs = 15 * 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    try { sweepStaging(); } catch { /* a sweep failure must never take the process down */ }
  }, intervalMs);
  timer.unref?.();
}

export function stopStagingSweep(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
