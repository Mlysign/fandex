import { describe, it, expect } from "vitest";
import { mergeForCanonical, normalizeName, extractYear } from "./merge";

// Pure-function coverage for the canonical merge + the normalization helpers the
// matcher relies on. No DB — these are the priority/format rules in isolation.

describe("normalizeName", () => {
  it("lowercases, turns punctuation into spaces, collapses whitespace", () => {
    expect(normalizeName("The Last of Us: Part II")).toBe("the last of us part ii");
    expect(normalizeName("  Grand   Theft  Auto V  ")).toBe("grand theft auto v");
    expect(normalizeName("WALL·E")).toBe("wall e");
  });

  it("normalizes punctuation variants to the same key (hyphen → space)", () => {
    expect(normalizeName("Spider-Man")).toBe("spider man");
    expect(normalizeName("Spider-Man")).toBe(normalizeName("Spider Man"));
    // Apostrophes are dropped (no space) so possessives stay one word and match.
    expect(normalizeName("Marvel's Spider-Man")).toBe("marvels spider man");
    expect(normalizeName("Marvel's Spider-Man")).toBe(normalizeName("Marvels Spider Man"));
  });
});

describe("extractYear", () => {
  it("reads the leading 4-digit year from an ISO date", () => {
    expect(extractYear("2025-06-13")).toBe(2025);
    expect(extractYear("1998")).toBe(1998);
  });
  it("returns null for empty/garbage", () => {
    expect(extractYear(null)).toBeNull();
    expect(extractYear("")).toBeNull();
    expect(extractYear("TBA")).toBeNull();
  });
});

describe("mergeForCanonical", () => {
  it("picks title by source priority (tmdb before trakt)", () => {
    const merged = mergeForCanonical([
      { source: "trakt", data: { title: "Trakt Title" } },
      { source: "tmdb", data: { title: "TMDB Title" } },
    ]);
    expect(merged.title).toBe("TMDB Title");
  });

  it("falls through to a lower-priority source when the higher one lacks the field", () => {
    const merged = mergeForCanonical([
      { source: "tmdb", data: { /* no title */ overview: "x" } },
      { source: "trakt", data: { title: "Trakt Title" } },
    ]);
    expect(merged.title).toBe("Trakt Title");
  });

  it("picks release date by priority (rawg before tmdb)", () => {
    const merged = mergeForCanonical([
      { source: "tmdb", data: { release_date: "2025-12-01" } },
      { source: "rawg", data: { released: "2025-06-01" } },
    ]);
    expect(merged.releaseDate).toBe("2025-06-01"); // rawg wins over tmdb
  });

  it("picks poster by priority (tmdb path expanded to full URL)", () => {
    const merged = mergeForCanonical([
      { source: "rawg", data: { background_image: "https://rawg/img.jpg" } },
      { source: "tmdb", data: { poster_path: "/abc.jpg" } },
    ]);
    expect(merged.posterUrl).toContain("/abc.jpg"); // tmdb wins over rawg
  });

  it("defaults title to 'Unknown' when no source supplies one", () => {
    const merged = mergeForCanonical([{ source: "trakt", data: {} }]);
    expect(merged.title).toBe("Unknown");
    expect(merged.releaseDate).toBeNull();
    expect(merged.posterUrl).toBeNull();
  });
});

describe("a game's release date (2026-10-23)", () => {
  const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;
  it("is the earliest of its game sources, not Steam's PC date", () => {
    // The Last of Us Part I: PS5 2 Sep 2022, PC 28 Mar 2023.
    const links = [
      { source: "steam" as const, data: { name: "The Last of Us Part I", release: { steam_release_date: at("2023-03-28") } } },
      { source: "igdb" as const, data: { name: "The Last of Us Part I", first_release_date: at("2022-09-02") } },
    ];
    expect(mergeForCanonical(links).releaseDate).toBe("2022-09-02");
  });
  it("keeps Steam's when Steam came first (an early-access launch)", () => {
    const links = [
      { source: "steam" as const, data: { name: "Valheim", release: { steam_release_date: at("2021-02-02") } } },
      { source: "igdb" as const, data: { name: "Valheim", first_release_date: at("2026-09-15") } },
    ];
    expect(mergeForCanonical(links).releaseDate).toBe("2021-02-02");
  });
});
