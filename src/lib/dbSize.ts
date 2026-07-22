import fs from "fs";
import path from "path";
import { get, query } from "@/lib/db";

// Where the 2.5 GB went (2026-07-22).
//
// /api/health surfaced that prod's rr.db is ~2476 MB against a ~49 MB local dev
// copy. That file size is the root cause behind the overnight container-memory
// ramp (the kernel caches pages of it, and cgroup v2 bills page cache), and it
// is a volume + backup cost on its own. This module answers "what is actually
// in there" without guessing.
//
// Two tiers, deliberately:
//   - The cheap tier is pragmas + row counts. Safe to hit on prod any time.
//   - The deep tier walks `dbstat`, which is a FULL B-TREE SCAN. On a 2.5 GB DB
//     that reads the whole file — precisely the thing inflating page cache. It
//     is opt-in (?deep=1) so nobody fires it casually.

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export type TableRowCount = { name: string; rows: number | null };

export type TableBytes = { name: string; mb: number; pct: number };

export type DbSizeReport = {
  fileMb: number | null;
  walMb: number | null;
  pageSize: number | null;
  pageCount: number | null;
  /** Pages SQLite has freed but not returned to the OS. Large freelist =>
   *  the file is mostly holes and the fix is VACUUM, not deleting more rows. */
  freelistCount: number | null;
  freeMb: number | null;
  freePct: number | null;
  /** Cheap tier: per-table row counts. */
  tables: TableRowCount[];
  /** Deep tier: exact bytes per table/index from dbstat. null unless ?deep=1. */
  bytesByObject: TableBytes[] | null;
  deepError: string | null;
};

function sizeMb(p: string): number | null {
  try {
    return Math.round((fs.statSync(p).size / 1048576) * 10) / 10;
  } catch {
    return null;
  }
}

function pragmaNumber(name: string): number | null {
  try {
    const row = get<Record<string, number>>(`PRAGMA ${name}`);
    if (!row) return null;
    const v = Object.values(row)[0];
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

export function readDbSize(opts: { deep?: boolean } = {}): DbSizeReport {
  const dbPath =
    process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");

  const pageSize = pragmaNumber("page_size");
  const pageCount = pragmaNumber("page_count");
  const freelistCount = pragmaNumber("freelist_count");

  const freeMb =
    pageSize !== null && freelistCount !== null
      ? Math.round((freelistCount * pageSize) / 1048576)
      : null;
  const freePct =
    pageCount !== null && freelistCount !== null && pageCount > 0
      ? Math.round((freelistCount / pageCount) * 1000) / 10
      : null;

  // Table list straight from sqlite_master, so names are trusted — still quoted
  // properly, because a table name is an identifier, not a string literal.
  let tables: TableRowCount[] = [];
  try {
    const names = query<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );
    tables = names.map(({ name }) => {
      try {
        const row = get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`,
        );
        return { name, rows: row?.n ?? null };
      } catch {
        return { name, rows: null };
      }
    });
    tables.sort((a, b) => (b.rows ?? -1) - (a.rows ?? -1));
  } catch {
    tables = [];
  }

  let bytesByObject: TableBytes[] | null = null;
  let deepError: string | null = null;
  if (opts.deep) {
    try {
      // dbstat is a virtual table over the B-tree; better-sqlite3 ships SQLite
      // with SQLITE_ENABLE_DBSTAT_VTAB, but degrade gracefully if it doesn't.
      const rows = query<{ name: string; bytes: number }>(
        `SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC`,
      );
      const total = rows.reduce((acc, r) => acc + (r.bytes || 0), 0) || 1;
      bytesByObject = rows.map((r) => ({
        name: r.name,
        mb: Math.round((r.bytes / 1048576) * 10) / 10,
        pct: Math.round((r.bytes / total) * 1000) / 10,
      }));
    } catch (e) {
      bytesByObject = null;
      deepError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    fileMb: sizeMb(dbPath),
    walMb: sizeMb(`${dbPath}-wal`),
    pageSize,
    pageCount,
    freelistCount,
    freeMb,
    freePct,
    tables,
    bytesByObject,
    deepError,
  };
}
