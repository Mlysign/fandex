import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { fillCandidates, fillBacklog } from "./catalogFill";
import { PROJECTION_VERSION } from "./sources/project";

// The background half of catalog-growth phase 1. What is worth pinning is the
// ORDER, because it is the only judgement in the file: a thin row in somebody's
// own library is the most visible kind, pool rows are what the catalog surfaces
// rank, and nothing may starve behind either.

initDb();

const USER = "u-fill";

function item(id: string, opts: { browsed?: number; version?: number; synced?: number } = {}) {
  run("INSERT INTO media_items (id, type, title, browsed, created_at, updated_at) VALUES (?, 'movie', ?, ?, 0, 0)",
    [id, id, opts.browsed ?? 0]);
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data, last_synced, projection_version)
     VALUES (?, ?, 'tmdb', ?, 'movie', ?, '{}', ?, ?)`,
    [`l-${id}`, id, id, id, opts.synced ?? 0, opts.version ?? 0]
  );
}

beforeEach(() => {
  run("DELETE FROM user_item_state");
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

describe("fillCandidates", () => {
  it("puts an item somebody acted on ahead of a pool item", () => {
    item("pool", { synced: 1 });
    item("mine", { synced: 999 }); // fresher, and still first
    run("INSERT INTO user_item_state (id, user_id, media_item_id, source, relation) VALUES ('s1', ?, 'mine', 'trakt', 'library')", [USER]);
    expect(fillCandidates(10).map((c) => c.id)).toEqual(["mine", "pool"]);
  });

  it("puts a pool item ahead of a browsed one", () => {
    item("browsed", { browsed: 1, synced: 1 });
    item("pool", { browsed: 0, synced: 2 });
    expect(fillCandidates(10).map((c) => c.id)).toEqual(["pool", "browsed"]);
  });

  it("breaks ties by the oldest sync, so nothing starves", () => {
    item("newer", { synced: 500 });
    item("older", { synced: 5 });
    expect(fillCandidates(10).map((c) => c.id)).toEqual(["older", "newer"]);
  });

  it("ignores links already at the current projection version", () => {
    item("stale", { version: 0 });
    item("fresh", { version: PROJECTION_VERSION });
    expect(fillCandidates(10).map((c) => c.id)).toEqual(["stale"]);
  });

  it("returns one row per item, not one per link", () => {
    item("two-links");
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data, last_synced, projection_version)
       VALUES ('l2', 'two-links', 'igdb', 'x', 'movie', 't', '{}', 0, 0)`
    );
    expect(fillCandidates(10)).toHaveLength(1);
  });

  it("respects the batch limit", () => {
    for (let i = 0; i < 5; i++) item(`i${i}`, { synced: i });
    expect(fillCandidates(2)).toHaveLength(2);
  });
});

describe("fillBacklog", () => {
  it("counts items, and reaches zero when everything is current", () => {
    item("a");
    item("b", { version: PROJECTION_VERSION });
    expect(fillBacklog()).toBe(1);
    run("UPDATE media_links SET projection_version = ?", [PROJECTION_VERSION]);
    expect(fillBacklog()).toBe(0);
  });
});
