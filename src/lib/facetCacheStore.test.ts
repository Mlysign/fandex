import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initDb, run, query } from "@/lib/db";
import { readFacetCache, writeFacetCache, sweepFacetCache, trimFacetCacheToRows } from "@/lib/facetCacheStore";

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

    it("returns 0 rather than throwing when the trim fails", () => {
      expect(trimFacetCacheToRows(0)).toBe(0);
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

  // ── The 2026-08-19 bound. The age sweep above passed the whole time this
  // table grew to 24,953 rows / 222.8 MB on prod, because every row a crawler
  // writes inside the TTL window is fresh by definition. These pin the cap that
  // an age cap cannot give.
  describe("row cap", () => {
    it("evicts the OLDEST rows down to maxRows", () => {
      // Distinct created_at per row, so "oldest" is unambiguous.
      for (let i = 0; i < 6; i++) {
        writeFacetCache(`k${i}`, "x");
        run("UPDATE facet_page_cache SET created_at = ? WHERE key = ?", [1000 + i, `k${i}`]);
      }
      expect(trimFacetCacheToRows(2)).toBe(4);
      const left = query<{ key: string }>("SELECT key FROM facet_page_cache ORDER BY key").map((r) => r.key);
      expect(left).toEqual(["k4", "k5"]);
    });

    it("evicts regardless of age — every row here is fresh", () => {
      for (let i = 0; i < 4; i++) writeFacetCache(`f${i}`, "x");
      expect(sweepFacetCache(DAY)).toBe(0); // nothing is expired...
      expect(trimFacetCacheToRows(1)).toBe(3); // ...and the cap still bites
    });

    it("deletes no more than `limit` in one pass, so a backlog drains over ticks", () => {
      for (let i = 0; i < 10; i++) {
        writeFacetCache(`b${i}`, "x");
        run("UPDATE facet_page_cache SET created_at = ? WHERE key = ?", [1000 + i, `b${i}`]);
      }
      expect(trimFacetCacheToRows(2, 3)).toBe(3);
      expect(query("SELECT key FROM facet_page_cache")).toHaveLength(7);
      expect(trimFacetCacheToRows(2, 3)).toBe(3);
      expect(trimFacetCacheToRows(2, 3)).toBe(2);
      expect(trimFacetCacheToRows(2, 3)).toBe(0);
    });

    it("does nothing when the table is under the cap", () => {
      writeFacetCache("only", "x");
      expect(trimFacetCacheToRows(100)).toBe(0);
      expect(readFacetCache("only", DAY)).toBe("x");
    });
  });

  // Payloads are gzipped as of 2026-08-19 (~4x on JSON of this shape), which is
  // what buys the row cap real slug coverage per MB.
  describe("compression", () => {
    it("stores a BLOB, not the raw string", () => {
      const payload = JSON.stringify({ items: Array.from({ length: 40 }, (_, i) => ({ id: i, title: "Title" })) });
      writeFacetCache("gz", payload);
      const stored = query<{ payload: unknown }>("SELECT payload FROM facet_page_cache WHERE key = 'gz'")[0].payload;
      expect(Buffer.isBuffer(stored)).toBe(true);
      expect((stored as Buffer).length).toBeLessThan(payload.length);
      expect(readFacetCache("gz", DAY)).toBe(payload);
    });

    it("still reads rows written before compression shipped", () => {
      // Written as a plain string, exactly as every existing prod row is.
      run("INSERT INTO facet_page_cache (key, payload, created_at) VALUES (?, ?, ?)", [
        "legacy",
        '{"items":[1]}',
        Date.now(),
      ]);
      expect(readFacetCache("legacy", DAY)).toBe('{"items":[1]}');
    });

    it("treats an undecodable row as a miss instead of throwing", () => {
      run("INSERT INTO facet_page_cache (key, payload, created_at) VALUES (?, ?, ?)", [
        "corrupt",
        Buffer.from([0x1f, 0x8b, 0x00, 0x01, 0x02]), // gzip magic, truncated body
        Date.now(),
      ]);
      expect(readFacetCache("corrupt", DAY)).toBeNull();
    });
  });
});
