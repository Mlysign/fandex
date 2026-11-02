import { describe, it, expect, vi, afterEach } from "vitest";
import { getTmdbShow, fillCreditsFromAggregate } from "./tmdb";
import { normalizeSource } from "./normalize";
import { projectRawData } from "./project";

// Adolescence (TMDB 249042): every actor is filed per episode as a guest star,
// so `credits.cast` is empty and the page had no Cast rail. The cast lives in
// `aggregate_credits`, whose rows carry `roles` / `jobs` instead of one
// character or job.

const aggregate = {
  cast: [
    { id: 2, name: "Owen Cooper", profile_path: "/oc.jpg", total_episode_count: 3,
      roles: [{ character: "Jamie Miller (voice)", episode_count: 1 }, { character: "Jamie Miller", episode_count: 2 }] },
    { id: 1, name: "Stephen Graham", profile_path: "/sg.jpg", total_episode_count: 4,
      roles: [{ character: "Eddie Miller", episode_count: 4 }] },
    { id: 3, name: "Nobody Credited", profile_path: null, total_episode_count: 1, roles: [] },
  ],
  crew: [
    { id: 9, name: "Jack Thorne", profile_path: null, total_episode_count: 4,
      jobs: [{ job: "Writer", episode_count: 4 }, { job: "Executive Producer", episode_count: 4 }] },
  ],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fillCreditsFromAggregate", () => {
  it("fills an empty cast in credits' own shape, most episodes first, main role as the character", () => {
    const out = fillCreditsFromAggregate({ cast: [], crew: [] }, aggregate);
    expect(out.cast).toEqual([
      { id: 1, name: "Stephen Graham", character: "Eddie Miller", profile_path: "/sg.jpg", order: 0 },
      { id: 2, name: "Owen Cooper", character: "Jamie Miller", profile_path: "/oc.jpg", order: 1 },
      { id: 3, name: "Nobody Credited", character: null, profile_path: null, order: 2 },
    ]);
    expect(out.crew).toEqual([
      { id: 9, name: "Jack Thorne", job: "Writer", profile_path: null },
      { id: 9, name: "Jack Thorne", job: "Executive Producer", profile_path: null },
    ]);
  });

  it("leaves a half that already has rows alone", () => {
    const crew = [{ id: 5, name: "Kept", job: "Director" }];
    const out = fillCreditsFromAggregate({ cast: [], crew }, aggregate);
    expect(out.crew).toBe(crew);
    expect(out.cast).toHaveLength(3);
  });

  it("the filled cast survives the projection and reaches the normalized item", () => {
    const credits = fillCreditsFromAggregate({ cast: [], crew: [] }, aggregate);
    const stored = projectRawData("tmdb", { id: 249042, name: "Adolescence", first_air_date: "2025-03-13", credits });
    const n = normalizeSource("tmdb", stored, "show") as any;
    expect(n.cast[0]).toEqual({ name: "Stephen Graham", character: "Eddie Miller", profileUrl: "https://image.tmdb.org/t/p/w185/sg.jpg" });
  });
});

describe("getTmdbShow", () => {
  it("asks the latest season's aggregate_credits when the show's cast is empty", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ id: 249042, name: "Adolescence", number_of_seasons: 1, last_episode_to_air: { season_number: 1 }, credits: { cast: [], crew: [] } }))
      .mockResolvedValueOnce(json(aggregate));
    vi.stubGlobal("fetch", f);

    const d = await getTmdbShow(249042);

    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1][0])).toContain("/tv/249042/season/1/aggregate_credits");
    expect(d.credits.cast.map((c: any) => c.name)).toEqual(["Stephen Graham", "Owen Cooper", "Nobody Credited"]);
  });

  it("falls back to the series' aggregate_credits when no season is named", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ id: 7, name: "Z", credits: { cast: [], crew: [] } }))
      .mockResolvedValueOnce(json(aggregate));
    vi.stubGlobal("fetch", f);

    await getTmdbShow(7);

    expect(String(f.mock.calls[1][0])).toContain("/tv/7/aggregate_credits");
  });

  it("makes one call for a show that has a cast", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ id: 1, name: "X", credits: { cast: [{ name: "A" }], crew: [] } }));
    vi.stubGlobal("fetch", f);

    const d = await getTmdbShow(1);

    expect(f).toHaveBeenCalledTimes(1);
    expect(d.credits.cast).toEqual([{ name: "A" }]);
  });

  it("throws when aggregate_credits fails, so a refresh keeps the stored copy", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ id: 2, name: "Y", credits: { cast: [], crew: [] } }))
      .mockResolvedValueOnce(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", f);

    await expect(getTmdbShow(2)).rejects.toThrow(/aggregate_credits/);
  });
});
