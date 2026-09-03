import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initDb, run } from "@/lib/db";

// 2026-09-03. Nils, on the import preview: "is this looking up our DB or also
// checking TMDB? its a big deal breaker if half my export would be lost."
//
// It was looking up our DB only. `docs/letterboxd-import.md` had specified the
// TMDB fallback from the start and `lookupQueue` + `PROVIDER_LOOKUP_BUDGET` were
// written for it, but nothing ever called them, so every title we did not
// already hold was reported as "could not be found in our catalog" and then
// silently dropped on import. His 607-row export lost 56 films, including
// Reservoir Dogs and American Beauty.
//
// A mocked test of an assumed provider shape proves nothing (AGENTS.md), so
// these assert the things that are true regardless of TMDB's payload: how many
// CALLS are made, which rows are chosen, that the budget binds, and that a
// provider failure costs one title rather than the import.

initDb();

const searchTmdbMovie = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sources/tmdb", () => ({ searchTmdbMovie }));

const { matchLocally, resolveMissesAtProvider, PROVIDER_LOOKUP_BUDGET } = await import("./match");

function row(over: Partial<{ title: string; year: number | null; rating: number | null }> = {}) {
  return {
    title: "Reservoir Dogs",
    year: 1992,
    rating: null,
    relation: "library" as const,
    imdbId: null,
    ratedAt: null,
    ...over,
  };
}

beforeEach(() => {
  searchTmdbMovie.mockReset();
  run("DELETE FROM media_items WHERE id LIKE 'pf-%'");
});

afterEach(() => vi.restoreAllMocks());

describe("the TMDB fallback for rows the catalog does not hold", () => {
  it("resolves a miss to a tmdb id and stops counting it as unmatched", async () => {
    searchTmdbMovie.mockResolvedValue({ id: 500 });
    const local = matchLocally([row()]);
    expect(local.unmatched).toBe(1);

    const out = await resolveMissesAtProvider(local);
    expect(out.matchedAtProvider).toBe(1);
    expect(out.unmatched).toBe(0);
    expect(out.rows[0].tmdbId).toBe(500);
    expect(out.rows[0].how).toBe("provider");
  });

  it("asks with the title AND the year, so a remake is not the first hit", async () => {
    searchTmdbMovie.mockResolvedValue({ id: 1 });
    await resolveMissesAtProvider(matchLocally([row({ title: "Solaris", year: 1972 })]));
    expect(searchTmdbMovie).toHaveBeenCalledWith("Solaris", 1972);
  });

  it("spends NO call on a row the catalog already answered for", async () => {
    run(
      "INSERT INTO media_items (id, type, title, norm_title, release_date) VALUES ('pf-1','movie','Alien','alien','1979-05-25')",
    );
    searchTmdbMovie.mockResolvedValue({ id: 2 });
    const out = await resolveMissesAtProvider(matchLocally([row({ title: "Alien", year: 1979 })]));
    expect(searchTmdbMovie).not.toHaveBeenCalled();
    expect(out.matchedAtProvider ?? 0).toBe(0);
  });

  it("leaves a genuine miss unmatched rather than inventing an id", async () => {
    searchTmdbMovie.mockResolvedValue(null);
    const out = await resolveMissesAtProvider(matchLocally([row({ title: "Not A Film" })]));
    expect(out.rows[0].tmdbId ?? null).toBeNull();
    expect(out.unmatched).toBe(1);
  });

  it("costs one title, not the import, when a lookup throws", async () => {
    searchTmdbMovie
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValue({ id: 7 });
    const rows = [row({ title: "A" }), row({ title: "B" })];
    const out = await resolveMissesAtProvider(matchLocally(rows));
    // One resolved, one did not, and nothing threw out of the function.
    expect(out.matchedAtProvider).toBe(1);
    expect(out.unmatched).toBe(1);
  });

  it("caps the calls PER IMPORT, and reports what it skipped", async () => {
    searchTmdbMovie.mockResolvedValue({ id: 3 });
    const many = Array.from({ length: 25 }, (_, i) => row({ title: `Missing ${i}` }));
    const out = await resolveMissesAtProvider(matchLocally(many), { budget: 10 });

    expect(searchTmdbMovie).toHaveBeenCalledTimes(10);
    expect(out.matchedAtProvider).toBe(10);
    // ⚠️ "we stopped looking" and "it does not exist" must stay separable, or a
    // cap silently becomes a filter. Same rule as the genre list capped after a
    // sort that cut every game genre.
    expect(out.overBudget).toBe(15);
  });

  it("spends the budget on RATED rows first", async () => {
    searchTmdbMovie.mockResolvedValue({ id: 4 });
    const rows = [
      row({ title: "Unrated", rating: null }),
      row({ title: "Rated", rating: 9 }),
    ];
    await resolveMissesAtProvider(matchLocally(rows), { budget: 1 });
    // A rating feeds the taste profile and is the one a person notices missing.
    expect(searchTmdbMovie).toHaveBeenCalledWith("Rated", 1992);
    expect(searchTmdbMovie).toHaveBeenCalledTimes(1);
  });

  it("keeps a per-import ceiling rather than a per-row one", () => {
    // The number itself is a judgement call; that it is a finite ceiling on the
    // IMPORT is the property. Per-row is how one upload becomes thousands of
    // provider calls.
    expect(Number.isFinite(PROVIDER_LOOKUP_BUDGET)).toBe(true);
    expect(PROVIDER_LOOKUP_BUDGET).toBeGreaterThan(0);
  });
});
