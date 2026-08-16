import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getTraktWatchedMovies, getTraktRatingsMovies, getTraktWatchlistMovies,
  addTraktEpisodesToHistory, removeTraktEpisodesFromHistory,
} from "./trakt";

// Regression: Trakt paginates its /sync list endpoints at 100 items/page and
// returns only the first page unless you follow X-Pagination-Page-Count. A user
// with >100 watched/rated titles previously had their whole library capped at
// 100. These assert every page is walked and concatenated.

const page = (items: unknown[], pageCount: number) =>
  new Response(JSON.stringify(items), {
    status: 200,
    headers: { "X-Pagination-Page-Count": String(pageCount) },
  });

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ movie: { ids: { trakt: i } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Trakt /sync pagination", () => {
  it("walks every page and concatenates the results", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(page(items(100), 3))
      .mockResolvedValueOnce(page(items(100), 3))
      .mockResolvedValueOnce(page(items(37), 3));
    vi.stubGlobal("fetch", f);

    const all = await getTraktWatchedMovies("tok");

    expect(all).toHaveLength(237);
    expect(f).toHaveBeenCalledTimes(3);
    // Requests carry an increasing page number and the max page size.
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("page=1");
    expect(urls[1]).toContain("page=2");
    expect(urls[2]).toContain("page=3");
    expect(urls[0]).toContain("limit=100");
    // Query params are appended with & since the endpoint already has ?extended=full.
    expect(urls[0]).toContain("?extended=full&page=1");
  });

  it("stops after one page when there is no pagination header", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(items(42)), { status: 200 }) // no X-Pagination-Page-Count
    );
    vi.stubGlobal("fetch", f);

    const all = await getTraktRatingsMovies("tok");

    expect(all).toHaveLength(42);
    expect(f).toHaveBeenCalledTimes(1);
  });

  // This previously asserted the opposite ("returns [] on error instead of
  // throwing — sync stays resilient"). That was backwards, and destructive:
  // syncProvider prunes every local entry missing from a pull, so returning []
  // on a Trakt outage wiped the user's whole Trakt library and logged status=ok.
  // An empty pull must only ever mean "upstream is empty".
  it("throws on error instead of returning [] (an empty pull would trigger the prune)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", f);

    await expect(getTraktWatchlistMovies("tok")).rejects.toThrow(/500/);
  });

  it("throws when a LATER page fails (partial pull must not look complete)", async () => {
    // httpFetch retries a 429 (bounded), so page 2 must fail on every attempt.
    const f = vi
      .fn()
      .mockResolvedValueOnce(page(items(100), 3))
      .mockResolvedValue(new Response("nope", { status: 429 }));
    vi.stubGlobal("fetch", f);

    await expect(getTraktWatchedMovies("tok")).rejects.toThrow(/429/);
  });
});

// ── MB14 — batched per-episode history ───────────────────────────────────────
//
// "Mark this season as seen" must be ONE request. 24 round-trips against a
// rate-limited API is how a mid-batch 429 leaves a half-written history, and it
// is the specific failure this batching exists to prevent.
describe("Trakt episode history", () => {
  it("sends a whole season as a single nested request", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", f);

    await addTraktEpisodesToHistory(
      "tok",
      555,
      Array.from({ length: 24 }, (_, i) => ({ season: 1, episode: i + 1 })),
    );

    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("/sync/history");
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body.shows).toHaveLength(1);
    expect(body.shows[0].ids).toEqual({ trakt: 555 });
    // Scoped to the listed episodes — a bare `{ ids }` at the top level would
    // mark the ENTIRE show watched, which is a different (and destructive) op.
    expect(body.shows[0].seasons).toEqual([
      { number: 1, episodes: Array.from({ length: 24 }, (_, i) => ({ number: i + 1 })) },
    ]);
  });

  it("groups a cross-season batch by season, still in one request", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", f);

    await removeTraktEpisodesFromHistory("tok", 7, [
      { season: 1, episode: 1 },
      { season: 2, episode: 3 },
      { season: 1, episode: 2 },
    ]);

    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("/sync/history/remove");
    const seasons = JSON.parse(String(f.mock.calls[0][1].body)).shows[0].seasons;
    expect(seasons).toEqual([
      { number: 1, episodes: [{ number: 1 }, { number: 2 }] },
      { number: 2, episodes: [{ number: 3 }] },
    ]);
  });

  it("makes no request at all for an empty batch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await addTraktEpisodesToHistory("tok", 1, []);
    expect(f).not.toHaveBeenCalled();
  });

  it("throws on a rejected write, so the route can roll the UI back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 420 })));
    await expect(
      addTraktEpisodesToHistory("tok", 1, [{ season: 1, episode: 1 }]),
    ).rejects.toThrow(/420/);
  });
});
