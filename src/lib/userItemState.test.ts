import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import {
  upsertMediaItem,
  upsertWatchlistEntry,
  removeWatchlistSource,
  upsertLibraryEntry,
  removeLibrarySource,
  recordLibraryRating,
} from "./matcher";

// D1/D2: user_item_state is the normalized truth; user_watchlist/user_library are
// caches rebuilt from it. These lock in: per-source rows are written, the canonical
// rating is the average across sources, clearing propagates, and removing the last
// source deletes the cache row. D5: media_external_ids is populated for matching.

initDb();

const USER = "u-test";
let item: string;

beforeEach(() => {
  run("DELETE FROM media_items");           // cascades media_links / user_* via FK
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  item = upsertMediaItem({
    source: "trakt", sourceId: "500", type: "movie", title: "Heat", releaseDate: "1995-12-15",
    rawData: { ids: { trakt: 500, tmdb: 949 }, title: "Heat", released: "1995-12-15" },
  });
});

describe("D5 media_external_ids", () => {
  it("indexes a link's embedded cross-ids (trakt + tmdb)", () => {
    const rows = query<{ source: string; external_id: string }>(
      "SELECT source, external_id FROM media_external_ids WHERE media_item_id = ? ORDER BY source", [item]
    );
    expect(rows).toEqual([
      { source: "tmdb", external_id: "949" },
      { source: "trakt", external_id: "500" },
    ]);
  });
});

describe("D1/D2 wishlist", () => {
  it("writes a wishlist truth row and rebuilds the cache; removal deletes it", () => {
    upsertWatchlistEntry(USER, item, "trakt");
    expect(query("SELECT 1 FROM user_item_state WHERE relation='wishlist' AND source='trakt'").length).toBe(1);
    expect(JSON.parse(get<{ platform_sources: string }>("SELECT platform_sources FROM user_watchlist WHERE media_item_id=?", [item])!.platform_sources))
      .toEqual(["trakt"]);

    upsertWatchlistEntry(USER, item, "tmdb"); // idempotent add of a second source
    expect(JSON.parse(get<{ platform_sources: string }>("SELECT platform_sources FROM user_watchlist WHERE media_item_id=?", [item])!.platform_sources).sort())
      .toEqual(["tmdb", "trakt"]);

    removeWatchlistSource(USER, item, "trakt");
    removeWatchlistSource(USER, item, "tmdb");
    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).toBeNull();
    expect(query("SELECT 1 FROM user_item_state WHERE relation='wishlist'").length).toBe(0);
  });
});

describe("D1 library", () => {
  it("averages per-source ratings into the canonical cache", () => {
    upsertLibraryEntry(USER, item, "trakt", { status: "watched", rating: 8, reviewedAt: 100 });
    upsertLibraryEntry(USER, item, "tmdb", { status: "watched", rating: 6, reviewedAt: 200 });
    const cache = get<{ rating: number; reviewed_at: number }>("SELECT rating, reviewed_at FROM user_library WHERE media_item_id=?", [item])!;
    expect(cache.rating).toBe(7);          // (8 + 6) / 2
    expect(cache.reviewed_at).toBe(200);   // most recent across sources
    expect(query("SELECT 1 FROM user_item_state WHERE relation='library'").length).toBe(2);
  });

  it("clearing a rating propagates to the canonical cache (the old un-propagated bug)", () => {
    upsertLibraryEntry(USER, item, "trakt", { status: "watched", rating: 9, reviewedAt: 100 });
    expect(get<{ rating: number }>("SELECT rating FROM user_library WHERE media_item_id=?", [item])!.rating).toBe(9);
    recordLibraryRating(USER, item, { rating: null, status: null, sources: [], reviewedAt: 300 });
    expect(get<{ rating: number | null }>("SELECT rating FROM user_library WHERE media_item_id=?", [item])!.rating).toBeNull();
  });

  it("removing the last library source deletes the cache row", () => {
    upsertLibraryEntry(USER, item, "trakt", { status: "watched", rating: 7, reviewedAt: 100 });
    removeLibrarySource(USER, item, "trakt");
    expect(get("SELECT 1 FROM user_library WHERE media_item_id=?", [item])).toBeNull();
  });

  it("records a local-only rating when no platform was pushed to", () => {
    const { rating } = recordLibraryRating(USER, item, { rating: 5, status: "watched", sources: [], reviewedAt: 100 });
    expect(rating).toBe(5);
    expect(get<{ source: string }>("SELECT source FROM user_item_state WHERE relation='library'", [])!.source).toBe("local");
  });
});
