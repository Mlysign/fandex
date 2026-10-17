import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { validResolveTarget } from "../src/catalog/resolve";
import { wipe } from "./helpers";

// Books (Open Library) and board games (BGG), 2026-10-17: worker/src/shelves.ts
// and the resolve rules. Provider calls are faked; the shapes are Open
// Library's search rows and BGG's documented XML.

const call = (path: string) => SELF.fetch(`https://api.test${path}`);
function providers(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return respond();
    throw new Error(`unexpected provider call: ${url}`);
  });
  return calls;
}
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

beforeEach(async () => { await wipe(); __resetBreakers(); });
afterEach(() => vi.restoreAllMocks());

describe("which provider ids can be resolved", () => {
  it("knows each provider's own types and id shape", () => {
    expect(validResolveTarget("openlibrary", "book", "OL893414W")).toBe(true);
    expect(validResolveTarget("openlibrary", "book", "893414")).toBe(false);
    expect(validResolveTarget("openlibrary", "movie", "OL893414W")).toBe(false);
    expect(validResolveTarget("bgg", "boardgame", "174430")).toBe(true);
    expect(validResolveTarget("bgg", "game", "174430")).toBe(false);
    // The old rule was "TMDB is anything but a game": a TMDB book must not get through.
    expect(validResolveTarget("tmdb", "book", "603")).toBe(false);
    expect(validResolveTarget("tmdb", "movie", "603")).toBe(true);
    expect(validResolveTarget("igdb", "game", "1942")).toBe(true);
    expect(validResolveTarget("constructor", "book", "1")).toBe(false);
  });
});

describe("books", () => {
  it("searches Open Library and answers app cards, with the rating on 0-100", async () => {
    const calls = providers({
      "openlibrary.org/search.json": () => jsonResponse({ docs: [
        { key: "/works/OL893414W", title: "Dune", first_publish_year: 1965, cover_i: 11481354, ratings_average: 4.3, ratings_count: 448, author_name: ["Frank Herbert"], publish_date: ["August 1965", "1965-08-01"] },
        { title: "no key, left out" },
      ] }),
    });
    const res = await call("/v1/search/books?q=dune%20herbert");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toEqual([expect.objectContaining({
      source: "openlibrary", sourceId: "OL893414W", type: "book", title: "Dune", releaseDate: "1965-08-01",
      posterUrl: "https://covers.openlibrary.org/b/id/11481354-L.jpg", votes: 448, rating: 83,
    })]);
    expect(calls[0]).toContain("openlibrary.org/search.json");
    expect((await call("/v1/search/books?q=a")).status).toBe(400);
  });

  it("answers a facet's books by kind, and refuses an unknown kind", async () => {
    const calls = providers({ "openlibrary.org/search.json": () => jsonResponse({ docs: [{ key: "/works/OL1W", title: "A" }] }) });
    expect((await call("/v1/facet/books?kind=person&q=Frank%20Herbert%20shelf")).status).toBe(200);
    expect(calls[0]).toContain("author=Frank%20Herbert");
    expect((await call("/v1/facet/books?kind=planet&q=Arrakis")).status).toBe(400);
  });
});

describe("board games", () => {
  it("are switched off without a BGG token, and say so instead of asking BGG", async () => {
    const calls = providers({});
    expect(await (await call("/v1/features")).json()).toMatchObject({ boardgames: !!(env as { BGG_TOKEN?: string }).BGG_TOKEN, books: true });
    if (!(env as { BGG_TOKEN?: string }).BGG_TOKEN) {
      const res = await call("/v1/search/boardgames?q=catan%20shelf");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "not-configured" });
      expect(calls).toEqual([]);
    }
  });
});
