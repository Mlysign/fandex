import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry, upsertWatchlistEntry } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import { find, invalidateDiscoveryCache, scoreRecomputesIdle } from "./discovery";

// 2026-08-28, docs/catalog-growth.md phase 3 — the Fandex Score pass moved off
// the request path.
//
// The cached score array already stopped a WARM request from scoring the whole
// catalog. It did not stop the FIRST request after any change from doing it, and
// at the 30–50k items the growth plan targets that is 0.6–1.0 s of BLOCKING CPU
// on a synchronous in-process database — not a slow request, a stopped server.
//
// So a stale entry is now served while a chunked pass refreshes it. That trades
// one small error (a score a rating out of date) for a much larger one, and it
// introduces exactly one correctness question, which is what this file is for:
//
//   staleness is fine, MISALIGNMENT is not.
//
// The scores live in a Float64Array indexed by position in the pool's vector
// array. If the pool changes and the array does not, index i stops meaning
// vectors[i] and one title renders another title's score — silently, and
// plausibly, because both numbers are real.

initDb();

const USER = "u-recompute";

const tmdb = (id: number, title: string, director: string, genre: string) => ({
  id, title, release_date: "2025-01-01", poster_path: "/p.jpg", overview: "o",
  credits: { crew: [{ job: "Director", name: director }], cast: [] },
  genres: [{ id: 1, name: genre }],
});

/** A rated library item, so the profile has real signal to score against. */
const rated = (n: number, director: string, genre: string, rating: number) => {
  const id = upsertMediaItem({
    source: "tmdb", sourceId: `r${n}`, type: "movie", title: `Rated ${n}`,
    releaseDate: "2025-01-01", rawData: tmdb(1000 + n, `Rated ${n}`, director, genre),
  });
  upsertLibraryEntry(USER, id, "tmdb", { rating, status: "completed" });
  return id;
};

/** A pooled but unrated item — the kind that carries a visible Fandex Score. */
const pooled = (n: number, director: string, genre: string) =>
  upsertMediaItem({
    source: "tmdb", sourceId: `p${n}`, type: "movie", title: `Pooled ${n}`,
    releaseDate: "2025-01-01", rawData: tmdb(2000 + n, `Pooled ${n}`, director, genre),
  });

const scoresByTitle = () => {
  const m = new Map<string, number | null>();
  for (const i of find(USER, { limit: 120 }).items) m.set(i.title, i.fandexScore);
  return m;
};

/** What a from-scratch synchronous pass produces for the same DB state. */
const reference = () => {
  process.env.FANDEX_NO_CACHE = "1";
  try { return scoresByTitle(); } finally { delete process.env.FANDEX_NO_CACHE; }
};

const seed = () => {
  rated(1, "Greta Gerwig", "Drama", 9);
  rated(2, "Ari Aster", "Horror", 4);
  rated(3, "Bong Joon-ho", "Thriller", 8);
  rated(4, "Greta Gerwig", "Drama", 9);
  pooled(1, "Greta Gerwig", "Drama");
  pooled(2, "Ari Aster", "Horror");
  pooled(3, "Bong Joon-ho", "Thriller");
};

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM user_item_state");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

describe("Fandex Score — background recompute", () => {
  it("serves the PREVIOUS scores after a rating, then converges to the synchronous answer", async () => {
    seed();
    invalidateDiscoveryCache();
    const before = scoresByTitle();
    expect(before.get("Pooled 1")).toBeTypeOf("number");

    // A new rating that genuinely moves the profile: Ari Aster goes from the
    // user's worst-rated director to their best.
    const extra = upsertMediaItem({
      source: "tmdb", sourceId: "r9", type: "movie", title: "Rated 9",
      releaseDate: "2025-01-01", rawData: tmdb(1009, "Rated 9", "Ari Aster", "Horror"),
    });
    upsertLibraryEntry(USER, extra, "tmdb", { rating: 10, status: "completed" });

    // The request right after the write is served from the previous pass.
    const stale = scoresByTitle();
    for (const title of ["Pooled 1", "Pooled 2", "Pooled 3"]) {
      expect(stale.get(title)).toBe(before.get(title));
    }

    await scoreRecomputesIdle();

    // …and then it is exactly what scoring from scratch produces.
    const settled = scoresByTitle();
    expect([...settled]).toEqual([...reference()]);
    // The rating actually reached the scores, or the test above proves nothing.
    expect(settled.get("Pooled 2")).not.toBe(before.get("Pooled 2"));
  });

  it("keeps every score on its OWN title when the pool changes underneath it", async () => {
    seed();
    // A browsed row is a url target, not a pool member, until somebody acts on
    // it — so wishlisting it changes the pool without changing any content.
    const map = persistDiscoverItems([{
      id: "tmdb-movie-3001", type: "movie", title: "Promoted", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "3001", data: tmdb(3001, "Promoted", "Greta Gerwig", "Drama") },
    }]);
    const promoted = map.get("tmdb-movie-3001")!;
    invalidateDiscoveryCache();
    const before = scoresByTitle();
    expect(before.has("Promoted")).toBe(false);

    // NO invalidate — this is the real path a wishlist write takes, and the one
    // that shifts what an index means.
    upsertWatchlistEntry(USER, promoted, "tmdb");
    const remapped = scoresByTitle();

    expect(remapped.has("Promoted")).toBe(true);
    for (const [title, score] of before) expect(remapped.get(title)).toBe(score);
    // The item nobody has scored yet reads as "no score", never as a neighbour's.
    expect(remapped.get("Promoted")).toBeNull();

    await scoreRecomputesIdle();
    expect([...scoresByTitle()]).toEqual([...reference()]);
  });

  it("marks a not-yet-scored item pending rather than showing 0", () => {
    seed();
    const map = persistDiscoverItems([{
      id: "tmdb-movie-3002", type: "movie", title: "Pending", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "3002", data: tmdb(3002, "Pending", "Ari Aster", "Horror") },
    }]);
    invalidateDiscoveryCache();
    find(USER, { limit: 120 });

    upsertWatchlistEntry(USER, map.get("tmdb-movie-3002")!, "tmdb");
    const item = find(USER, { limit: 120 }).items.find((i) => i.title === "Pending")!;
    expect(item.fandexScore).toBeNull();
    // The client heals it through /api/discover/scores, which it only does when
    // this flag is set. A 0 here would be a real score, and wrong.
    expect(item.fandexPending).toBe(true);
  });

  it("FANDEX_NO_CACHE bypasses the cache entirely, so the probe measures the real pass", () => {
    seed();
    invalidateDiscoveryCache();
    expect([...reference()]).toEqual([...scoresByTitle()]);
  });
});
