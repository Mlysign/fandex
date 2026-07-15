import { describe, it, expect, vi, afterEach } from "vitest";
import { getTraktWatchedMovies, getTraktRatingsMovies, getTraktWatchlistMovies } from "./trakt";

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

  it("returns [] on error instead of throwing (sync stays resilient)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", f);

    const all = await getTraktWatchlistMovies("tok");

    expect(all).toEqual([]);
  });
});
