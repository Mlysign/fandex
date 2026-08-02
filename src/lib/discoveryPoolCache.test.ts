import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertWatchlistEntry } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import { getCatalogFacets, invalidateDiscoveryCache } from "./discovery";

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
