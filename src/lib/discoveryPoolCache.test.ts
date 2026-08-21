import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertWatchlistEntry, clearWatchlist } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import {
  find, getCatalogFacets, getCatalogIdf, getRawTagCounts, getTagVocab, invalidateDiscoveryCache,
  itemsWithFacet,
} from "./discovery";
import { setIpAlias, setItemIpOverride } from "./ipAlias";

// 2026-08-02 — docs/archive/performance-audit.md §A. `buildCache` no longer re-parses
// the whole pool: it reads metadata + a freshness token in pass 1 and SELECTs
// raw_data in pass 2 for facetCache MISSES only.
//
// Membership correctness is already locked by discoveryPool.test.ts (the pool
// query is unchanged, and still recomputed from SQL on every rebuild). What is
// NEW here is the risk that a rebuild serves a STALE derivation for an item
// whose raw_data changed — which the old always-re-parse build could not do.
//
// The nasty case is two writes to the same link inside ONE second: last_synced
// is strftime('%s','now'), so it does not move, and a freshness key made of it
// alone would hand back the first write's facets. That is not hypothetical —
// enrichment writes right after a sync upsert, and /api/facet/mine heals thin
// links before scoring. Both are sub-second follow-up writes.

initDb();

const USER = "u-poolcache";

const tmdb = (id: number, title: string, director: string) => ({
  id, title, release_date: "2025-01-01", poster_path: "/p.jpg", overview: "o",
  credits: { crew: [{ job: "Director", name: director }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
});

const directorOf = (mediaItemId: string) =>
  getCatalogFacets(mediaItemId)?.find((f) => f.kind === "person" && f.role === "director")?.label;

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

describe("catalog pool — derived-cache freshness", () => {
  it("reflects a re-sync that lands in the SAME SECOND as the first write", () => {
    const id = upsertMediaItem({
      source: "tmdb", sourceId: "20", type: "movie", title: "Resynced",
      releaseDate: "2025-01-01", rawData: tmdb(20, "Resynced", "Ari Aster"),
    });
    invalidateDiscoveryCache();
    expect(directorOf(id)).toBe("Ari Aster");

    // Same link, new payload, immediately after — last_synced almost certainly
    // does not change (1-second resolution). A freshness key that can't see
    // this serves the stale derivation until the 5-minute TTL expires.
    upsertMediaItem({
      source: "tmdb", sourceId: "20", type: "movie", title: "Resynced",
      releaseDate: "2025-01-01", rawData: tmdb(20, "Resynced", "Jordan Peele"),
    });
    invalidateDiscoveryCache();

    expect(directorOf(id)).toBe("Jordan Peele");
  });

  it("derives a newly promoted item correctly while serving the rest from cache", () => {
    // The mixed hit/miss path: one item is already derived (a pass-1 hit), the
    // promoted one has never been seen (a pass-2 miss). Both must be right.
    const owned = upsertMediaItem({
      source: "tmdb", sourceId: "21", type: "movie", title: "Already Pooled",
      releaseDate: "2025-01-01", rawData: tmdb(21, "Already Pooled", "Greta Gerwig"),
    });
    const map = persistDiscoverItems([{
      id: "tmdb-movie-22", type: "movie", title: "Browsed", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "22", data: tmdb(22, "Browsed", "Bong Joon-ho") },
    }]);
    const browsed = map.get("tmdb-movie-22")!;

    invalidateDiscoveryCache();
    expect(directorOf(owned)).toBe("Greta Gerwig");
    expect(getCatalogFacets(browsed)).toBeNull(); // browsed-only: out of the pool

    upsertWatchlistEntry(USER, browsed, "tmdb");
    invalidateDiscoveryCache();

    expect(directorOf(browsed)).toBe("Bong Joon-ho");
    expect(directorOf(owned)).toBe("Greta Gerwig");
  });
});

// The INCREMENTAL path (§A's second half). A wishlist/rating write no longer
// forces a full pool rebuild: content and membership have separate signatures,
// and a membership-only change patches the promoted items into the cached pool.
//
// Crucially these tests must NOT call invalidateDiscoveryCache() after the
// write — that nulls the cache and forces the rebuild, which is exactly the path
// we are trying to avoid, and is why discoveryPool.test.ts (which invalidates
// everywhere) can't cover this. Production doesn't invalidate on a membership
// write either: no wishlist/rating route calls it.
describe("catalog pool — incremental membership patch", () => {
  const seedPool = () => {
    const a = upsertMediaItem({
      source: "tmdb", sourceId: "30", type: "movie", title: "Pooled A",
      releaseDate: "2025-01-01", rawData: tmdb(30, "Pooled A", "Greta Gerwig"),
    });
    const b = upsertMediaItem({
      source: "tmdb", sourceId: "31", type: "movie", title: "Pooled B",
      releaseDate: "2025-01-01", rawData: tmdb(31, "Pooled B", "Ari Aster"),
    });
    const map = persistDiscoverItems([{
      id: "tmdb-movie-32", type: "movie", title: "Browsed C", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "32", data: tmdb(32, "Browsed C", "Bong Joon-ho") },
    }]);
    return { a, b, browsed: map.get("tmdb-movie-32")! };
  };

  // Everything the pool cache exposes, so a patched pool can be compared
  // field-by-field against a from-scratch rebuild of the same DB state.
  const snapshot = () => ({
    titles: find(USER, { limit: 120 }).items.map((i) => i.title).sort(),
    vocab: getTagVocab().map((v) => `${v.key}:${v.count}`).sort(),
    idf: [...getCatalogIdf().entries()].map(([k, v]) => `${k}:${v.toFixed(6)}`).sort(),
    rawTags: [...getRawTagCounts().entries()].map(([k, v]) => `${k}:${v.count}`).sort(),
  });

  it("promotes without a rebuild, and the patched pool equals a rebuilt one", () => {
    const { browsed } = seedPool();
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Pooled A", "Pooled B"]); // warms the cache

    upsertWatchlistEntry(USER, browsed, "tmdb"); // NO invalidate — the real path
    const patched = snapshot();

    expect(patched.titles).toEqual(["Browsed C", "Pooled A", "Pooled B"]);
    expect(directorOf(browsed)).toBe("Bong Joon-ho");

    // The real assertion: a patched pool is INDISTINGUISHABLE from a rebuilt
    // one — same vocab counts, same IDF weights (N grew, so every weight
    // shifted), same raw tag counts. A patch that forgot to fold the new item's
    // facets in, or to recompute IDF, fails here while `titles` alone passes.
    invalidateDiscoveryCache();
    expect(patched).toEqual(snapshot());
  });

  it("demotes correctly too (falls back to a rebuild, still no invalidate)", () => {
    const { browsed } = seedPool();
    upsertWatchlistEntry(USER, browsed, "tmdb");
    invalidateDiscoveryCache();
    expect(snapshot().titles).toEqual(["Browsed C", "Pooled A", "Pooled B"]);

    clearWatchlist(USER, browsed);
    const afterRemoval = snapshot();

    expect(afterRemoval.titles).toEqual(["Pooled A", "Pooled B"]);
    invalidateDiscoveryCache();
    expect(afterRemoval).toEqual(snapshot());
  });

  it("still rebuilds on a CONTENT change, which membership signatures can't see", () => {
    const { a } = seedPool();
    invalidateDiscoveryCache();
    expect(directorOf(a)).toBe("Greta Gerwig");

    // No membership write at all — only content moved. The content signature
    // has to catch this on its own, or the pool serves the old derivation.
    upsertMediaItem({
      source: "tmdb", sourceId: "30", type: "movie", title: "Pooled A",
      releaseDate: "2025-01-01", rawData: tmdb(30, "Pooled A", "Chloe Zhao"),
    });
    // `updated_at` is strftime('%s','now') — 1-second resolution — so a rewrite
    // in the same second as the last build leaves MAX(updated_at) untouched and
    // the pool legitimately keeps serving the cached vectors until the 5-minute
    // TTL. That is PRE-EXISTING (the old single signature was also
    // COUNT + MAX(updated_at)) and unchanged by the content/membership split.
    // Stepping the clock forward is what a real second-later sync does.
    run("UPDATE media_items SET updated_at = updated_at + 10 WHERE id = ?", [a]);

    expect(directorOf(a)).toBe("Chloe Zhao");
  });

  it("acting on an ALREADY-pooled item changes nothing about the pool", () => {
    const { a } = seedPool();
    invalidateDiscoveryCache();
    const before = snapshot();

    // `a` is browsed=0, so it was in the pool already. This moves the
    // membership signature (user_item_state grew) without moving pool
    // membership — the patch must be a no-op, not a duplicate insert.
    upsertWatchlistEntry(USER, a, "tmdb");
    const after = snapshot();

    expect(after).toEqual(before);
    expect(after.titles).toEqual(["Pooled A", "Pooled B"]);
  });
});

// 2026-08-21 — the pool cache guarded itself with the TAG alias signature only,
// so a franchise bundle (or a hand-attached franchise) in /dev/scoring did
// nothing visible for up to five minutes.
//
// Worse than stale: INCONSISTENT. buildEntries() bakes the resolved ip key into
// each cached vector, but an item OUTSIDE the pool has its facets derived per
// request and resolved fresh — so during the window the item asked with the new
// canonical key while every vector still carried the old one, and the franchise
// rail matched only titles whose ORIGINAL key happened to equal the canonical.
// Nils bundled the Spider-Man franchises and the rail showed one film.
//
// Both tests deliberately DO NOT call invalidateDiscoveryCache() after the edit.
// That call is what hid the bug: it is the thing production has no way to make.
describe("catalog pool — franchise bundling and per-item attachment", () => {
  const withCollection = (id: number, title: string, collection: string | null) => ({
    ...tmdb(id, title, "Some Director"),
    belongs_to_collection: collection ? { id, name: collection } : undefined,
  });

  beforeEach(() => {
    run("DELETE FROM ip_alias");
    run("DELETE FROM item_ip_override");
    invalidateDiscoveryCache();
  });

  it("reflects an ip_alias bundle immediately, not on the 5-minute TTL", () => {
    const alpha = upsertMediaItem({
      source: "tmdb", sourceId: "40", type: "movie", title: "Alpha One",
      releaseDate: "2025-01-01", rawData: withCollection(40, "Alpha One", "Alpha Collection"),
    });
    const beta = upsertMediaItem({
      source: "tmdb", sourceId: "41", type: "movie", title: "Beta One",
      releaseDate: "2025-01-01", rawData: withCollection(41, "Beta One", "Beta Collection"),
    });
    invalidateDiscoveryCache();

    // Warm the cache with the pre-bundle world: two separate franchises.
    expect(itemsWithFacet({ kind: "ip", key: "alpha" }).map((v) => v.id)).toEqual([alpha]);
    expect(itemsWithFacet({ kind: "ip", key: "beta" }).map((v) => v.id)).toEqual([beta]);

    setIpAlias("beta", "alpha");

    expect(itemsWithFacet({ kind: "ip", key: "alpha" }).map((v) => v.id).sort())
      .toEqual([alpha, beta].sort());
    expect(itemsWithFacet({ kind: "ip", key: "beta" })).toHaveLength(0);
  });

  it("reflects an item_ip_override attach immediately — the only way a SHOW ever joins a franchise", () => {
    const show = upsertMediaItem({
      source: "tmdb", sourceId: "42", type: "show", title: "Some Series",
      releaseDate: "2025-01-01", rawData: withCollection(42, "Some Series", null),
    });
    invalidateDiscoveryCache();
    expect(itemsWithFacet({ kind: "ip", key: "alpha" })).toHaveLength(0);

    setItemIpOverride(show, "Alpha", "add");

    expect(itemsWithFacet({ kind: "ip", key: "alpha" }).map((v) => v.id)).toEqual([show]);
  });
});
