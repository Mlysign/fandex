import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query, get } from "./db";
import { upsertMediaItem } from "./matcher";
import { refreshItemStats, itemStatsStatus, statsBatchSize, STATS_TTL_MS } from "./itemStats";
import { catalogSectionPage } from "./catalogFeed";

// Migration 27. The catalog feed could only sort by date, because `media_items`
// held nothing else, so `catalogSectionPage` shipped `voteCount: 0` on every
// row. `decorateSection` turns that into `communityVotes: 0`, and the client's
// Popularity sort is `votesOf(i) = i.communityVotes ?? 0` — so every catalog
// card tied at zero and a stable sort showed ARRIVAL order under a control
// labelled "Popularity". That is the 2026-08-29 search bug exactly.
//
// These tests are about the ways this goes wrong QUIETLY, because a wrong sort
// order has no error and no failing request:
//   * NULL ("not computed") read as 0 ("nobody voted")
//   * SQLite sorting NULL lowest, which reverses a bare `vote_count DESC`
//   * the 0-100 / 0-10 scale confusion between communityAvg and voteAverage
//   * an item with no links parking at the head of the refresh queue forever

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

// ⚠️ The provider id has to be UNIQUE PER FIXTURE, in the payload as well as in
// `sourceId`. A first draft reused `id: 1` in every rawData, and the matcher
// resolved all of them to one media_item via `media_external_ids` — so five
// inserts produced one row and half these tests failed for a reason that had
// nothing to do with what they were testing.
let nextProviderId = 1000;

/** A movie in the PAST browse window, with a TMDB payload carrying crowd stats. */
function makeMovie(title: string, votes: number, average10: number, daysAgo = 30): string {
  const pid = nextProviderId++;
  return upsertMediaItem({
    source: "tmdb",
    sourceId: String(pid),
    type: "movie",
    title,
    releaseDate: iso(-daysAgo),
    rawData: {
      id: pid, title, vote_count: votes, vote_average: average10,
      release_date: iso(-daysAgo), popularity: 1,
    },
  });
}

describe("refreshItemStats", () => {
  beforeEach(() => {
    initDb();
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
  });

  it("fills vote_count and vote_average from links already on disk", () => {
    const id = makeMovie("Loud Film", 4200, 7.5);
    expect(refreshItemStats(50)).toBe(1);

    const row = get<{ vote_count: number; vote_average: number; stats_at: number }>(
      "SELECT vote_count, vote_average, stats_at FROM media_items WHERE id = ?", [id]
    )!;
    expect(row.vote_count).toBe(4200);
    expect(row.stats_at).toBeGreaterThan(0);
    // 0-10, NOT the 0-100 communityAvg. Storing the 100-scale here would double
    // every rating on the catalog path, because decorateSection multiplies it
    // back up for communityScore.
    expect(row.vote_average).toBeGreaterThan(0);
    expect(row.vote_average).toBeLessThanOrEqual(10);
  });

  it("is idempotent: a second pass has nothing left to do", () => {
    makeMovie("Once", 10, 6);
    expect(refreshItemStats(50)).toBe(1);
    expect(refreshItemStats(50)).toBe(0);
  });

  it("respects the batch limit, so one pass cannot walk the whole catalog", () => {
    for (let i = 0; i < 5; i++) makeMovie(`Film ${i}`, i * 100, 5);
    expect(refreshItemStats(2)).toBe(2);
    expect(refreshItemStats(2)).toBe(2);
    expect(refreshItemStats(2)).toBe(1);
    expect(refreshItemStats(2)).toBe(0);
  });

  it("stamps an item with NO links instead of leaving it at the queue head forever", () => {
    // Without the stamp this row is picked every pass, and because it always
    // sorts first (stats_at IS NULL) it starves everything behind it.
    run("INSERT INTO media_items (id, type, title, release_date) VALUES ('bare', 'movie', 'Orphan', ?)", [iso(-10)]);
    expect(refreshItemStats(50)).toBe(1);
    const row = get<{ vote_count: number; stats_at: number }>(
      "SELECT vote_count, stats_at FROM media_items WHERE id = 'bare'"
    )!;
    expect(row.stats_at).toBeGreaterThan(0);
    expect(row.vote_count).toBe(0);
    expect(refreshItemStats(50)).toBe(0);
  });

  it("re-computes a row whose stats have aged past the TTL", () => {
    const id = makeMovie("Ages", 5, 5);
    refreshItemStats(50);
    run("UPDATE media_items SET stats_at = ? WHERE id = ?", [Date.now() - STATS_TTL_MS - 1000, id]);
    expect(refreshItemStats(50)).toBe(1);
  });

  it("takes never-computed rows before merely stale ones", () => {
    const old = makeMovie("Stale", 1, 5);
    refreshItemStats(50);
    run("UPDATE media_items SET stats_at = ? WHERE id = ?", [Date.now() - STATS_TTL_MS - 1000, old]);
    const fresh = makeMovie("Never", 2, 5);

    expect(refreshItemStats(1)).toBe(1);
    // The never-computed row is the one that moved.
    expect(get<{ stats_at: number | null }>("SELECT stats_at FROM media_items WHERE id = ?", [fresh])!.stats_at)
      .not.toBeNull();
  });

  it("reads its batch size at CALL time, not module load", () => {
    // Every safety gate in this repo that was written as a module-load const
    // shipped with a test asserting the DEFAULT instead of the behaviour.
    const prev = process.env.ITEM_STATS_BATCH;
    try {
      process.env.ITEM_STATS_BATCH = "7";
      expect(statsBatchSize()).toBe(7);
      process.env.ITEM_STATS_BATCH = "";
      expect(statsBatchSize()).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.ITEM_STATS_BATCH;
      else process.env.ITEM_STATS_BATCH = prev;
    }
  });

  it("reports progress so the fill is observable", () => {
    makeMovie("A", 1, 5);
    makeMovie("B", 2, 5);
    expect(itemStatsStatus().computed).toBe(0);
    refreshItemStats(50);
    const s = itemStatsStatus();
    expect(s.total).toBe(2);
    expect(s.computed).toBe(2);
    expect(s.stale).toBe(0);
  });
});

describe("catalogSectionPage ordering", () => {
  beforeEach(() => {
    initDb();
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
  });

  it("puts the biggest crowd first, not the newest date", () => {
    makeMovie("Obscure But Recent", 3, 5, 5);
    makeMovie("Famous But Older", 90_000, 8, 300);
    refreshItemStats(50);

    const page = catalogSectionPage("movie", "past", 1);
    expect(page.map((i) => i.title)).toEqual(["Famous But Older", "Obscure But Recent"]);
  });

  it("carries the real numbers through, so the client's Popularity sort is not inert", () => {
    makeMovie("Voted", 1234, 7.5);
    refreshItemStats(50);
    const [item] = catalogSectionPage("movie", "past", 1);
    // These two feed decorateSection's communityVotes / communityScore.
    expect(item.voteCount).toBe(1234);
    expect(item.voteAverage).not.toBeNull();
  });

  it("does not let uncomputed rows page the window BACKWARDS", () => {
    // The trap: SQLite sorts NULL lowest, so a bare `vote_count DESC` would put
    // every not-yet-computed row LAST. On a fresh database that is the whole
    // catalog, and the feed would silently serve its window in reverse.
    makeMovie("Computed Small", 5, 5, 100);
    makeMovie("Uncomputed Newer", 999, 9, 10);
    // Only the first is computed; the second stays NULL.
    const first = query<{ id: string }>("SELECT id FROM media_items WHERE title = 'Computed Small'")[0];
    refreshItemStats(50);
    run("UPDATE media_items SET vote_count = NULL, vote_average = NULL, stats_at = NULL WHERE title = 'Uncomputed Newer'");
    expect(first).toBeTruthy();

    const page = catalogSectionPage("movie", "past", 1);
    // Computed rows lead; the uncomputed one follows rather than displacing it.
    expect(page[0].title).toBe("Computed Small");
    expect(page.map((i) => i.title)).toContain("Uncomputed Newer");
  });

  it("an all-uncomputed window still comes back in date order, not empty or reversed", () => {
    makeMovie("Older", 1, 5, 300);
    makeMovie("Newer", 1, 5, 10);
    const page = catalogSectionPage("movie", "past", 1);
    // "past" pages newest-first.
    expect(page.map((i) => i.title)).toEqual(["Newer", "Older"]);
  });
});
