import { describe, it, expect, vi, afterEach } from "vitest";
import { traktSource } from "./trakt";
import type { SourceContext } from "../types";

// MB14 — the pull side. /sync/watched/shows nests seasons[].episodes[] in the
// response the library pull ALREADY makes, so the per-episode half costs no
// extra call and inherits that pull's throw-on-failure contract. What's worth
// pinning is the shape it flattens to, and the two distinctions syncProvider's
// reconcile depends on:
//
//   movie  → `episodes` absent   ("this pull says nothing about episodes")
//   show   → `episodes: []`      ("this pull is authoritative; none watched")
//
// Conflating those two is what would let an empty pull prune a watch history.

const ctx = { userId: "u1", identity: {}, token: "tok", slug: null } as SourceContext;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Route each of pullLibrary's four concurrent GETs to its own payload. */
function stubTrakt(payloads: { watchedShows?: unknown[]; watchedMovies?: unknown[] }) {
  const f = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/sync/watched/shows")) return json(payloads.watchedShows ?? []);
    if (u.includes("/sync/watched/movies")) return json(payloads.watchedMovies ?? []);
    return json([]); // both /sync/ratings/* endpoints
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("traktSource.pullLibrary — episodes", () => {
  it("flattens seasons[].episodes[] and keeps each last_watched_at", async () => {
    stubTrakt({
      watchedShows: [
        {
          last_watched_at: "2026-01-01T00:00:00.000Z",
          show: { title: "Andor", year: 2022, ids: { trakt: 155 } },
          seasons: [
            { number: 1, episodes: [{ number: 1, last_watched_at: "2026-02-01T00:00:00.000Z" }, { number: 2 }] },
            { number: 2, episodes: [{ number: 1 }] },
          ],
        },
      ],
    });

    const items = await traktSource.pullLibrary!(ctx);
    const show = items.find((i) => i.sourceId === "155")!;

    expect(show.type).toBe("show");
    expect(show.episodes).toEqual([
      { season: 1, episode: 1, watchedAt: Date.parse("2026-02-01T00:00:00.000Z") / 1000 },
      { season: 1, episode: 2, watchedAt: null },
      { season: 2, episode: 1, watchedAt: null },
    ]);
  });

  it("drops season 0 (Trakt's specials), matching what the catalog stores", async () => {
    stubTrakt({
      watchedShows: [
        {
          show: { title: "Show", year: 2020, ids: { trakt: 9 } },
          seasons: [
            { number: 0, episodes: [{ number: 1 }] },
            { number: 1, episodes: [{ number: 1 }] },
          ],
        },
      ],
    });

    const show = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "9")!;
    expect(show.episodes).toEqual([{ season: 1, episode: 1, watchedAt: null }]);
  });

  it("gives a watched show with no season data an EMPTY list, not undefined", async () => {
    stubTrakt({ watchedShows: [{ show: { title: "Show", year: 2020, ids: { trakt: 9 } } }] });
    const show = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "9")!;
    expect(show.episodes).toEqual([]);
  });

  it("leaves `episodes` undefined on a movie", async () => {
    stubTrakt({ watchedMovies: [{ movie: { title: "Dune", year: 2021, ids: { trakt: 3 } } }] });
    const movie = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "3")!;
    expect(movie.episodes).toBeUndefined();
  });

  it("throws rather than returning a partial pull when Trakt errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(traktSource.pullLibrary!(ctx)).rejects.toThrow(/500/);
  });
});
