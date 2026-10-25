import { describe, it, expect } from "vitest";
import { mergeForCanonical, mergeLinks, normalizeName, extractYear, TIER_CAPS } from "./merge";

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

describe("tag tiers (2026-10-25)", () => {
  const link = (source: string, rawData: unknown) =>
    ({ id: "", mediaItemId: "m", source, sourceId: "1", title: null, releaseDate: null, rawData, lastSynced: 0 }) as never;
  const kw = (n: number, prefix = "kw") => Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i + 1}` }));

  it("files every tag under its best tier, ranked, and caps the keyword tail", () => {
    const merged = mergeLinks([
      link("igdb", { genres: [{ name: "Shooter" }], themes: [{ name: "Horror" }], keywords: [{ name: "steam achievements" }, ...kw(20)], steamTags: ["Horror", "Story Rich", "kw 3"] }),
    ], "game");
    const tiers = merged.tagTiers!;
    expect(tiers.filter((t) => t.tier === "genre")).toEqual([{ name: "Shooter", tier: "genre", rank: 1 }]);
    // Horror is IGDB's theme and Steam's voted tag: the theme wins, once.
    expect(tiers.filter((t) => t.name === "Horror")).toEqual([{ name: "Horror", tier: "theme", rank: 1 }]);
    // Steam's voted tags, in Steam's order; a keyword Steam also lists is voted, not a keyword.
    expect(tiers.filter((t) => t.tier === "voted").map((t) => t.name)).toEqual(["Story Rich", "kw 3"]);
    // Eight keywords by rank, the noise ("steam achievements" files as meta) pushed to the back and out.
    const keywords = tiers.filter((t) => t.tier === "keyword");
    expect(keywords).toHaveLength(TIER_CAPS.keyword);
    expect(keywords.map((t) => t.name)).toEqual(["kw 1", "kw 2", "kw 4", "kw 5", "kw 6", "kw 7", "kw 8", "kw 9"]);
    expect(keywords.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The display list is the same tags in tier order, genres first.
    expect(merged.tags.slice(0, 4)).toEqual(["Shooter", "Horror", "Story Rich", "kw 3"]);
  });

  it("lets a tag the voted cap leaves out fall back to the tier IGDB keyed it in", () => {
    const voted = Array.from({ length: TIER_CAPS.voted + 2 }, (_, i) => `v ${i + 1}`);
    const merged = mergeLinks([link("igdb", { keywords: [{ name: `v ${TIER_CAPS.voted + 2}` }], steamTags: voted })], "game");
    const last = merged.tagTiers!.find((t) => t.name === `v ${TIER_CAPS.voted + 2}`);
    expect(last).toEqual({ name: `v ${TIER_CAPS.voted + 2}`, tier: "keyword", rank: 1 });
    expect(merged.tagTiers!.filter((t) => t.tier === "voted")).toHaveLength(TIER_CAPS.voted);
  });

  it("reads RAWG's voted tags, English only, and TMDB's keywords as the keyword tier", () => {
    // "Steam Achievements" files as noise and goes to the back; the Russian spelling is dropped.
    const game = mergeLinks([link("rawg", { genres: [{ name: "Action" }], tags: [{ name: "Steam Achievements", language: "eng" }, { name: "Экшен", language: "rus" }, { name: "Steampunk", language: "eng" }] })], "game");
    expect(game.tagTiers).toEqual([
      { name: "Action", tier: "genre", rank: 1 },
      { name: "Steampunk", tier: "voted", rank: 1 }, { name: "Steam Achievements", tier: "voted", rank: 2 },
    ]);
    const film = mergeLinks([link("tmdb", { genres: [{ name: "Drama" }], keywords: { keywords: [{ name: "heist" }] } })], "movie");
    expect(film.tagTiers).toEqual([{ name: "Drama", tier: "genre", rank: 1 }, { name: "heist", tier: "keyword", rank: 1 }]);
    expect(film.keywords).toEqual(["heist"]);
  });
});
