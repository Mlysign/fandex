import { describe, it, expect } from "vitest";
import fs from "fs";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { PROJECTION_VERSION } from "./sources/project";

// H2a migration-7 DRY RUN against a COPY of the real database.
//
// Per the project's live-migration procedure: never touch the original, run
// against a copy, verify, then measure. Skips when data/rr.db is absent, so CI
// stays green — this is a data check, not a logic check.
//
// It makes its OWN fresh copy every run. The first version reused a copy made by
// hand, which the previous run had already migrated — so the re-run measured a
// 0% shrink and failed. The migration is correctly idempotent; the TEST was the
// thing that wasn't repeatable.

const SOURCE = "data/rr.db";
const COPY = `${process.env.TEMP ?? "/tmp"}/mig7-dryrun.db`;
const hasDb = fs.existsSync(SOURCE);

describe.skipIf(!hasDb)("migration 7 (projection backfill) on a live-DB copy", () => {
  it("shrinks raw_data, stamps every row, and needs no network", () => {
    fs.copyFileSync(SOURCE, COPY); // fresh, unmigrated copy every run
    const db = new Database(COPY);
    const before = db.prepare("SELECT SUM(LENGTH(raw_data)) b, COUNT(*) c FROM media_links").get() as { b: number; c: number };

    const applied = runMigrations(db as any);

    const after = db.prepare("SELECT SUM(LENGTH(raw_data)) b, COUNT(*) c FROM media_links").get() as { b: number; c: number };
    const unstamped = db
      .prepare("SELECT COUNT(*) c FROM media_links WHERE projection_version < ?")
      .get(PROJECTION_VERSION) as { c: number };

    const lines = [
      `applied migrations: ${applied.join(", ")}`,
      `raw_data: ${(before.b / 1048576).toFixed(1)}MB → ${(after.b / 1048576).toFixed(1)}MB ` +
        `(-${(100 * (1 - after.b / before.b)).toFixed(1)}%)`,
      `links: ${before.c} → ${after.c} (must not change)`,
      `rows still unstamped: ${unstamped.c} (must be 0, else ensure*Detail would refetch them)`,
      `user_version: ${db.pragma("user_version", { simple: true })}`,
    ];
    fs.writeFileSync("migration7-out.txt", lines.join("\n"));
    db.close();

    // The migration must not lose or duplicate links.
    expect(after.c).toBe(before.c);
    // Every row must be stamped: an unstamped row reads as stale, and
    // ensureTmdbDetail would refetch it from TMDB on the next detail view.
    expect(unstamped.c).toBe(0);
    // It must actually reclaim space — that's the entire point.
    expect(1 - after.b / before.b).toBeGreaterThan(0.5);
  });
});
