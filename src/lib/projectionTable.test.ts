import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import { upsertMediaItem } from "./matcher";
import { __clearSharedCaches } from "./boundedCache";
import {
  getDerivedForItem, peekDerived, peekDerivedBatch, derivedSignature,
  sweepProjections, type RawLink,
} from "./facetCache";
import { DEFAULT_COUNTRY } from "./countries";
import type { MediaLink } from "@/types";

// 2026-08-28, docs/catalog-growth.md §15 — `media_item_projection` is
// facetCache.derived's disk L2.
//
// WHY it exists, in one measurement: `buildEntries` peeks the memory cache for
// EVERY pool item, and that cache holds 6,000 entries. A pool larger than the
// cap therefore evicts what it just wrote and re-derives the whole catalog from
// blobs on every rebuild. Measured by shrinking the cap rather than growing the
// catalog (same ratio): a memory-warm rebuild is 64–72 ms, a 5×-oversubscribed
// one 436 ms, saturating near 7.7×. With this table the cap stops mattering:
// 171 ms whether the memory cache holds 200 entries or all 2,553.
//
// What has to stay true, and is what this file pins:
//   1. a derive writes a row, and a later read gets it back UNCHANGED
//   2. a row whose freshness token moved is ignored, never served
//   3. the table is bounded by ROWS, evicting oldest-WRITTEN first
//   4. deleting an item takes its projection with it

initDb();

const MOVIE = "movie" as const;

const payload = (director: string, extra: Record<string, unknown> = {}, sourceId = "1") => ({
  id: Number(sourceId), title: `Projected ${sourceId}`, release_date: "2025-01-01", overview: "o",
  vote_average: 7.5, vote_count: 100,
  credits: { crew: [{ job: "Director", name: director }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
  ...extra,
});

// ⚠️ A DISTINCT TITLE **AND** rawData.id PER ITEM, and both are load-bearing.
// The matcher merges on normalized title + release date, AND extractCrossIds
// reads the provider id straight out of the payload — so seeds sharing either
// one collapse into a single media_item and every count below reads 1.
const seed = (sourceId: string, director: string, extra?: Record<string, unknown>) =>
  upsertMediaItem({
    source: "tmdb", sourceId, type: MOVIE, title: `Projected ${sourceId}`,
    releaseDate: "2025-01-01", rawData: payload(director, extra, sourceId),
  });

/** Exactly what a peeking caller's pass-1 SELECT reads. */
function links(mediaItemId: string) {
  const rows = query<{ source: string; source_id: string; release_date: string | null; raw_data: string; last_synced: number; len: number }>(
    `SELECT source, source_id, release_date, raw_data, last_synced, OCTET_LENGTH(raw_data) AS len
       FROM media_links WHERE media_item_id = ?`,
    [mediaItemId]
  );
  return {
    rawLinks: rows.map((r): RawLink => ({
      source: r.source as MediaLink["source"], sourceId: r.source_id,
      releaseDate: r.release_date, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
    })),
    maxLastSynced: rows.reduce((m, r) => Math.max(m, r.last_synced ?? 0), 0),
    rawLen: rows.reduce((n, r) => n + (r.len ?? 0), 0),
  };
}

const projectionRows = () => get<{ n: number }>(`SELECT COUNT(*) n FROM media_item_projection`)?.n ?? 0;

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM media_item_projection");
  __clearSharedCaches();
});

describe("media_item_projection — the derived cache's disk half", () => {
  it("writes a row on derive, and serves it back when memory is empty", () => {
    const id = seed("100", "Greta Gerwig");
    const { rawLinks, maxLastSynced, rawLen } = links(id);
    const sig = derivedSignature();

    const first = getDerivedForItem(id, rawLinks, MOVIE, undefined, sig);
    expect(projectionRows()).toBe(1);

    // Drop the whole memory layer. Without the L2 this is a full re-derive; the
    // point of the table is that it is a row read instead.
    __clearSharedCaches();
    const second = peekDerived(id, maxLastSynced, rawLen, undefined, sig);
    expect(second).toBeDefined();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("survives the JSON round-trip without changing a value", () => {
    // The thing a serialised cache can quietly break: optional fields, numbers
    // and nested shapes. Compared whole rather than field by field.
    const id = seed("101", "Ari Aster", { runtime: 121, tagline: "A tagline" });
    const { rawLinks, maxLastSynced, rawLen } = links(id);
    const derived = getDerivedForItem(id, rawLinks, MOVIE);
    __clearSharedCaches();
    const fromDisk = peekDerived(id, maxLastSynced, rawLen);
    expect(JSON.stringify(fromDisk!.merged)).toBe(JSON.stringify(derived.merged));
    expect(JSON.stringify(fromDisk!.facets)).toBe(JSON.stringify(derived.facets));
  });

  it("ignores a row whose payload changed in the same second", () => {
    // The freshness case the memory cache is already pinned on
    // (discoveryPoolCache.test.ts). last_synced is strftime('%s','now'), so it
    // does not move; the byte count is what catches it, and the disk layer has
    // to honour that too or it serves the pre-rewrite derivation forever.
    const id = seed("102", "Greta Gerwig");
    const before = links(id);
    getDerivedForItem(id, before.rawLinks, MOVIE);

    run(`UPDATE media_links SET raw_data = ? WHERE media_item_id = ?`,
      [JSON.stringify(payload("Bong Joon-ho", { overview: "a longer overview than before" }, "102")), id]);
    const after = links(id);
    expect(after.maxLastSynced).toBe(before.maxLastSynced); // same second, by construction

    __clearSharedCaches();
    expect(peekDerived(id, after.maxLastSynced, after.rawLen)).toBeUndefined();
    expect(getDerivedForItem(id, after.rawLinks, MOVIE).facets.find((f) => f.role === "director")?.label)
      .toBe("Bong Joon-ho");
    // Overwritten in place, not accumulated: the PK is (item, region).
    expect(projectionRows()).toBe(1);
  });

  it("batches a mixed read: some in memory, some on disk, some nowhere", () => {
    const a = seed("103", "Greta Gerwig");
    const b = seed("104", "Ari Aster");
    const c = seed("105", "Bong Joon-ho");
    const refs = [a, b, c].map((id) => ({ id, ...links(id) }));
    for (const r of refs) getDerivedForItem(r.id, r.rawLinks, MOVIE);

    // a stays in memory; b and c come back from disk only.
    __clearSharedCaches();
    const aLinks = links(a);
    getDerivedForItem(a, aLinks.rawLinks, MOVIE);
    run(`DELETE FROM media_item_projection WHERE media_item_id = ?`, [c]);

    const got = peekDerivedBatch(refs.map((r) => ({ id: r.id, maxLastSynced: r.maxLastSynced, rawLen: r.rawLen })));
    expect(got.has(a)).toBe(true);
    expect(got.has(b)).toBe(true);
    expect(got.has(c)).toBe(false);
  });

  it("is bounded by ROWS, evicting the oldest WRITTEN first", () => {
    for (let i = 0; i < 5; i++) {
      const id = seed(`20${i}`, `Director ${i}`);
      const l = links(id);
      getDerivedForItem(id, l.rawLinks, MOVIE);
      // strftime('%s','now') has one-second resolution, so stamp the order
      // explicitly rather than hoping the test runs slowly.
      run(`UPDATE media_item_projection SET written_at = ? WHERE media_item_id = ?`, [1000 + i, id]);
    }
    expect(projectionRows()).toBe(5);

    const { deleted } = sweepProjections(3, 10);
    expect(deleted).toBe(2);
    const left = query<{ written_at: number }>(`SELECT written_at FROM media_item_projection ORDER BY written_at`);
    expect(left.map((r) => r.written_at)).toEqual([1002, 1003, 1004]);
  });

  it("deletes in bounded batches, so a backlog drains over ticks", () => {
    // PR16 deleted 546,754 rows at once for 12.8 GB of WAL churn and took the
    // site down. One pass must never be unbounded.
    for (let i = 0; i < 6; i++) {
      const id = seed(`30${i}`, `Director ${i}`);
      const l = links(id);
      getDerivedForItem(id, l.rawLinks, MOVIE);
    }
    expect(sweepProjections(1, 2).deleted).toBe(2);
    expect(projectionRows()).toBe(4);
    expect(sweepProjections(1, 2).deleted).toBe(2);
    expect(projectionRows()).toBe(2);
  });

  it("does nothing when the table is under the ceiling", () => {
    const id = seed("400", "Greta Gerwig");
    getDerivedForItem(id, links(id).rawLinks, MOVIE);
    expect(sweepProjections(100, 10)).toEqual({ rows: 1, deleted: 0 });
  });

  it("persists the DEFAULT region only", () => {
    // Measured on the real DB before this guard existed: one session stored TWO
    // regions (the pool's DEFAULT_COUNTRY, plus the user's own country from
    // /api/library and /api/calendar) — 4,589 rows for a 2,553-item catalog.
    // Regions multiply, and at 50k items each one is another ~315 MB. Only the
    // pool iterates the whole catalog, and it always uses the default.
    const id = seed("600", "Greta Gerwig");
    const l = links(id);
    getDerivedForItem(id, l.rawLinks, MOVIE, "DE");
    expect(projectionRows()).toBe(0);

    getDerivedForItem(id, l.rawLinks, MOVIE);
    expect(projectionRows()).toBe(1);
    expect(get<{ region: string }>(`SELECT region FROM media_item_projection`)?.region).toBe(DEFAULT_COUNTRY);
  });

  it("sweeps away rows for a region it no longer persists", () => {
    // Nothing reads them, so no size ceiling would ever reach them: without this
    // a policy change leaks the old region's rows forever.
    const id = seed("601", "Ari Aster");
    getDerivedForItem(id, links(id).rawLinks, MOVIE);
    run(`UPDATE media_item_projection SET region = 'DE'`);
    expect(projectionRows()).toBe(1);
    expect(sweepProjections(1000, 10).deleted).toBe(1);
    expect(projectionRows()).toBe(0);
  });

  it("cascades: deleting the item takes its projection with it", () => {
    // This is what stands in for a dbPrune PRUNABLE_WHERE entry. The table must
    // NOT be listed there — it is a cache, and listing it would make every
    // browsed row unprunable — so the FK is what keeps it from orphaning.
    const id = seed("500", "Greta Gerwig");
    getDerivedForItem(id, links(id).rawLinks, MOVIE);
    expect(projectionRows()).toBe(1);
    run(`DELETE FROM media_items WHERE id = ?`, [id]);
    expect(projectionRows()).toBe(0);
  });
});
