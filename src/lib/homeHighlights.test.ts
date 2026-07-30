import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry, upsertWatchlistEntry } from "./matcher";
import { invalidateDiscoveryCache } from "./discovery";
import { buildHighlights } from "./homeHighlights";

// 2026-07-30 — Home's one hard-wired "your top genre" card became seven
// generators, two drawn per day. The properties worth locking in:
//   • deterministic for a (userId, day) — otherwise the panels flicker on Back
//     and the response can't be cached
//   • different across days — the actual complaint
//   • never invents a stat from a library too thin to support one
//   • a recommendation is never something you already have

initDb();

// A FRESH userId per test, deliberately. getLibraryFacetAnalysis is cached per
// user against a signature built from user_library (count / max(reviewed_at) /
// sum(rating) / rowid-weighted sum) — and a test that DELETEs the table resets
// SQLite rowids to 1, so two tests inserting the same ratings produce an
// identical signature and the second one silently reads the first one's cached
// analysis (stale item ids → a "recommendation" that is really a library item).
// Production never hits this (rows are not deleted and re-inserted with reused
// rowids), but the isolation has to be real here or the assertions are theatre.
let USER = "u-hl-0";
let userSeq = 0;
let counter = 0;

/** A TMDB-shaped movie with genres + a director, rated `rating` by USER. */
function ratedMovie(title: string, genres: string[], director: string, rating: number): string {
  const tmdbId = 900000 + counter++;
  const id = upsertMediaItem({
    source: "tmdb", sourceId: String(tmdbId), type: "movie", title, releaseDate: "2015-01-01",
    rawData: {
      id: tmdbId, title, release_date: "2015-01-01",
      genres: genres.map((name, i) => ({ id: i + 1, name })),
      credits: { crew: [{ job: "Director", name: director }], cast: [] },
    },
  });
  upsertLibraryEntry(USER, id, "tmdb", { status: "watched", rating, reviewedAt: 1 });
  return id;
}

/** Same shape but NOT in the library — a recommendation candidate. */
function catalogMovie(title: string, genres: string[], director: string): string {
  const tmdbId = 900000 + counter++;
  return upsertMediaItem({
    source: "tmdb", sourceId: String(tmdbId), type: "movie", title, releaseDate: "2018-01-01",
    rawData: {
      id: tmdbId, title, release_date: "2018-01-01",
      genres: genres.map((name, i) => ({ id: i + 1, name })),
      credits: { crew: [{ job: "Director", name: director }], cast: [] },
    },
  });
}

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  USER = `u-hl-${userSeq++}`;
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  counter = 0;
  invalidateDiscoveryCache();
});

describe("buildHighlights — thin libraries", () => {
  it("returns nothing for an empty library", () => {
    expect(buildHighlights(USER, "2026-07-30")).toEqual([]);
  });

  it("returns nothing below the Fandex Score's own rated-item minimum", () => {
    // Two ratings is not a taste profile; claiming "your highest rated director"
    // off it would be a fabrication, not a stat.
    ratedMovie("A", ["Horror"], "Ari Aster", 9);
    ratedMovie("B", ["Horror"], "Ari Aster", 8);
    expect(buildHighlights(USER, "2026-07-30")).toEqual([]);
  });
});

describe("buildHighlights — a real library", () => {
  beforeEach(() => {
    // 6 horror films by one director, rated high — enough to clear both the
    // 3-item tag minimum and the 2-item person minimum.
    for (const [t, r] of [["Hereditary", 9], ["Midsommar", 8], ["Beau", 7]] as const) {
      ratedMovie(t, ["Horror", "Drama"], "Ari Aster", r);
    }
    for (const [t, r] of [["Us", 8], ["Get Out", 10], ["Nope", 7]] as const) {
      ratedMovie(t, ["Horror", "Thriller"], "Jordan Peele", r);
    }
    catalogMovie("Sinister", ["Horror"], "Ari Aster");
    invalidateDiscoveryCache();
  });

  it("produces two highlights", () => {
    const hl = buildHighlights(USER, "2026-07-30");
    expect(hl).toHaveLength(2);
    for (const h of hl) {
      expect(h.eyebrow).toBeTruthy();
      expect(h.value).toBeTruthy();
      expect(h.detail).toBeTruthy();
    }
  });

  it("is deterministic for a (userId, day) pair", () => {
    expect(buildHighlights(USER, "2026-07-30")).toEqual(buildHighlights(USER, "2026-07-30"));
  });

  it("rotates across days", () => {
    // Over a couple of weeks the strip must not be the same two panels every
    // day — that was the whole complaint.
    const seen = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      const day = `2026-08-${String(d).padStart(2, "0")}`;
      seen.add(buildHighlights(USER, day).map((h) => h.kind).join("+"));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("never shows the same generator twice in one strip", () => {
    for (let d = 1; d <= 14; d++) {
      const hl = buildHighlights(USER, `2026-08-${String(d).padStart(2, "0")}`);
      expect(new Set(hl.map((h) => h.kind)).size).toBe(hl.length);
    }
  });

  it("never shows the same headline twice in one strip", () => {
    // "Your top genre" and "your most watched genre" are often the same tag;
    // side by side that reads as a bug.
    for (let d = 1; d <= 21; d++) {
      const hl = buildHighlights(USER, `2026-08-${String(d).padStart(2, "0")}`);
      expect(new Set(hl.map((h) => h.value)).size).toBe(hl.length);
    }
  });

  it("only recommends titles that are in neither the library nor the wishlist", () => {
    const wished = catalogMovie("Longlegs", ["Horror"], "Ari Aster");
    upsertWatchlistEntry(USER, wished, "tmdb");
    invalidateDiscoveryCache();

    const libraryTitles = ["Hereditary", "Midsommar", "Beau", "Us", "Get Out", "Nope"];
    for (let d = 1; d <= 30; d++) {
      const hl = buildHighlights(USER, `2026-09-${String(d).padStart(2, "0")}`);
      for (const h of hl.filter((x) => x.kind.startsWith("recommend"))) {
        expect(libraryTitles).not.toContain(h.value);
        expect(h.value).not.toBe("Longlegs");
      }
    }
  });

  it("links every highlight somewhere real", () => {
    for (let d = 1; d <= 14; d++) {
      for (const h of buildHighlights(USER, `2026-08-${String(d).padStart(2, "0")}`)) {
        expect(h.href).toMatch(/^\/(tag|person|studio|movie|show|game)\//);
      }
    }
  });
});
