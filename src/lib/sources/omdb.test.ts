import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __resetBreakers } from "@/lib/http";

// P18-adjacent (2026-08-03): omdbConfigured() mirrors igdbConfigured()/
// traktConfigured() — a caller-checkable short-circuit so a missing key skips
// the OMDB call entirely (enrich.ts's applyOmdbScores now checks it) instead
// of relying on omdbGet()'s own internal guard.
//
// API_KEY is read at MODULE LOAD from process.env.OMDB_API_KEY (matching
// trakt.ts's CLIENT_ID pattern), so testing both the unset and set states
// needs a fresh module instance per state — vi.resetModules() + a dynamic
// import after stubbing the env, since a static top-level import is hoisted
// above any vi.stubEnv() call and would only ever see the FIRST value read.

beforeEach(() => {
  __resetBreakers(); // module-global, keyed by host — isolate from other test files
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("omdbConfigured — unset key", () => {
  it("is false by default (vitest never loads .env into process.env)", async () => {
    const { omdbConfigured } = await import("./omdb");
    expect(omdbConfigured()).toBe(false);
  });

  it("fetchOmdbScores / fetchOmdbByImdbId fire zero HTTP calls and return EMPTY when unconfigured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchOmdbScores, fetchOmdbByImdbId } = await import("./omdb");

    const byTitle = await fetchOmdbScores("Some Movie", 2020);
    const byId = await fetchOmdbByImdbId("tt1234567");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(byTitle.imdbRating).toBeNull();
    expect(byTitle.rtScore).toBeNull();
    expect(byId.imdbRating).toBeNull();
  });
});

describe("omdbConfigured — key set", () => {
  it("is true once OMDB_API_KEY is set", async () => {
    vi.stubEnv("OMDB_API_KEY", "test-key-123");
    const { omdbConfigured } = await import("./omdb");
    expect(omdbConfigured()).toBe(true);
  });

  it("fetchOmdbByImdbId fires the request and parses a real response when configured", async () => {
    vi.stubEnv("OMDB_API_KEY", "test-key-123");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: "True",
          imdbID: "tt1234567",
          imdbRating: "8.1",
          imdbVotes: "1,234",
          Metascore: "70",
          Rated: "PG-13",
          Awards: "Won 1 award",
          BoxOffice: "$1,000",
          Ratings: [{ Source: "Rotten Tomatoes", Value: "88%" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchOmdbByImdbId } = await import("./omdb");

    const result = await fetchOmdbByImdbId("tt1234567");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.imdbRating).toBe(8.1);
    expect(result.rtScore).toBe(88);
    expect(result.metascore).toBe(70);
  });

  it("a bad key still fails closed to EMPTY on a non-ok response, without throwing", async () => {
    vi.stubEnv("OMDB_API_KEY", "invalid-key");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("Invalid API key!", { status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchOmdbByImdbId } = await import("./omdb");

    const result = await fetchOmdbByImdbId("tt1234567");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.imdbRating).toBeNull();
    expect(result.rtScore).toBeNull();
  });
});
