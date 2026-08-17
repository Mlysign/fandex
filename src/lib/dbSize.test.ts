import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
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

// Cache contraction, DONE (migration 16, 2026-08-17). What stood here were four
// tests proving the libRowsWithoutState / wishRowsWithoutState counters could
// DETECT drift between user_library / user_watchlist and user_item_state. Those
// counters are retired, and so is the drift: both names are views derived from
// user_item_state, so a cache row with no backing state row is not merely rare,
// it is unconstructible — every one of those tests opened by inserting exactly
// such a row, which SQLite now refuses.
//
// Replacing them with the invariant that made them unnecessary is the point. If
// anyone turns these names back into real tables, the first test below fails
// loudly, where a retired counter would just have gone on reading 0.
describe("user_library / user_watchlist are DERIVED, not stored", () => {
  const USER = "u-derived";
  const ITEM = "derived-item";

  beforeEach(() => {
    run("DELETE FROM user_item_state");
    run("DELETE FROM media_items");
    run("DELETE FROM users");
    run("INSERT INTO users (id) VALUES (?)", [USER]);
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'movie', ?, ?)", [ITEM, ITEM, ITEM]);
  });

  it("are views, not tables — the whole point of migration 16", () => {
    const kinds = query<{ name: string; type: string }>(
      "SELECT name, type FROM sqlite_master WHERE name IN ('user_library','user_watchlist')",
    );
    expect(kinds).toHaveLength(2);
    for (const k of kinds) expect(k.type).toBe("view");
  });

  it("a library row appears and disappears with its state row, with nothing rebuilding it", () => {
    expect(get("SELECT 1 FROM user_library WHERE user_id = ?", [USER])).toBeNull();

    run(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, rating)
       VALUES ('s1', ?, ?, 'tmdb', 'library', 'watched', 8)`,
      [USER, ITEM],
    );
    const row = get<{ rating: number; status: string; platform_sources: string }>(
      "SELECT rating, status, platform_sources FROM user_library WHERE user_id = ? AND media_item_id = ?",
      [USER, ITEM],
    );
    expect(row?.rating).toBe(8);
    expect(row?.status).toBe("watched");
    expect(JSON.parse(row!.platform_sources)).toEqual(["tmdb"]);

    run("DELETE FROM user_item_state WHERE user_id = ? AND relation = 'library'", [USER]);
    expect(get("SELECT 1 FROM user_library WHERE user_id = ?", [USER])).toBeNull();
  });

  it("keeps the relations apart: a wishlist row never surfaces in the library view", () => {
    run(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation)
       VALUES ('s2', ?, ?, 'tmdb', 'wishlist')`,
      [USER, ITEM],
    );
    expect(get("SELECT 1 FROM user_watchlist WHERE user_id = ?", [USER])).not.toBeNull();
    expect(get("SELECT 1 FROM user_library WHERE user_id = ?", [USER])).toBeNull();
  });

  it("averages a multi-source rating the way rebuildCaches used to", () => {
    run(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, rating)
       VALUES ('a', ?, ?, 'trakt', 'library', 'watched', 7), ('b', ?, ?, 'tmdb', 'library', 'watched', 8)`,
      [USER, ITEM, USER, ITEM],
    );
    expect(get<{ rating: number }>("SELECT rating FROM user_library WHERE user_id = ?", [USER])?.rating).toBe(7.5);
  });

  it("refuses a direct write — the exact failure a reintroduced cache write would hit", () => {
    expect(() =>
      run("INSERT INTO user_library (id, user_id, media_item_id) VALUES ('x', ?, ?)", [USER, ITEM]),
    ).toThrow(/cannot modify user_library because it is a view/);
  });
});
