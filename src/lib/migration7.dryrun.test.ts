import { describe, it, expect } from "vitest";
import fs from "fs";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { PROJECTION_VERSION } from "./sources/project";

// Migration DRY RUN against a COPY of the real database — the pre-deploy check.
//
// Per the project's live-migration procedure: never touch the original, run
// against a copy, verify, then measure. Skips when data/rr.db is absent, so CI
// stays green — this is a data check, not a logic check.
//
// It makes its OWN fresh copy every run. The first version reused a copy made by
// hand, which the previous run had already migrated — so the re-run measured a
// 0% shrink and failed. The migration is correctly idempotent; the TEST was the
// thing that wasn't repeatable.
//
// NOTE this runs the WHOLE MIGRATIONS list, not just 7 — it is the closest thing
// to a rehearsal of what happens on the live volume at boot. It matters more than
// usual because `scripts/migrate.mjs` (the documented standalone apply/verify
// tool) has been BROKEN since H2a: migration 7 imports `@/lib/sources/project`,
// which node can't resolve, and which the file's own "pure SQL only, no app
// imports" rule exists to prevent. Until that's fixed, this test IS the
// verification step.

const SOURCE = "data/rr.db";
const COPY = `${process.env.TEMP ?? "/tmp"}/mig-dryrun.db`;
const hasDb = fs.existsSync(SOURCE);

describe.skipIf(!hasDb)("migrations on a live-DB copy", () => {
  it("m7: shrinks raw_data, stamps every row, and needs no network", () => {
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

  // H2b — migration 8 adds media_items.browsed. It's additive with a DEFAULT, so
  // the risk isn't the ALTER, it's the backfill semantics: every row that exists
  // when it runs predates discover-persist and is therefore pool (browsed = 0).
  // If the DEFAULT were ever wrong, the whole live catalog would silently vanish
  // from Best-match/Insights — a total, quiet loss of the catalog surfaces.
  it("m8: backfills the whole existing catalog into the pool (browsed = 0)", () => {
    fs.copyFileSync(SOURCE, COPY);
    const db = new Database(COPY);
    const total = (db.prepare("SELECT COUNT(*) c FROM media_items").get() as { c: number }).c;

    runMigrations(db as any);

    expect(db.pragma("user_version", { simple: true })).toBe(8);
    const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "browsed")).toBe(true);

    // Not one pre-existing item may land outside the pool.
    const browsed = (db.prepare("SELECT COUNT(*) c FROM media_items WHERE browsed <> 0").get() as { c: number }).c;
    expect(browsed).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM media_items").get() as { c: number }).c).toBe(total);

    // Idempotent: re-running is a no-op, not a second ALTER (which would throw).
    expect(runMigrations(db as any)).toEqual([]);
    db.close();
  });
});
