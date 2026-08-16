import { describe, it, expect, vi, afterEach } from "vitest";
import { traktSource, episodeHistoryByShow } from "./trakt";
import type { SourceContext } from "../types";

// MB14 — the pull side, rebuilt 2026-08-16.
//
// The original version of this file tested flattening `seasons[].episodes[]` off
// /sync/watched/shows. Those tests PASSED against a mocked response shaped the
// way Trakt's docs implied — and the feature attached zero episodes on prod for
// four deploys, because that endpoint returns no `seasons` key at all. Measured
// via /api/dev/trakt-shape: 280 entries, `seasons` absent on all 280, in every
// variant. A mocked test of an assumed shape proves only self-consistency.
//
// The real bulk source is /sync/history/episodes: one entry PER PLAY, shaped
// {watched_at, episode: {season, number}, show: {ids}}.
//
// The two distinctions syncProvider's reconcile depends on still hold and are
// still pinned here, because conflating them lets an empty pull delete a real
// watch history:
//
//   movie  → `episodes` absent   ("this pull says nothing about episodes")
//   show   → `episodes: []`      ("this pull is authoritative; none watched")

const ctx = { userId: "u1", identity: {}, token: "tok", slug: null } as SourceContext;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Route each of pullLibrary's five concurrent GETs to its own payload. */
function stubTrakt(payloads: {
  watchedShows?: unknown[];
  watchedMovies?: unknown[];
  history?: unknown[];
}) {
  const f = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/sync/history/episodes")) return json(payloads.history ?? []);
    if (u.includes("/sync/watched/shows")) return json(payloads.watchedShows ?? []);
    if (u.includes("/sync/watched/movies")) return json(payloads.watchedMovies ?? []);
    return json([]); // both /sync/ratings/* endpoints
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const play = (showId: number, season: number, number: number, watchedAt?: string) => ({
  id: Math.random(),
  watched_at: watchedAt ?? null,
  action: "watch",
  type: "episode",
  episode: { season, number, ids: {} },
  show: { title: "S", ids: { trakt: showId } },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("episodeHistoryByShow", () => {
  it("groups plays by show and keeps season/episode numbers", () => {
    const byShow = episodeHistoryByShow([play(155, 1, 1), play(155, 1, 2), play(9, 3, 7)]);
    expect(byShow.get(155)!.map((e) => `${e.season}:${e.episode}`)).toEqual(["1:1", "1:2"]);
    expect(byShow.get(9)!.map((e) => `${e.season}:${e.episode}`)).toEqual(["3:7"]);
  });

  // The history is an EVENT log — a rewatch is a second entry for the same
  // episode. The row we store answers "have you seen it", not "how often", so a
  // duplicate must collapse rather than double-count a season's progress.
  it("dedupes rewatches, keeping the latest watched_at", () => {
    const byShow = episodeHistoryByShow([
      play(1, 1, 1, "2020-01-01T00:00:00.000Z"),
      play(1, 1, 1, "2026-01-01T00:00:00.000Z"),
      play(1, 1, 1, "2023-01-01T00:00:00.000Z"),
    ]);
    const eps = byShow.get(1)!;
    expect(eps).toHaveLength(1);
    expect(eps[0].watchedAt).toBe(Date.parse("2026-01-01T00:00:00.000Z") / 1000);
  });

  it("drops season 0 (Trakt's specials), matching what the catalog stores", () => {
    const byShow = episodeHistoryByShow([play(9, 0, 1), play(9, 1, 1)]);
    expect(byShow.get(9)).toEqual([{ season: 1, episode: 1, watchedAt: null }]);
  });

  it("skips malformed entries rather than inserting NaN", () => {
    const byShow = episodeHistoryByShow([
      { watched_at: null, episode: { season: 1, number: "x" }, show: { ids: { trakt: 5 } } },
      { watched_at: null, episode: { season: 1, number: 2 }, show: { ids: {} } },
      play(5, 1, 3),
    ]);
    expect(byShow.get(5)).toEqual([{ season: 1, episode: 3, watchedAt: null }]);
  });

  it("is empty for an empty history", () => {
    expect(episodeHistoryByShow([]).size).toBe(0);
  });
});

describe("traktSource.pullLibrary — episodes", () => {
  it("attaches history episodes to the matching show", async () => {
    stubTrakt({
      watchedShows: [{ show: { title: "Andor", year: 2022, ids: { trakt: 155 } } }],
      history: [play(155, 1, 1, "2026-02-01T00:00:00.000Z"), play(155, 2, 1)],
    });

    const show = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "155")!;

    expect(show.type).toBe("show");
    expect(show.episodes).toEqual([
      { season: 1, episode: 1, watchedAt: Date.parse("2026-02-01T00:00:00.000Z") / 1000 },
      { season: 2, episode: 1, watchedAt: null },
    ]);
  });

  it("gives a watched show with no history an EMPTY list, not undefined", async () => {
    stubTrakt({ watchedShows: [{ show: { title: "Show", year: 2020, ids: { trakt: 9 } } }] });
    const show = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "9")!;
    expect(show.episodes).toEqual([]);
  });

  it("leaves `episodes` undefined on a movie", async () => {
    stubTrakt({ watchedMovies: [{ movie: { title: "Dune", year: 2021, ids: { trakt: 3 } } }] });
    const movie = (await traktSource.pullLibrary!(ctx)).find((i) => i.sourceId === "3")!;
    expect(movie.episodes).toBeUndefined();
  });

  // The history call sits in the same Promise.all as the rest of the pull for
  // exactly this reason: it feeds a prune, so its failure has to reach
  // syncProvider's catch before anything gets deleted.
  it("throws rather than returning a partial pull when Trakt errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(traktSource.pullLibrary!(ctx)).rejects.toThrow(/500/);
  });

  it("throws when only the HISTORY call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      if (String(url).includes("/sync/history/episodes")) return new Response("nope", { status: 429 });
      return json([]);
    }));
    await expect(traktSource.pullLibrary!(ctx)).rejects.toThrow(/429/);
  });
});
