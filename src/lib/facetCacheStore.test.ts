import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initDb, run, query } from "@/lib/db";
import { readFacetCache, writeFacetCache, sweepFacetCache } from "@/lib/facetCacheStore";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("facetCacheStore", () => {
  initDb();
  beforeEach(() => {
    run("DELETE FROM facet_page_cache");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a payload", () => {
    writeFacetCache("k1", '{"items":[]}');
    expect(readFacetCache("k1", DAY)).toBe('{"items":[]}');
  });

  it("returns null for an absent key", () => {
    expect(readFacetCache("nope", DAY)).toBeNull();
  });

  it("returns null once the row is older than maxAgeMs", () => {
    writeFacetCache("k2", "payload");
    // Backdate rather than waiting: 25 h against a 24 h max.
    run("UPDATE facet_page_cache SET created_at = ? WHERE key = ?", [Date.now() - 25 * HOUR, "k2"]);
    expect(readFacetCache("k2", DAY)).toBeNull();
    // Still PRESENT — expiry is a read-time decision, so the sweep can collect it.
    expect(query("SELECT key FROM facet_page_cache WHERE key = 'k2'")).toHaveLength(1);
  });

  it("overwrites an existing key rather than erroring on the primary key", () => {
    writeFacetCache("k3", "first");
    writeFacetCache("k3", "second");
    expect(readFacetCache("k3", DAY)).toBe("second");
    expect(query("SELECT key FROM facet_page_cache")).toHaveLength(1);
  });

  // The whole point of the module: it sits on a request path, so a failure must
  // degrade to a cache miss, never propagate.
  //
  // Provoked with a REAL error (the table genuinely missing) rather than a mock:
  // the module destructures `query`/`run` at import time, so a `vi.spyOn` on the
  // db module object would never be seen by the already-bound references — it
  // would pass while testing nothing. Dropping the table exercises the actual
  // try/catch.
  describe("degrades to a miss when the table is unavailable", () => {
    beforeEach(() => { run("DROP TABLE IF EXISTS facet_page_cache"); });
    afterEach(() => {
      // Recreated explicitly rather than via initDb(), which is guarded to run
      // its schema block once per process and so would be a no-op here.
      run(`CREATE TABLE IF NOT EXISTS facet_page_cache (
             key TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    });

    it("swallows a write failure instead of throwing", () => {
      expect(() => writeFacetCache("k4", "x")).not.toThrow();
    });

    it("returns null rather than throwing when the read fails", () => {
      expect(readFacetCache("k5", DAY)).toBeNull();
    });

    it("returns 0 rather than throwing when the sweep fails", () => {
      expect(sweepFacetCache(DAY)).toBe(0);
    });
  });

  it("sweeps only expired rows, and no more than `limit` of them", () => {
    for (let i = 0; i < 5; i++) writeFacetCache(`old${i}`, "x");
    run("UPDATE facet_page_cache SET created_at = ?", [Date.now() - 25 * HOUR]);
    writeFacetCache("fresh", "x"); // written after the backdate, so still current

    const deleted = sweepFacetCache(DAY, 3);
    expect(deleted).toBe(3);
    expect(query("SELECT key FROM facet_page_cache")).toHaveLength(3); // 5 - 3 + fresh
    expect(readFacetCache("fresh", DAY)).toBe("x");

    expect(sweepFacetCache(DAY, 100)).toBe(2);
    expect(query("SELECT key FROM facet_page_cache")).toHaveLength(1);
  });

  it("sweeps nothing when everything is fresh", () => {
    writeFacetCache("a", "x");
    writeFacetCache("b", "x");
    expect(sweepFacetCache(DAY)).toBe(0);
    expect(query("SELECT key FROM facet_page_cache")).toHaveLength(2);
  });
});
