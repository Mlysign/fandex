import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry, upsertWatchlistEntry } from "./matcher";
import { find, invalidateDiscoveryCache } from "./discovery";

// 2026-08-28, docs/catalog-growth.md phase 2 — `find()` serves an ANONYMOUS
// caller, so a logged-out visitor searching /discover gets our own catalog
// first instead of five uncached provider calls.
//
// The catalog half of search was always there. It was gated: `/api/discover/find`
// was `withUser`, so the client skipped it for anonymous viewers entirely and
// their search was answered by the provider fan-out alone. That is the shape
// [[anon-gates-must-ask-not-bounce]] records — the wrapper was gated, not the
// data. Titles, posters and release dates are the same ones /person, /tag and
// /studio already serve anonymously.
//
// So the question this file has to answer is not "does it work" but "does it
// leak". Every per-user field must come back empty for a null caller, and it
// must do so BY CONSTRUCTION rather than because this particular fixture has
// one user in it.

initDb();

const ALICE = "u-anon-alice";
const BOB = "u-anon-bob";

const tmdb = (id: number, title: string, director: string) => ({
  id, title, release_date: "2025-01-01", poster_path: "/p.jpg", overview: "o",
  vote_average: 8, vote_count: 500,
  credits: { crew: [{ job: "Director", name: director }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
});

const item = (n: number, title: string, director = "Greta Gerwig") =>
  upsertMediaItem({
    source: "tmdb", sourceId: `a${n}`, type: "movie", title,
    releaseDate: "2025-01-01", rawData: tmdb(5000 + n, title, director),
  });

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM user_item_state");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [ALICE]);
  run("INSERT INTO users (id) VALUES (?)", [BOB]);
  invalidateDiscoveryCache();
});

describe("find() — anonymous", () => {
  it("searches the catalog by title with no session", () => {
    item(1, "Blade Runner");
    item(2, "Blade Runner 2049");
    item(3, "Paddington");
    invalidateDiscoveryCache();

    const r = find(null, { q: "blade", limit: 60 });
    expect(r.items.map((i) => i.title).sort()).toEqual(["Blade Runner", "Blade Runner 2049"]);
    // The whole reason not to short-circuit the providers on an exact match:
    // a title is a prefix of its own sequels, and the catalog cannot know
    // whether it holds all of them.
    expect(r.total).toBe(2);
  });

  it("returns items that link — a card nobody can click is worse than no card", () => {
    const id = item(4, "Paddington");
    invalidateDiscoveryCache();
    const hit = find(null, { q: "padding", limit: 60 }).items[0];
    expect(hit.id).toBe(id);
    expect(hit.slug).toBeTruthy();
  });

  it("leaks no user state — not Alice's, not anybody's", () => {
    const owned = item(5, "Owned By Alice");
    const wished = item(6, "Wished By Bob");
    upsertLibraryEntry(ALICE, owned, "tmdb", { rating: 10, status: "completed" });
    upsertWatchlistEntry(BOB, wished, "tmdb");
    invalidateDiscoveryCache();

    // Sanity: Alice really does own it, so an empty result below means the anon
    // branch withheld it rather than the fixture never setting it.
    const alice = find(ALICE, { q: "owned", limit: 60 }).items[0];
    expect(alice.libraryStatus).toBe("completed");
    expect(alice.rating).toBe(10);

    for (const i of find(null, { q: "by", limit: 60 }).items) {
      expect(i.libraryStatus).toBeNull();
      expect(i.rating).toBeNull();
      expect(i.onWatchlist).toBe(false);
      expect(i.platformSources).toEqual([]);
    }
  });

  it("returns no score and no reasons, because there is no profile to score against", () => {
    item(7, "Unscored");
    invalidateDiscoveryCache();
    const r = find(null, { q: "unscored", limit: 60 });
    expect(r.items[0].fandexScore).toBeNull();
    expect(r.items[0].fandexCenter).toBeNull();
    expect(r.items[0].reasons).toEqual([]);
    expect(r.baseline).toBe(0);
    expect(r.profileSummary.topPositive).toEqual([]);
    expect(r.profileSummary.topNegative).toEqual([]);
  });

  it("does not offer to heal a score it can never produce", () => {
    // `fandexPending` makes the card ask /api/discover/scores for a number. An
    // anonymous viewer has no profile, so the answer would always be null and
    // the card would spin on a question with no answer.
    item(8, "Pending Check");
    invalidateDiscoveryCache();
    expect(find(null, { q: "pending", limit: 60 }).items[0].fandexPending).toBe(false);
  });

  it("still applies filters and sort for an anonymous caller", () => {
    item(9, "Filtered Movie");
    upsertMediaItem({
      source: "tmdb", sourceId: "a10", type: "show", title: "Filtered Show",
      releaseDate: "2025-01-01", rawData: tmdb(5010, "Filtered Show", "Ari Aster"),
    });
    invalidateDiscoveryCache();

    const movies = find(null, { q: "filtered", filters: { types: ["movie"] }, limit: 60 });
    expect(movies.items.map((i) => i.title)).toEqual(["Filtered Movie"]);
    expect(find(null, { q: "filtered", limit: 60 }).total).toBe(2);
  });

  it("ignores excludeIgnored rather than reading somebody else's ignores", () => {
    const ignored = item(11, "Ignored By Alice");
    run(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation)
       VALUES (?, ?, ?, 'local', 'ignored')`,
      ["ign-1", ALICE, ignored]
    );
    invalidateDiscoveryCache();
    // Alice does not see it; an anonymous visitor is not Alice and does.
    expect(find(ALICE, { q: "ignored by", excludeIgnored: true, limit: 60 }).total).toBe(0);
    expect(find(null, { q: "ignored by", excludeIgnored: true, limit: 60 }).total).toBe(1);
  });
});
