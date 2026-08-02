import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SM35/SM36 (2026-08-02) — THE TWO-SOURCE GAMES INVARIANT.
//
// Games are the only medium served by two independent providers (RAWG + IGDB).
// `personalizedFeed` had always pulled both; three other paths pulled RAWG
// alone. Nothing noticed until RAWG actually went down (Cloudflare 522 on every
// endpoint, 2026-08-02) and those three lost the entire media type while the
// feed right next to them carried on:
//
//   · `/api/discover?section=games` (load-more)  → `[]` forever, and the button
//     stayed enabled, so it was a silent dead control (SM35);
//   · `/api/discover` cold-start/ANON browse     → no games at all for logged-out
//     visitors, while a signed-in user still saw them (SM35, public surface);
//   · `/api/home`'s trending rail                → zero games, so with the Games
//     type filter on, the whole "Popular right now" rail vanished (SM36).
//
// Every one of those was a single `fetchGamePage` call that should have been a
// pair. So what these tests pin is not "the code combines two arrays" — it's
// that a games pull SURVIVES ONE SOURCE BEING DOWN, which is the property all
// three call sites silently lacked. A test asserting only the happy path (both
// providers up) would have passed throughout the outage.
//
// IGDB is mocked rather than exercised: this is about the combination, not about
// IGDB's own client (which needs Twitch credentials and a token round trip).

const IGDB_GAMES = [
  { id: 101, name: "Igdb Only Game", __date: "2026-03-01", total_rating_count: 40, hypes: 12 },
  { id: 102, name: "Shared Title", __date: "2026-05-01", total_rating_count: 90, hypes: 30 },
];

vi.mock("@/lib/sources/igdb", () => ({
  igdbConfigured: () => true,
  discoverIgdbUpcoming: vi.fn(async () => IGDB_GAMES),
  igdbImageUrl: (id?: string) => (id ? `https://images.igdb.com/${id}.jpg` : null),
  igdbReleaseDate: (g: any) => g.__date ?? null,
}));

import { fetchGamePageAllSources, fetchTrendingGames, dedupeGames } from "./discoverFeed";
import { __resetBreakers } from "./http";
import type { FeedCandidate } from "./discoverFeed";

const rawgGame = (id: number, name: string, released: string) => ({
  id, name, released,
  background_image: `https://media.rawg.io/${id}.jpg`,
  platforms: [], genres: [], tags: [],
  ratings_count: 10, rating: 4, added: 500,
});

const rawgOk = (games: any[]) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: games }), { status: 200 }));

/** RAWG returning Cloudflare's 522 — exactly what the real outage served. */
const rawgDown = () => vi.fn().mockResolvedValue(new Response("origin down", { status: 522 }));

beforeEach(() => {
  // Breaker state is per-host and module-global; a test that drives RAWG to
  // failure would otherwise open it for every test after it.
  __resetBreakers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const titles = (cands: FeedCandidate[]) => cands.map((c) => c.title).sort();

describe("games are a two-source medium (SM35/SM36)", () => {
  it("fetchGamePageAllSources still returns IGDB games when RAWG is DOWN", async () => {
    vi.stubGlobal("fetch", rawgDown());
    const games = await fetchGamePageAllSources(1, "future");
    // The regression: this returned [] and the games section went dead.
    expect(games.length).toBeGreaterThan(0);
    expect(titles(games)).toEqual(["Igdb Only Game", "Shared Title"]);
    expect(games.every((g) => g.source === "igdb")).toBe(true);
  });

  it("fetchTrendingGames still returns games when RAWG is DOWN (Home's rail)", async () => {
    vi.stubGlobal("fetch", rawgDown());
    const games = await fetchTrendingGames(1);
    // The regression: zero games here made the whole Popular rail disappear
    // once the Games type filter was applied.
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.type === "game")).toBe(true);
  });

  it("merges BOTH sources when both are up, without duplicating a shared title", async () => {
    vi.stubGlobal("fetch", rawgOk([
      rawgGame(1, "Rawg Only Game", "2026-02-01"),
      rawgGame(2, "Shared Title", "2026-05-20"), // same title+year as IGDB 102
    ]));
    const games = await fetchGamePageAllSources(1, "future");
    expect(titles(games)).toEqual(["Igdb Only Game", "Rawg Only Game", "Shared Title"]);
    // RAWG wins the collision — it carries artwork, IGDB's entry is the filler.
    expect(games.find((g) => g.title === "Shared Title")!.source).toBe("rawg");
  });

  it("does not lose the OTHER source's games when RAWG is up but sparse", async () => {
    vi.stubGlobal("fetch", rawgOk([rawgGame(3, "Rawg Only Game", "2026-02-01")]));
    const games = await fetchGamePageAllSources(1, "future");
    expect(titles(games)).toContain("Igdb Only Game");
    expect(titles(games)).toContain("Rawg Only Game");
  });
});

describe("dedupeGames", () => {
  const c = (title: string, releaseDate: string | null, source = "rawg") =>
    ({ id: `${source}-${title}`, title, releaseDate, source } as unknown as FeedCandidate);

  it("dedupes by normalized title + year, first wins", () => {
    const out = dedupeGames([
      c("Hades II", "2026-01-01", "rawg"),
      c("hades ii", "2026-06-30", "igdb"), // same normalized title, same YEAR
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("rawg");
  });

  it("keeps same-titled games from DIFFERENT years (a remake is not a duplicate)", () => {
    const out = dedupeGames([c("Prince of Persia", "2003-01-01"), c("Prince of Persia", "2026-01-01")]);
    expect(out).toHaveLength(2);
  });

  it("treats a missing release date as its own bucket rather than collapsing them", () => {
    const out = dedupeGames([c("Untitled", null), c("Untitled", "2026-01-01")]);
    expect(out).toHaveLength(2);
  });
});
