import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
// Type-only namespace imports so the partial mocks below can name each module's
// shape without an inline `import()` annotation (an eslint ERROR in this repo).
import type * as HttpModule from "@/lib/http";
import type * as IgdbModule from "@/lib/sources/igdb";
import type * as LetterboxdModule from "@/lib/sources/letterboxd";

// 2026-08-29 — "Lucky is a popular new show on Apple TV+, how come it does not
// show up in the search?"
//
// THE SEARCH BRANCH WAS THE ONE FEED IN THIS ROUTE THAT NEVER DECORATED.
// Load-more, the personalized feed and the anonymous cold-start browse all run
// their provider records through `decorateSection`, which is what attaches
// `communityVotes` / `communityScore`. The `q` branch returned the raw records.
//
// The client's Popularity sort reads `i.communityVotes ?? 0`, so every search
// result tied at zero — and `Array.prototype.sort` is stable, so ties keep the
// order they arrived in. That order is `sortByDate`, ASCENDING. Under a control
// labelled "Popularity" the user was therefore looking at an OLDEST-FIRST list:
// searching "Lucky" put a 1959 show in slot one and anything from 2026 last, off
// the bottom of the screen. Rating and Fandex Score sorts were inert for the
// same reason.
//
// Nothing caught it because every assertion anyone would think to write here —
// "the search returns the matching titles" — was true throughout. The results
// were all present; they were merely unsortable, and so unfindable.
//
// This is deliberately the ROUTE, not `decorateSection` (which was always
// correct) and not `searchAll` (whose half tsc now proves, via SearchResult
// requiring voteCount). The bug lived precisely in the wiring between them.

const TMDB_SHOWS = {
  results: [
    { id: 900001, name: "Lucky", first_air_date: "2026-07-10", poster_path: "/new.jpg", overview: "The new one", vote_count: 312, vote_average: 8.1 },
    { id: 4535, name: "Mr. Lucky", first_air_date: "1959-10-24", poster_path: "/old.jpg", overview: "The 1959 one", vote_count: 6, vote_average: 6.4 },
  ],
};

const calls: string[] = [];
const httpFetch = vi.fn(async (url: string) => {
  calls.push(String(url));
  const body = String(url).includes("/search/tv") ? TMDB_SHOWS : { results: [] };
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
});

vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  httpFetch: (...args: any[]) => httpFetch(...(args as [string])),
}));
// Anonymous: `getSession` throws outside a request scope and the route swallows
// it, but say so explicitly rather than testing a catch block by accident.
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
// Partial mocks: both modules are re-exported through the metadata registry,
// so a bare factory drops exports the route never touches and the import graph
// fails before a single test runs.
vi.mock("@/lib/sources/igdb", async (importOriginal) => ({
  ...(await importOriginal<typeof IgdbModule>()),
  searchIgdbGames: async () => [],
}));
vi.mock("@/lib/sources/letterboxd", async (importOriginal) => ({
  ...(await importOriginal<typeof LetterboxdModule>()),
  searchLetterboxdFilms: async () => [],
}));

import { GET } from "./route";
import { initDb } from "@/lib/db";

initDb();
beforeEach(() => { httpFetch.mockClear(); calls.length = 0; });

const search = async (q: string) => {
  const res = await GET(new NextRequest(`http://localhost:3000/api/discover?q=${encodeURIComponent(q)}`));
  return (await res.json()).items as any[];
};

describe("GET /api/discover?q= — search results are sortable", () => {
  // A call COUNT, not an assumed payload shape: the point of the mock is that
  // the route really does reach TMDB's tv search for this query, so a later
  // refactor that stops calling it fails here rather than silently passing on
  // an empty list. → AGENTS.md, "a mocked test of an assumed shape proves nothing".
  it("actually queries TMDB's tv search for the term", async () => {
    await search("lucky");
    expect(calls.filter((u) => u.includes("/search/tv") && u.includes("query=lucky"))).toHaveLength(1);
  });

  it("carries each provider's own vote count, not a zero", async () => {
    const items = await search("lucky");
    const byTitle = new Map(items.map((i) => [i.title, i]));

    expect(byTitle.get("Lucky")?.communityVotes).toBe(312);
    expect(byTitle.get("Mr. Lucky")?.communityVotes).toBe(6);
    // 0–10 from TMDB → the 0–100 scale the client's rating sort expects.
    expect(byTitle.get("Lucky")?.communityScore).toBeCloseTo(81);
  });

  it("gives the popularity sort something to order by — the new show outranks the 1959 one", async () => {
    const items = await search("lucky");
    // The client's sortDiscover, verbatim, for sort="popularity".
    const ranked = [...items].sort((a, b) => (b.communityVotes ?? 0) - (a.communityVotes ?? 0));
    expect(ranked[0].title).toBe("Lucky");
    expect(ranked[0].releaseDate).toBe("2026-07-10");
  });

  it("still delivers the list itself oldest-first, which is what made a zero tie so misleading", async () => {
    // Not a property worth defending on its own — pinned because the whole bug
    // was this order becoming the visible one whenever the votes were absent.
    expect((await search("lucky")).map((i) => i.releaseDate)).toEqual(["1959-10-24", "2026-07-10"]);
  });
});
