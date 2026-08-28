import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertWatchlistEntry } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import {
  find, getCatalogFacets, getCatalogIdf, getRawTagCounts, getTagVocab,
  invalidateDiscoveryCache,
} from "./discovery";

// 2026-08-28, docs/catalog-growth.md §16 — a CONTENT change patches the pool
// instead of rebuilding it.
//
// Until now, any write that moved `media_items.updated_at` on a pooled row threw
// the whole pool away and re-derived it: every sync, every ingest, every heal by
// the fill job. At 2,553 items that is 590 ms. At the 30–50k phase 4 targets it
// is ~3.4 s of blocking CPU per batch on a single synchronous process, which is
// what made the backfill unshippable.
//
// The reason it could not be incremental before is written into `getCache()`:
// removing an item's contribution needs its RAW (pre-alias) facets, and the pool
// vector only carries post-alias ones. `_cache.rawFacetsById` now keeps them.
//
// ⚠️ So the ONLY question worth testing is exactness. A patched vocab that is
// merely close is not a small bug: `computeIdf` reads those counts, so every
// ranking on the site shifts, silently, with nothing to see. Every test here
// compares a patched pool against a REBUILT one field by field.
//
// ⚠️ These tests must NOT call invalidateDiscoveryCache() after the write —
// that nulls the cache and forces the very rebuild the patch exists to avoid.
// Production does not invalidate on a sync either.

initDb();

const USER = "u-contentpatch";

const tmdb = (id: number, title: string, director: string, genres: string[]) => ({
  id, title, release_date: "2025-01-01", poster_path: "/p.jpg", overview: "o",
  credits: { crew: [{ job: "Director", name: director }], cast: [] },
  genres: genres.map((name, i) => ({ id: i + 1, name })),
});

const seed = (n: number, director: string, genres: string[]) =>
  upsertMediaItem({
    source: "tmdb", sourceId: `c${n}`, type: "movie", title: `Item ${n}`,
    releaseDate: "2025-01-01", rawData: tmdb(7000 + n, `Item ${n}`, director, genres),
  });

/**
 * Re-sync one item, the way a provider pull does, and move its clock forward.
 *
 * ⚠️ The bump is not test scaffolding, it is working around a real limitation:
 * `media_items.updated_at` is strftime('%s','now'), so a re-sync landing in the
 * SAME SECOND as the last pool build moves neither the count nor the MAX, and
 * the content signature cannot see it at all. That hole predates this patch
 * path — the old code did not rebuild either — and the 5-minute TTL is what
 * covers it. Tests run in milliseconds, so without this every re-sync here is
 * invisible and the assertions would be testing nothing.
 * (`discoveryPoolCache.test.ts` bumps the same column for the same reason.)
 */
const resync = (n: number, director: string, genres: string[]) => {
  const id = upsertMediaItem({
    source: "tmdb", sourceId: `c${n}`, type: "movie", title: `Item ${n}`,
    releaseDate: "2025-01-01", rawData: tmdb(7000 + n, `Item ${n}`, director, genres),
  });
  run("UPDATE media_items SET updated_at = updated_at + 10 WHERE id = ?", [id]);
  return id;
};

/** Everything the pool cache exposes, so a patch can be diffed against a rebuild. */
const snapshot = () => ({
  titles: find(USER, { limit: 120 }).items.map((i) => i.title).sort(),
  vocab: getTagVocab().map((v) => `${v.key}:${v.count}`).sort(),
  idf: [...getCatalogIdf().entries()].map(([k, v]) => `${k}:${v.toFixed(6)}`).sort(),
  rawTags: [...getRawTagCounts().entries()].map(([k, v]) => `${k}:${v.count}`).sort(),
});

/** The same thing, forced through a full rebuild. */
const rebuiltSnapshot = () => { invalidateDiscoveryCache(); return snapshot(); };

const directorOf = (id: string) =>
  getCatalogFacets(id)?.find((f) => f.kind === "person" && f.role === "director")?.label;

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM user_item_state");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

describe("catalog pool — incremental CONTENT patch", () => {
  it("patches rather than rebuilding, and the result equals a rebuilt pool", () => {
    const untouched = seed(1, "Greta Gerwig", ["Drama", "Comedy"]);
    const b = seed(2, "Ari Aster", ["Horror"]);
    seed(3, "Bong Joon-ho", ["Thriller"]);
    // ⚠️ Aged out of the watermark second on purpose. The patch selects
    // `updated_at >= prevMx`, and in a test every row is created in the SAME
    // second, so without this the whole catalog lands in the changed set and
    // there is no untouched item left to probe. Production rows are spread over
    // real time; this reproduces that.
    run("UPDATE media_items SET updated_at = updated_at - 100 WHERE id = ?", [untouched]);
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Item 1", "Item 2", "Item 3"]); // warms it

    // The identity probe: an UNCHANGED item keeps its exact facet array through
    // a patch, because its vector object is reused. A rebuild allocates new
    // ones, so this is what separates "patched" from "rebuilt and still right".
    // ⚠️ Pinned to a KNOWN id — reading items[0] would follow the sort, which the
    // change under test can reorder.
    const untouchedBefore = getCatalogFacets(untouched);

    // A re-sync of one item, exactly as a provider pull would write it.
    resync(2, "Chloé Zhao", ["Western"]);

    const patched = snapshot();
    expect(directorOf(b)).toBe("Chloé Zhao");
    const untouchedAfter = getCatalogFacets(untouched);
    expect(untouchedAfter).toBe(untouchedBefore); // same array → the pool was patched

    // The real assertion: indistinguishable from a rebuild.
    expect(patched).toEqual(rebuiltSnapshot());
  });

  it("re-derives the watermark second harmlessly rather than missing a write", () => {
    // The selection is `updated_at >= prevMx`, not `>`. updated_at is
    // strftime('%s','now'), so anything written in the same second as the
    // previous watermark would be invisible to `>` — a silently stale vector,
    // which is the worse failure. The overlap costs a few idempotent
    // re-derivations, and this pins that it stays idempotent.
    seed(70, "Greta Gerwig", ["Drama"]);
    seed(71, "Ari Aster", ["Horror"]);
    invalidateDiscoveryCache();
    const before = snapshot();

    resync(71, "Ari Aster", ["Horror"]); // rewritten identically
    expect(snapshot()).toEqual(before);
    expect(snapshot()).toEqual(rebuiltSnapshot());
  });

  it("removes the departing facets exactly, and adds the arriving ones", () => {
    // The failure a count-only check would miss: a facet only this item carried
    // must LEAVE the vocab, not linger at count 0 where computeIdf still weights
    // it and the tag admin table still lists it.
    const a = seed(10, "Greta Gerwig", ["Steampunk"]);
    seed(11, "Ari Aster", ["Horror"]);
    invalidateDiscoveryCache();
    snapshot();
    expect(getTagVocab().map((v) => v.key)).toContain("steampunk");

    // ⚠️ The replacement must differ in BYTE LENGTH. facetCache's freshness token
    // is (last_synced, OCTET_LENGTH(raw_data)), and within one second only the
    // length moves — so swapping "Steampunk" for "Cyberpunk", both nine bytes,
    // leaves the token identical and the cache correctly serves the OLD
    // derivation. That is the documented limit of a length-not-hash token, and
    // this fixture hit it by accident the first time.
    resync(10, "Greta Gerwig", ["Neo Western Revenge"]);
    const patched = snapshot();

    expect(getTagVocab().map((v) => v.key)).not.toContain("steampunk");
    expect(getTagVocab().map((v) => v.key)).toContain("neo western revenge");
    expect([...getRawTagCounts().keys()]).not.toContain("steampunk");
    expect(directorOf(a)).toBe("Greta Gerwig");
    expect(patched).toEqual(rebuiltSnapshot());
  });

  it("keeps a shared facet's count right when only one of two items drops it", () => {
    // Two items carry Horror; one loses it. The count must go 2 → 1, not to 0
    // and not stay at 2 — the arithmetic a naive "delete the key" would break.
    seed(20, "Ari Aster", ["Horror"]);
    seed(21, "Robert Eggers", ["Horror"]);
    invalidateDiscoveryCache();
    snapshot();
    expect(getTagVocab().find((v) => v.key === "horror")?.count).toBe(2);

    resync(21, "Robert Eggers", ["Drama"]);
    const patched = snapshot();

    expect(getTagVocab().find((v) => v.key === "horror")?.count).toBe(1);
    expect(patched).toEqual(rebuiltSnapshot());
  });

  it("folds a brand-new pooled item in, with no old contribution to remove", () => {
    seed(30, "Greta Gerwig", ["Drama"]);
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Item 30"]);

    seed(31, "Ari Aster", ["Horror"]);
    const patched = snapshot();

    expect(patched.titles).toEqual(["Item 30", "Item 31"]);
    // N moved, so every IDF weight shifted: comparing them is what proves the
    // pool size was recomputed and not just the vocab.
    expect(patched).toEqual(rebuiltSnapshot());
  });

  it("still promotes a browsed item, with content changing in the same pass", () => {
    // Both patch paths at once, which is the case a single-path test misses:
    // membership brought an item in AND the catalog's content moved.
    seed(40, "Greta Gerwig", ["Drama"]);
    const map = persistDiscoverItems([{
      id: "tmdb-movie-7099", type: "movie", title: "Browsed", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "7099", data: tmdb(7099, "Browsed", "Bong Joon-ho", ["Thriller"]) },
    }]);
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Item 40"]);

    seed(41, "Ari Aster", ["Horror"]);                    // content
    upsertWatchlistEntry(USER, map.get("tmdb-movie-7099")!, "tmdb"); // membership

    const patched = snapshot();
    expect(patched.titles).toEqual(["Browsed", "Item 40", "Item 41"]);
    expect(patched).toEqual(rebuiltSnapshot());
  });

  it("rebuilds instead of patching when a pooled row disappears", () => {
    // A deletion cannot be patched: which row went is unknowable from an
    // aggregate, because it is gone. Falling back is the correct answer, and
    // the result still has to be right.
    seed(50, "Greta Gerwig", ["Drama"]);
    const b = seed(51, "Ari Aster", ["Horror"]);
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Item 50", "Item 51"]);

    run("DELETE FROM media_items WHERE id = ?", [b]);
    const after = snapshot();

    expect(after.titles).toEqual(["Item 50"]);
    expect(getTagVocab().map((v) => v.key)).not.toContain("horror");
    expect(after).toEqual(rebuiltSnapshot());
  });

  it("survives a change to an item carrying no tags at all", () => {
    // rawTagCounts only counts tag facets, so an item with none must unfold
    // cleanly rather than underflowing on a key it never wrote.
    const a = seed(60, "Greta Gerwig", []);
    invalidateDiscoveryCache();
    snapshot();

    resync(60, "Ari Aster", []);
    const patched = snapshot();
    expect(directorOf(a)).toBe("Ari Aster");
    expect(patched).toEqual(rebuiltSnapshot());
  });
});
