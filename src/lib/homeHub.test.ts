import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "@/lib/db";
import { hubItems, hubGenres, _resetHubCacheForTests } from "./homeHub";

// SEO (2026-08-20) — the homepage hub. `/` linked to nothing at all before
// this; these cover the two things that would quietly bring the dead end back:
// a genre list that drifts from the provider maps, and a pool query that lets
// browsed-only rows in.

initDb();

function addItem(id: string, title: string, type: string, browsed: number, lastSynced: number) {
  run(
    "INSERT INTO media_items (id, type, title, browsed, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
    [id, type, title, browsed]
  );
  run(
    "INSERT INTO media_links (media_item_id, source, source_id, media_type, title, raw_data, last_synced) VALUES (?, 'tmdb', ?, ?, ?, '{}', ?)",
    [id, `src-${id}`, type, title, lastSynced]
  );
}

describe("hubItems", () => {
  beforeEach(() => {
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
    _resetHubCacheForTests();
  });

  it("returns pool items newest-synced first, so the linked set rotates as the catalog syncs", () => {
    addItem("a", "Older", "movie", 0, 100);
    addItem("b", "Newer", "movie", 0, 300);
    addItem("c", "Middle", "game", 0, 200);

    expect(hubItems().map((i) => i.title)).toEqual(["Newer", "Middle", "Older"]);
  });

  it("excludes browsed-only rows — the hub advertises the catalog, not the crawl tail", () => {
    addItem("real", "Real catalog title", "movie", 0, 100);
    addItem("browsed", "Browsed-only title", "movie", 1, 999);

    const titles = hubItems().map((i) => i.title);
    expect(titles).toContain("Real catalog title");
    expect(titles).not.toContain("Browsed-only title");
  });

  it("skips an item with no title rather than emitting a blank link", () => {
    addItem("blank", "   ", "movie", 0, 200);
    addItem("ok", "Has a title", "movie", 0, 100);

    expect(hubItems().map((i) => i.title)).toEqual(["Has a title"]);
  });

  it("carries the type through, so buildItemHref can address the item", () => {
    addItem("g", "A Game", "game", 0, 100);
    expect(hubItems()[0]).toMatchObject({ id: "g", type: "game", title: "A Game" });
  });

  it("returns an empty list on an empty catalog instead of throwing", () => {
    expect(hubItems()).toEqual([]);
  });
});

describe("hubGenres", () => {
  it("only offers genres that resolve a real provider pool", () => {
    const keys = hubGenres().map((g) => g.key);
    // Present in the TMDB movie map, the TMDB TV map and the RAWG map
    // respectively — the union is the point.
    expect(keys).toContain("horror");
    expect(keys).toContain("documentary");
    expect(keys).toContain("strategy");
  });

  it("drops TMDB's composite TV genres, whose parts are already listed", () => {
    for (const g of hubGenres()) expect(g.key).not.toContain("&");
    // The plain halves survive.
    const keys = hubGenres().map((g) => g.key);
    expect(keys).toContain("action");
    expect(keys).toContain("fantasy");
  });

  it("emits no duplicate keys", () => {
    const keys = hubGenres().map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is capped, sorted by label, and labelled for display", () => {
    const genres = hubGenres();
    expect(genres.length).toBeLessThanOrEqual(60);
    expect(genres.length).toBeGreaterThan(10);

    const labels = genres.map((g) => g.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    // Keys are normalized lowercase; the chip is not.
    expect(labels.every((l) => l === l.replace(/\b\w/g, (c) => c.toUpperCase()))).toBe(true);
  });
});

describe("hubGenres — alias pairs must not become two competing facet pages", () => {
  it("keeps one key per provider target, not both spellings", () => {
    const keys = hubGenres().map((g) => g.key);
    // Both halves of each pair map to the same provider id/slug. Linking both
    // would put two near-identical pages in front of a crawler for one query.
    expect(keys.filter((k) => k === "science fiction" || k === "sci fi")).toHaveLength(1);
    expect(keys.filter((k) => k === "rpg" || k === "role playing")).toHaveLength(1);
  });

  it("still covers all three provider maps after that dedupe", () => {
    const keys = hubGenres().map((g) => g.key);
    // Regression guard for the cap bug: an alphabetical cut removed every RAWG
    // game genre while every check above still passed.
    expect(keys).toContain("strategy");
    expect(keys).toContain("shooter");
    expect(keys).toContain("simulation");
    expect(keys).toContain("kids");      // TMDB TV only
    expect(keys).toContain("western");   // TMDB movie
  });
});
