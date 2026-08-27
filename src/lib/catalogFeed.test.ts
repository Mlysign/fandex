import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { catalogSectionPage, withCatalogFallback } from "./catalogFeed";
import type { FeedCandidate } from "./discoverFeed";

// The outage fallback (catalog-growth phase 2, first slice). Measured on prod
// 2026-08-27: both games providers circuit-open at once, `?section=games`
// returned `{"items":[]}`, and the whole category vanished from Discover while
// thousands of games sat in the database unreachable.

initDb();

const day = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function game(id: string, title: string, releaseDate: string | null) {
  run(
    "INSERT INTO media_items (id, type, title, release_date, poster_url, created_at, updated_at) VALUES (?, 'game', ?, ?, '/p.jpg', 0, 0)",
    [id, title, releaseDate]
  );
}

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
});

describe("catalogSectionPage", () => {
  it("returns titles inside the future window, soonest first", () => {
    game("a", "Later", day(60));
    game("b", "Sooner", day(5));
    expect(catalogSectionPage("game", "future").map((c) => c.title)).toEqual(["Sooner", "Later"]);
  });

  it("reverses for the past window, most recent first", () => {
    game("a", "Older", day(-200));
    game("b", "Recent", day(-3));
    expect(catalogSectionPage("game", "past").map((c) => c.title)).toEqual(["Recent", "Older"]);
  });

  it("excludes anything outside the window or with no date", () => {
    game("in", "In window", day(10));
    game("far", "Way out", day(2000));
    game("undated", "No date", null);
    expect(catalogSectionPage("game", "future").map((c) => c.title)).toEqual(["In window"]);
  });

  it("only returns the type asked for", () => {
    game("g", "A game", day(10));
    run("INSERT INTO media_items (id, type, title, release_date, created_at, updated_at) VALUES ('m', 'movie', 'A movie', ?, 0, 0)", [day(10)]);
    expect(catalogSectionPage("game", "future").map((c) => c.title)).toEqual(["A game"]);
    expect(catalogSectionPage("movie", "future").map((c) => c.title)).toEqual(["A movie"]);
  });

  it("pages", () => {
    for (let i = 0; i < 5; i++) game(`g${i}`, `G${i}`, day(i + 1));
    expect(catalogSectionPage("game", "future", 1, 2).map((c) => c.title)).toEqual(["G0", "G1"]);
    expect(catalogSectionPage("game", "future", 2, 2).map((c) => c.title)).toEqual(["G2", "G3"]);
    expect(catalogSectionPage("game", "future", 9, 2)).toEqual([]);
  });

  it("carries provider ids so user state still resolves, skipping non-numeric ones", () => {
    game("g", "A game", day(10));
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data, last_synced)
       VALUES ('l1', 'g', 'igdb', '42', 'game', 'A game', '{}', 0), ('l2', 'g', 'steam', 'abc', 'game', 'A game', '{}', 0)`
    );
    const [c] = catalogSectionPage("game", "future");
    expect(c.ids).toEqual({ igdb: 42 });
  });

  it("never carries a payload to persist — these rows already exist", () => {
    game("g", "A game", day(10));
    expect(catalogSectionPage("game", "future")[0].raw).toBeNull();
  });
});

describe("withCatalogFallback", () => {
  const live = [{ id: "live", title: "From a provider" } as unknown as FeedCandidate];

  it("passes the provider's answer straight through", () => {
    game("g", "Stored", day(10));
    const got = withCatalogFallback(live, "game", "future");
    expect(got.fellBack).toBe(false);
    expect(got.items).toBe(live);
  });

  it("serves the catalog when the provider gave nothing", () => {
    game("g", "Stored", day(10));
    const got = withCatalogFallback([], "game", "future");
    expect(got.fellBack).toBe(true);
    expect(got.items.map((c) => c.title)).toEqual(["Stored"]);
  });

  it("reports no fallback when we hold nothing either", () => {
    const got = withCatalogFallback([], "game", "future");
    expect(got.fellBack).toBe(false);
    expect(got.items).toEqual([]);
  });

  it("does NOT top up a short provider page", () => {
    // A short page is a real answer: the window genuinely holds few releases.
    // Topping it up would make one feed out of two sources with one order, and
    // nobody would be able to tell which row came from where.
    game("g", "Stored", day(10));
    expect(withCatalogFallback(live, "game", "future").items).toHaveLength(1);
  });
});
