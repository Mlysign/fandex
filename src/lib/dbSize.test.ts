import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { readDbSize } from "./dbSize";

// Covers the diagnostic added while chasing the 2026-07-22 memory ramp, where
// /api/health revealed prod's rr.db at ~2476 MB against a ~49 MB dev copy.
//
// The point of these is that a *diagnostic* is worse than useless if it lies —
// a wrong row count or a swallowed dbstat failure sends the next investigation
// down the wrong path, which is the exact failure mode this whole endpoint
// exists to prevent. So: assert it reports real numbers, and assert the deep
// tier is genuinely opt-in (it is a full B-tree scan on a 2.5 GB file).

initDb();

describe("readDbSize", () => {
  it("reports page geometry and a free-space share", () => {
    const r = readDbSize();

    expect(r.pageSize).toBeGreaterThan(0);
    expect(r.pageCount).toBeGreaterThan(0);
    expect(r.freelistCount).not.toBeNull();
    // A fresh DB has few or no free pages, but the share must be a real
    // percentage either way — this is the number that decides "VACUUM" vs
    // "actually delete rows", so a bogus one is actively misleading.
    expect(r.freePct).toBeGreaterThanOrEqual(0);
    expect(r.freePct).toBeLessThanOrEqual(100);
  });

  it("counts rows per table and sorts the biggest first", () => {
    run("DELETE FROM users");
    run("INSERT INTO users (id) VALUES (?)", ["dbsize-a"]);
    run("INSERT INTO users (id) VALUES (?)", ["dbsize-b"]);

    const r = readDbSize();
    const users = r.tables.find((t) => t.name === "users");

    expect(users?.rows).toBe(2);
    // Descending by row count, so the offender is the first thing you read.
    const counts = r.tables.map((t) => t.rows ?? -1);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // sqlite_* internals are noise in a "what is big" report.
    expect(r.tables.some((t) => t.name.startsWith("sqlite_"))).toBe(false);
  });

  it("skips the expensive dbstat scan unless deep is requested", () => {
    const shallow = readDbSize();
    expect(shallow.bytesByObject).toBeNull();
    expect(shallow.deepError).toBeNull();
  });

  it("reports both cache-contraction drift counts in the cheap tier", () => {
    const r = readDbSize();
    expect(r.libRowsWithoutState).not.toBeNull();
    expect(r.wishRowsWithoutState).not.toBeNull();
  });

  it("returns per-object bytes when deep, or records why not", () => {
    const r = readDbSize({ deep: true });

    // dbstat needs SQLITE_ENABLE_DBSTAT_VTAB in the better-sqlite3 build. If it
    // is missing we must SAY so rather than silently returning nothing, or the
    // reader concludes the DB is empty.
    if (r.bytesByObject === null) {
      expect(r.deepError).toBeTruthy();
      return;
    }

    expect(r.deepError).toBeNull();
    expect(r.bytesByObject.length).toBeGreaterThan(0);
    for (const o of r.bytesByObject) {
      expect(o.mb).toBeGreaterThanOrEqual(0);
      expect(o.pct).toBeGreaterThanOrEqual(0);
      expect(o.pct).toBeLessThanOrEqual(100);
    }
    const totalPct = r.bytesByObject.reduce((a, o) => a + o.pct, 0);
    expect(totalPct).toBeGreaterThan(95);
    expect(totalPct).toBeLessThan(105);
  });
});

// Cache-contraction PREP (2026-08-03) — NOT the contraction itself. Migration
// 3's expand-then-contract never contracted user_library/user_watchlist, which
// stayed caches rebuilt from user_item_state on every write (matcher.ts's
// rebuildCaches). Measured drift on the real dev DB was 0/0 — these prove the
// query genuinely DETECTS a real mismatch (not just "runs without throwing",
// which the smoke test above already covers), so PR17 can trust a 0/0 reading
// off prod through the same /api/dev/dbsize cheap tier before anyone drops
// the tables (dbPrune.ts:14-26 already assumes this superset invariant for
// one of its four prune-safety clauses).
describe("libRowsWithoutState / wishRowsWithoutState — detects real drift", () => {
  const USER = "u-dbsize-drift";

  function addItem(id: string) {
    run(
      "INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'movie', ?, ?)",
      [id, id, id],
    );
  }
  const addState = (id: string, relation: "library" | "wishlist") =>
    run(
      "INSERT INTO user_item_state (id, user_id, media_item_id, source, relation) VALUES (?, ?, ?, 'tmdb', ?)",
      [`${id}-st-${relation}`, USER, id, relation],
    );
  const addLibraryRow = (id: string) =>
    run(
      "INSERT INTO user_library (id, user_id, media_item_id) VALUES (?, ?, ?)",
      [`${id}-lib`, USER, id],
    );
  const addWatchlistRow = (id: string) =>
    run(
      "INSERT INTO user_watchlist (id, user_id, media_item_id) VALUES (?, ?, ?)",
      [`${id}-wl`, USER, id],
    );

  beforeEach(() => {
    run("DELETE FROM media_items");
    run("DELETE FROM users");
    run("INSERT INTO users (id) VALUES (?)", [USER]);
  });

  it("reads 0/0 when user_item_state is a strict superset (the healthy case)", () => {
    addItem("consistent-item");
    addLibraryRow("consistent-item");
    addState("consistent-item", "library");

    const r = readDbSize();
    expect(r.libRowsWithoutState).toBe(0);
    expect(r.wishRowsWithoutState).toBe(0);
  });

  it("detects a user_library row with no matching user_item_state row", () => {
    addItem("orphan-library-cache");
    addLibraryRow("orphan-library-cache");
    // deliberately no addState() call — this IS the drift

    const r = readDbSize();
    expect(r.libRowsWithoutState).toBe(1);
    expect(r.wishRowsWithoutState).toBe(0);
  });

  it("detects a user_watchlist row with no matching user_item_state row", () => {
    addItem("orphan-watchlist-cache");
    addWatchlistRow("orphan-watchlist-cache");

    const r = readDbSize();
    expect(r.libRowsWithoutState).toBe(0);
    expect(r.wishRowsWithoutState).toBe(1);
  });

  it("does not cross-count relations: a wishlist state row does not cover a library cache row", () => {
    addItem("wrong-relation");
    addLibraryRow("wrong-relation");
    addState("wrong-relation", "wishlist"); // wrong relation for the library row above

    const r = readDbSize();
    expect(r.libRowsWithoutState).toBe(1);
  });
});
