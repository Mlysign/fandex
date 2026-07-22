import { describe, it, expect } from "vitest";
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
