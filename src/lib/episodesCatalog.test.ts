import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDb, run, get, query } from "./db";
import { ensureShowSeasons, ensureSeasonEpisodes, loadEpisodes, episodeCatalogDiagnostic } from "./episodes";

// MB14 — the CATALOG half. Filled lazily from TMDB one show (then one season) at
// a time, P18's precedent: the alternative is a full-catalog fetch, which is the
// op that took prod down once.
//
// Two properties matter here. It must not re-fetch what it already has (a show
// page is hit far more often than TMDB's season data changes), and a TMDB outage
// must DEGRADE to what's stored rather than throw or clear — nothing on this
// path drives a prune, so serving a slightly stale season list is strictly
// better than failing the request.

initDb();

const SHOW = "show-cat";

beforeEach(() => {
  run("DELETE FROM show_episodes");
  run("DELETE FROM show_seasons");
  run("DELETE FROM media_items");
  run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'show', 'Andor', 'andor')", [SHOW]);
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data)
     VALUES ('l1', ?, 'tmdb', '83867', 'show', 'Andor', '{}')`,
    [SHOW],
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const notFound = () => new Response("nope", { status: 404 });

const SEASONS = {
  seasons: [
    { season_number: 0, name: "Specials", episode_count: 3 },
    { season_number: 1, name: "Season 1", episode_count: 12, air_date: "2022-09-21", poster_path: "/p1.jpg" },
    { season_number: 2, name: "Season 2", episode_count: 12, air_date: "2025-04-22" },
  ],
};

describe("ensureShowSeasons", () => {
  it("stores the season list and drops TMDB's specials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(SEASONS)));

    const seasons = await ensureShowSeasons(SHOW);

    expect(seasons.map((s) => s.seasonNumber)).toEqual([1, 2]);
    expect(seasons[0]).toMatchObject({ name: "Season 1", episodeCount: 12, airDate: "2022-09-21" });
    expect(seasons[0].posterUrl).toContain("/p1.jpg");
  });

  it("does not re-fetch a fresh season list", async () => {
    const f = vi.fn().mockResolvedValue(ok(SEASONS));
    vi.stubGlobal("fetch", f);

    await ensureShowSeasons(SHOW);
    await ensureShowSeasons(SHOW);

    expect(f).toHaveBeenCalledTimes(1);
  });

  it("degrades to the stored list when TMDB is down — never throws, never clears", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(SEASONS)));
    await ensureShowSeasons(SHOW);
    // Age the rows past the TTL so the next call really does try to refetch.
    run("UPDATE show_seasons SET updated_at = 0");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notFound()));
    const seasons = await ensureShowSeasons(SHOW);

    expect(seasons.map((s) => s.seasonNumber)).toEqual([1, 2]);
  });

  it("makes no call at all for a show with no TMDB link", async () => {
    run("DELETE FROM media_links");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);

    expect(await ensureShowSeasons(SHOW)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("ensureSeasonEpisodes", () => {
  const EPISODES = {
    episodes: [
      { episode_number: 1, name: "Kassa", air_date: "2022-09-21", runtime: 38, still_path: "/s1.jpg" },
      { episode_number: 2, name: "That Would Be Me", air_date: "2022-09-21", runtime: 34 },
    ],
  };

  it("stores one season's episodes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(EPISODES)));

    const eps = await ensureSeasonEpisodes(SHOW, 1);

    expect(eps.map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(eps[0]).toMatchObject({ title: "Kassa", runtimeMinutes: 38, airDate: "2022-09-21" });
    expect(eps[0].stillUrl).toContain("/s1.jpg");
  });

  it("does not re-fetch a season it already has", async () => {
    const f = vi.fn().mockResolvedValue(ok(EPISODES));
    vi.stubGlobal("fetch", f);

    await ensureSeasonEpisodes(SHOW, 1);
    await ensureSeasonEpisodes(SHOW, 1);

    expect(f).toHaveBeenCalledTimes(1);
  });

  it("corrects a season header that under-counts the real episode list", async () => {
    // A currently-airing show's announced episode_count lags the episodes TMDB
    // actually lists, and the header count is what "n of total" is drawn from.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(SEASONS)));
    await ensureShowSeasons(SHOW);
    run("UPDATE show_seasons SET episode_count = 1 WHERE season_number = 1");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(EPISODES)));
    await ensureSeasonEpisodes(SHOW, 1);

    expect(
      get<{ episode_count: number }>(
        "SELECT episode_count FROM show_seasons WHERE media_item_id = ? AND season_number = 1",
        [SHOW],
      )?.episode_count,
    ).toBe(2);
  });

  it("degrades to the stored episodes when TMDB is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(EPISODES)));
    await ensureSeasonEpisodes(SHOW, 1);
    run("UPDATE show_episodes SET updated_at = 0");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notFound()));
    expect((await ensureSeasonEpisodes(SHOW, 1)).map((e) => e.episodeNumber)).toEqual([1, 2]);
  });
});

describe("the catalog tables are shared, not personal", () => {
  it("cascades away with the item, taking no user rows with it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(SEASONS)));
    await ensureShowSeasons(SHOW);
    expect(loadEpisodes(SHOW, 1)).toEqual([]);

    run("DELETE FROM media_items WHERE id = ?", [SHOW]);
    expect(query("SELECT * FROM show_seasons WHERE media_item_id = ?", [SHOW])).toHaveLength(0);
  });
});

describe("episodeCatalogDiagnostic — why a show's season list is empty", () => {
  // Both ensure* helpers degrade on a provider failure, which is right — but
  // degrading SILENTLY made "TMDB is refusing us" and "this show has no
  // seasons" the same blank section on every show at once. That is what a
  // whole-site symptom looked like from a phone, with nothing to read.
  it("reports a show with no TMDB link — it can never fill", async () => {
    run("DELETE FROM media_links");
    const d = episodeCatalogDiagnostic(SHOW);
    expect(d).toMatchObject({ tmdbLinked: false, seasonsStored: 0, episodesStored: 0 });
  });

  it("records the failure text when TMDB refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notFound()));
    await ensureShowSeasons(SHOW);

    const d = episodeCatalogDiagnostic(SHOW);
    expect(d.tmdbLinked).toBe(true);
    expect(d.seasonsStored).toBe(0);
    expect(d.lastError).toMatch(/404/);
  });

  it("records a 200 that carried no usable seasons — NOT the same as a failure", async () => {
    // "Fetched fine, returned nothing" and "never fetched" look identical from
    // the outside; only this tells them apart.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ seasons: [] })));
    await ensureShowSeasons(SHOW);
    expect(episodeCatalogDiagnostic(SHOW).lastError).toMatch(/none usable/);
  });

  it("says nothing when the catalog is healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(SEASONS)));
    await ensureShowSeasons(SHOW);
    const d = episodeCatalogDiagnostic(SHOW);
    expect(d.seasonsStored).toBe(2);
    expect(d.lastError).toBeNull();
  });
});

describe("Trakt as the episode catalog — for a show TMDB never linked", () => {
  // The gap Nils found: watch state comes from Trakt and only Trakt, but "what
  // episodes EXIST" came only from TMDB — so a Trakt-only show rendered a blank
  // section on a show Trakt knows everything about. `/sync/watched/shows` can't
  // fill it either: it returns only what you HAVE watched, never the full list.
  const traktOnly = (id: string) => {
    run("DELETE FROM media_links");
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data)
       VALUES ('lt', ?, 'trakt', '155', 'show', 'Andor', '{}')`,
      [id],
    );
  };

  const traktSeasons = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  const PAYLOAD = [
    { number: 0, title: "Specials", episodes: [{ number: 1, title: "Special" }] },
    {
      number: 1,
      title: "Season 1",
      first_aired: "2022-09-21T00:00:00.000Z",
      episodes: [
        { number: 1, title: "Kassa", first_aired: "2022-09-21T00:00:00.000Z", runtime: 38 },
        { number: 2, title: "That Would Be Me", first_aired: "2022-09-21T00:00:00.000Z", runtime: 34 },
      ],
    },
  ];

  it("fills seasons AND episodes from ONE Trakt call, dropping specials", async () => {
    traktOnly(SHOW);
    const f = vi.fn().mockResolvedValue(traktSeasons(PAYLOAD));
    vi.stubGlobal("fetch", f);

    const seasons = await ensureShowSeasons(SHOW);

    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("/shows/155/seasons");
    expect(String(f.mock.calls[0][0])).toContain("extended=full,episodes");
    expect(seasons.map((s) => s.seasonNumber)).toEqual([1]); // season 0 dropped
    expect(seasons[0]).toMatchObject({ name: "Season 1", episodeCount: 2, airDate: "2022-09-21" });

    // The same call already filled the episodes — no per-season endpoint exists.
    const eps = loadEpisodes(SHOW, 1);
    expect(eps.map((e) => e.title)).toEqual(["Kassa", "That Would Be Me"]);
    expect(eps[0]).toMatchObject({ airDate: "2022-09-21", runtimeMinutes: 38, stillUrl: null });
  });

  it("serves ensureSeasonEpisodes without a second call", async () => {
    traktOnly(SHOW);
    const f = vi.fn().mockResolvedValue(traktSeasons(PAYLOAD));
    vi.stubGlobal("fetch", f);

    expect((await ensureSeasonEpisodes(SHOW, 1)).map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("prefers TMDB when both are linked — stills and overviews are worth the extra call", async () => {
    // media_links already has the TMDB row from the outer beforeEach.
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data)
       VALUES ('lt', ?, 'trakt', '155', 'show', 'Andor', '{}')`,
      [SHOW],
    );
    const f = vi.fn().mockResolvedValue(ok(SEASONS));
    vi.stubGlobal("fetch", f);

    await ensureShowSeasons(SHOW);
    expect(String(f.mock.calls[0][0])).toContain("themoviedb.org");
  });

  it("degrades, and says so, when Trakt refuses too", async () => {
    traktOnly(SHOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));

    expect(await ensureShowSeasons(SHOW)).toEqual([]);
    const d = episodeCatalogDiagnostic(SHOW);
    expect(d).toMatchObject({ tmdbLinked: false, traktLinked: true });
    expect(d.lastError).toMatch(/404/);
  });
});
