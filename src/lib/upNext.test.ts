import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initDb, run } from "./db";
import { markEpisodes } from "./episodes";
import { buildUpNext, upNextStatus, backfillUpNextCatalog } from "./upNext";

// Home's progress module. ONE filter and ONE sort, and both are the feature:
//
//   FILTER  the episode immediately before it is marked watched. That's all —
//           nothing is excluded for being old.
//   SORT    a watch and a release are dated events on one timeline; an entry
//           sits at its LATEST event, newest first, capped at ~10.
//
// (A 30-day recency FILTER was the first cut of this, replaced the same day: the
// two arms are the same two dates, but as a filter they silently hid a show
// instead of ranking it, and there is no honest cutoff.)

initDb();

const USER = "u-next";
const NOW = 1_760_000_000; // fixed clock; every case is relative to it
const DAY = 86_400;
const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

beforeEach(() => {
  run("DELETE FROM user_episode_state");
  run("DELETE FROM show_episodes");
  run("DELETE FROM show_seasons");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("DELETE FROM sync_log");
  run("DELETE FROM user_identities");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  // No TMDB reachable in tests. Every show below is seeded with a FRESH catalog,
  // so buildUpNext's bounded heal has nothing to do and never leaves the DB.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A show whose seasons/episodes are already stored and fresh. */
function show(
  id: string,
  title: string,
  seasons: { season: number; episodes: number; airDate?: string }[],
) {
  run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'show', ?, ?)", [id, title, id]);
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
     VALUES (?, ?, 'tmdb', ?, ?, '{}')`,
    [`${id}-l`, id, id, title],
  );
  for (const s of seasons) {
    run(
      `INSERT INTO show_seasons (media_item_id, season_number, name, episode_count, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, s.season, `Season ${s.season}`, s.episodes, NOW],
    );
    for (let e = 1; e <= s.episodes; e++) {
      run(
        `INSERT INTO show_episodes (media_item_id, season_number, episode_number, title, air_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, s.season, e, `Ep ${s.season}x${e}`, s.airDate ?? null, NOW],
      );
    }
  }
}

/** Mark episodes watched at a given time. */
function watched(id: string, eps: [number, number][], at: number) {
  markEpisodes(USER, id, eps.map(([season, episode]) => ({ season, episode })), { watchedAt: at });
}

const upNext = () => buildUpNext(USER, { now: NOW, maxHealShows: 0 });
const labels = async () =>
  (await upNext()).map((e) => `${e.showTitle} ${e.season}x${e.episode}`);

describe("rule 1 — the preceding episode must be watched", () => {
  it("offers the episode after the last one you watched", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    watched("a", [[1, 1], [1, 2]], NOW - DAY);
    expect(await labels()).toEqual(["Alpha 1x3"]);
  });

  it("offers nothing for a show you have never ticked — this is CONTINUE, not START", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    expect(await labels()).toEqual([]);
  });

  it("fills the earliest GAP, not the episode after the highest watched", async () => {
    // Watched 1,2 and 5. The next one to watch is 3, not 6.
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    watched("a", [[1, 1], [1, 2], [1, 5]], NOW - DAY);
    expect(await labels()).toEqual(["Alpha 1x3"]);
  });

  it("rolls over the season boundary after a finale", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 3 }, { season: 2, episodes: 8 }]);
    watched("a", [[1, 1], [1, 2], [1, 3]], NOW - DAY);
    expect(await labels()).toEqual(["Alpha 2x1"]);
  });

  it("offers nothing once the show is fully watched", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 3 }]);
    watched("a", [[1, 1], [1, 2], [1, 3]], NOW - DAY);
    expect(await labels()).toEqual([]);
  });
});

describe("the event timeline — a watch and a release rank the same way", () => {
  it("orders by latest event, newest first — and re-orders when a tick adds one", async () => {
    // Nils's own example, verbatim.
    //   Jan 1  a Pluribus episode is marked watched
    //   Jan 2  a new Andor episode is released
    //   Jan 3  a One Piece episode is marked watched
    const JAN1 = NOW - 3 * DAY, JAN2 = NOW - 2 * DAY, JAN3 = NOW - 1 * DAY;

    show("p", "Pluribus", [{ season: 1, episodes: 6, airDate: iso(NOW - 300 * DAY) }]);
    watched("p", [[1, 1]], JAN1);

    // Andor's next episode is the one that dropped on Jan 2; the watch that
    // unlocked it is older, so the RELEASE is Andor's latest event.
    show("a", "Andor", [
      { season: 1, episodes: 1, airDate: iso(NOW - 300 * DAY) },
      { season: 2, episodes: 4, airDate: iso(JAN2) },
    ]);
    watched("a", [[1, 1]], NOW - 200 * DAY);

    show("o", "One Piece", [{ season: 1, episodes: 6, airDate: iso(NOW - 300 * DAY) }]);
    watched("o", [[1, 1]], JAN3);

    expect((await upNext()).map((e) => e.showTitle)).toEqual(["One Piece", "Andor", "Pluribus"]);

    // Now tick Pluribus. That stamps a NEW event on it and a new episode is
    // available, so it jumps to the front.
    watched("p", [[1, 2]], NOW);
    expect((await upNext()).map((e) => e.showTitle)).toEqual(["Pluribus", "One Piece", "Andor"]);
  });

  it("reports which of the two events won", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 6, airDate: iso(NOW - 300 * DAY) }]);
    watched("a", [[1, 1]], NOW - DAY);
    show("b", "Bravo", [{ season: 1, episodes: 6, airDate: iso(NOW - 2 * DAY) }]);
    watched("b", [[1, 1]], NOW - 300 * DAY);

    const byTitle = Object.fromEntries((await upNext()).map((e) => [e.showTitle, e.eventKind]));
    expect(byTitle).toEqual({ Alpha: "watched", Bravo: "released" });
  });

  it("KEEPS a show nobody has touched in a year — age is a rank, not a filter", async () => {
    // The behaviour the recency filter got wrong. It still belongs in the rail,
    // it just sorts below anything with a newer event.
    show("old", "Ancient", [{ season: 1, episodes: 6, airDate: iso(NOW - 900 * DAY) }]);
    watched("old", [[1, 1]], NOW - 800 * DAY);
    show("new", "Fresh", [{ season: 1, episodes: 6, airDate: iso(NOW - 300 * DAY) }]);
    watched("new", [[1, 1]], NOW - DAY);

    expect((await upNext()).map((e) => e.showTitle)).toEqual(["Fresh", "Ancient"]);
  });

  it("sorts an entry with no dated event last, rather than dropping it", async () => {
    // Trakt can hand back an episode with no last_watched_at, and a catalog row
    // can have no air_date. The filter already said this belongs here.
    show("a", "Alpha", [{ season: 1, episodes: 6 }]); // no airDate
    run(
      `INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, watched_at, sources)
       VALUES (?, 'a', 1, 1, NULL, '["trakt"]')`,
      [USER],
    );
    show("b", "Bravo", [{ season: 1, episodes: 6 }]);
    watched("b", [[1, 1]], NOW - 500 * DAY);

    const entries = await upNext();
    expect(entries.map((e) => e.showTitle)).toEqual(["Bravo", "Alpha"]);
    expect(entries[1].eventAt).toBeNull();
    expect(entries[1].eventKind).toBe("unknown");
  });

  it("caps the rail at ~10", async () => {
    for (let i = 0; i < 14; i++) {
      show(`s${i}`, `Show ${i}`, [{ season: 1, episodes: 6, airDate: iso(NOW - 300 * DAY) }]);
      watched(`s${i}`, [[1, 1]], NOW - i * DAY);
    }
    const entries = await upNext();
    expect(entries).toHaveLength(10);
    expect(entries[0].showTitle).toBe("Show 0"); // newest event first
  });
});

describe("what never appears", () => {
  it("skips an episode that hasn't aired yet", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 6, airDate: iso(NOW + 7 * DAY) }]);
    watched("a", [[1, 1]], NOW - DAY);
    expect(await labels()).toEqual([]);
  });

  it("ignores another user's watch history", async () => {
    run("INSERT INTO users (id) VALUES ('u-other')");
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    markEpisodes("u-other", "a", [{ season: 1, episode: 1 }], { watchedAt: NOW - DAY });
    expect(await labels()).toEqual([]);
  });

  it("ignores a movie that somehow carries episode state", async () => {
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES ('m', 'movie', 'Movie', 'movie')");
    run(
      `INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, watched_at)
       VALUES (?, 'm', 1, 1, ?)`,
      [USER, NOW - DAY],
    );
    expect(await labels()).toEqual([]);
  });

  it("offers nothing when the episode catalog was never fetched", async () => {
    // No show_episodes rows, and the heal budget is zero here. It degrades to
    // "no entry" rather than guessing at an episode number.
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES ('a', 'show', 'Alpha', 'a')");
    watched("a", [[1, 1]], NOW - DAY);
    expect(await labels()).toEqual([]);
  });
});

describe("ordering + payload", () => {
  it("puts the most recently watched show first", async () => {
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    show("b", "Bravo", [{ season: 1, episodes: 6 }]);
    show("c", "Charlie", [{ season: 1, episodes: 6 }]);
    watched("a", [[1, 1]], NOW - 10 * DAY);
    watched("b", [[1, 1]], NOW - 1 * DAY);
    watched("c", [[1, 1]], NOW - 5 * DAY);
    expect(await labels()).toEqual(["Bravo 1x2", "Charlie 1x2", "Alpha 1x2"]);
  });

  it("carries what the card renders, including a link to the show", async () => {
    show("a", "Alpha", [{ season: 2, episodes: 6, airDate: iso(NOW - DAY) }]);
    watched("a", [[2, 3]], NOW - DAY);
    const [e] = await upNext();
    expect(e).toMatchObject({
      mediaItemId: "a",
      showTitle: "Alpha",
      season: 2,
      episode: 4,
      episodeTitle: "Ep 2x4",
      href: "/show/a/alpha",
    });
  });
});

describe("the bounded catalog heal", () => {
  // The gap this closes: a Trakt sync writes watch state for shows nobody has
  // ever opened in Fandex, so this path can be the first thing that needs a
  // given show's episode list. It fills it — but only a few shows per request,
  // because an unbounded provider fan-out on the heaviest page in the app is the
  // exact shape of the 2026-08-02 latency incident.
  const tmdb = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function stubTmdb() {
    const f = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/tv\/[^/?]+\/season\/(\d+)/.test(u)) {
        const season = Number(u.match(/\/season\/(\d+)/)![1]);
        return tmdb({
          episodes: Array.from({ length: 4 }, (_, i) => ({
            episode_number: i + 1, name: `Ep ${season}x${i + 1}`, air_date: iso(NOW - 2 * DAY),
          })),
        });
      }
      return tmdb({ seasons: [{ season_number: 1, name: "Season 1", episode_count: 4 }] });
    });
    vi.stubGlobal("fetch", f);
    return f;
  }

  function unopenedShow(id: string, title: string) {
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'show', ?, ?)", [id, title, id]);
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
       VALUES (?, ?, 'tmdb', ?, ?, '{}')`,
      [`${id}-l`, id, id, title],
    );
  }

  it("fills a show whose episodes were never fetched, then answers from it", async () => {
    stubTmdb();
    unopenedShow("a", "Alpha");
    watched("a", [[1, 1]], NOW - DAY);

    const entries = await buildUpNext(USER, { now: NOW, maxHealShows: 1 });
    expect(entries.map((e) => `${e.showTitle} ${e.season}x${e.episode}`)).toEqual(["Alpha 1x2"]);
  });

  it("heals at most maxHealShows per request, most recently watched first", async () => {
    stubTmdb();
    unopenedShow("a", "Alpha");
    unopenedShow("b", "Bravo");
    watched("a", [[1, 1]], NOW - 10 * DAY);
    watched("b", [[1, 1]], NOW - 1 * DAY); // more recent → heals first
    expect(
      (await buildUpNext(USER, { now: NOW, maxHealShows: 1 })).map((e) => e.showTitle),
    ).toEqual(["Bravo"]);

    // The next request picks up where it left off — the heal is permanent.
    expect(
      (await buildUpNext(USER, { now: NOW, maxHealShows: 1 })).map((e) => e.showTitle),
    ).toEqual(["Bravo", "Alpha"]);
  });

  it("re-checks a STALE season list, so a new season can reach the rail", async () => {
    // The gap this closes only matters now that a release is a SORT input:
    // a show whose season list predates its new season would answer "covered"
    // forever, and that new season could never surface. Freshness is therefore
    // part of the coverage test, at lower heal priority than a missing catalog.
    const f = stubTmdb();
    unopenedShow("a", "Alpha");
    watched("a", [[1, 1]], NOW - 400 * DAY);

    await buildUpNext(USER, { now: NOW, maxHealShows: 1 });
    const calls = f.mock.calls.length;

    // Fresh → left alone.
    await buildUpNext(USER, { now: NOW, maxHealShows: 1 });
    expect(f.mock.calls.length).toBe(calls);

    // Aged past the TTL → re-fetched.
    run("UPDATE show_seasons SET updated_at = 0");
    await buildUpNext(USER, { now: NOW, maxHealShows: 1 });
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it("degrades rather than throwing when TMDB is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    unopenedShow("a", "Alpha");
    watched("a", [[1, 1]], NOW - DAY);
    await expect(buildUpNext(USER, { now: NOW, maxHealShows: 1 })).resolves.toEqual([]);
  });
});

describe("upNextStatus — why the rail is empty", () => {
  // The rail renders blank for four completely different reasons, and the first
  // thing that happened after it shipped to prod was exactly that ambiguity: a
  // sync ran, the rail stayed empty, and there was no way to tell which reason
  // it was from a phone. This is what makes them distinguishable.
  const syncLog = (provider: string, count: number, status: string, error: string | null = null) =>
    run(
      `INSERT INTO sync_log (id, user_id, provider, item_count, status, error, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`sl-${provider}-${count}`, USER, provider, count, status, error, NOW],
    );

  it("reports a virgin account: nothing connected, nothing tracked", () => {
    const s = upNextStatus(USER, { now: NOW });
    expect(s).toMatchObject({
      episodeProviderConnected: false,
      episodeRows: 0,
      showsTracked: 0,
      showsAwaitingCatalog: 0,
      lastEpisodeSync: null,
      lastLibrarySync: null,
    });
  });

  it("sees a connected episode provider", () => {
    run(
      `INSERT INTO user_identities (id, user_id, provider, provider_user_id)
       VALUES ('i1', ?, 'trakt', 'nils')`,
      [USER],
    );
    expect(upNextStatus(USER, { now: NOW }).episodeProviderConnected).toBe(true);
  });

  it("surfaces a FAILED library pull — the case that must not read as 'no data'", () => {
    syncLog("trakt-library", 0, "error", "Trakt API error: 401 /sync/watched/shows");
    const s = upNextStatus(USER, { now: NOW });
    expect(s.lastLibrarySync?.status).toBe("error");
    expect(s.lastLibrarySync?.error).toMatch(/401/);
    expect(s.episodeRows).toBe(0);
  });

  it("counts shows whose episode list still has to be fetched", () => {
    // Watch state exists, catalog does not — the bounded heal hasn't reached it.
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES ('a', 'show', 'Alpha', 'a')");
    watched("a", [[1, 1]], NOW - DAY);
    const s = upNextStatus(USER, { now: NOW });
    expect(s).toMatchObject({ episodeRows: 1, showsTracked: 1, showsAwaitingCatalog: 1 });
  });

  it("stops counting a show once its catalog can answer", () => {
    show("a", "Alpha", [{ season: 1, episodes: 6 }]);
    watched("a", [[1, 1]], NOW - DAY);
    expect(upNextStatus(USER, { now: NOW }).showsAwaitingCatalog).toBe(0);
  });

  it("reports what the last episode reconcile actually attached", () => {
    syncLog("trakt-episodes", 42, "ok shows=7 detached=0");
    expect(upNextStatus(USER, { now: NOW }).lastEpisodeSync).toMatchObject({ count: 42 });
  });
});

describe("backfillUpNextCatalog — the bulk fill behind the rail", () => {
  // The bug this closes: the first real Trakt sync attached episodes for 280
  // shows, all with an EMPTY catalog. buildUpNext heals 3 shows per render, so
  // the rail showed 2 entries against a cap of 10 and would have needed ~90 Home
  // loads to become useful. The cap was never the binding constraint — coverage
  // was. This runs on the sync path instead, where being generous is free.
  const tmdb = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function stubTmdb() {
    const f = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/tv\/[^/?]+\/season\/(\d+)/.test(u)) {
        const season = Number(u.match(/\/season\/(\d+)/)![1]);
        return tmdb({
          episodes: Array.from({ length: 4 }, (_, i) => ({
            episode_number: i + 1, name: `Ep ${season}x${i + 1}`, air_date: iso(NOW - 2 * DAY),
          })),
        });
      }
      return tmdb({ seasons: [{ season_number: 1, name: "Season 1", episode_count: 4 }] });
    });
    vi.stubGlobal("fetch", f);
    return f;
  }

  function unopenedShow(id: string, title: string) {
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'show', ?, ?)", [id, title, id]);
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
       VALUES (?, ?, 'tmdb', ?, ?, '{}')`,
      [`${id}-l`, id, id, title],
    );
  }

  it("fills far more shows than a render can, so the rail reaches its cap", async () => {
    stubTmdb();
    for (let i = 0; i < 12; i++) {
      unopenedShow(`s${i}`, `Show ${i}`);
      watched(`s${i}`, [[1, 1]], NOW - (i + 1) * DAY);
    }

    // A render alone heals 3 → nowhere near the 10-entry cap.
    expect(await buildUpNext(USER, { now: NOW, maxHealShows: 3 })).toHaveLength(3);

    await backfillUpNextCatalog(USER, { now: NOW });

    // Now every show can answer, and the cap is what limits it — which is the
    // whole point: `limit` should be the binding constraint, not coverage.
    const entries = await buildUpNext(USER, { now: NOW, maxHealShows: 0 });
    expect(entries).toHaveLength(10);
  });

  it("reports what it healed and what is left", async () => {
    stubTmdb();
    for (let i = 0; i < 5; i++) {
      unopenedShow(`s${i}`, `Show ${i}`);
      watched(`s${i}`, [[1, 1]], NOW - (i + 1) * DAY);
    }
    const r = await backfillUpNextCatalog(USER, { now: NOW, maxShows: 2 });
    expect(r).toEqual({ healed: 2, remaining: 3 });
  });

  // Resumability without a cursor table: a healed show simply stops qualifying,
  // so calling it again picks up exactly where it left off.
  it("resumes on the next call and converges", async () => {
    stubTmdb();
    for (let i = 0; i < 4; i++) {
      unopenedShow(`s${i}`, `Show ${i}`);
      watched(`s${i}`, [[1, 1]], NOW - (i + 1) * DAY);
    }
    expect((await backfillUpNextCatalog(USER, { now: NOW, maxShows: 2 })).remaining).toBe(2);
    expect((await backfillUpNextCatalog(USER, { now: NOW, maxShows: 2 })).remaining).toBe(0);
    expect((await backfillUpNextCatalog(USER, { now: NOW })).healed).toBe(0);
  });

  it("takes the most recently watched shows first", async () => {
    stubTmdb();
    unopenedShow("old", "Old");
    unopenedShow("new", "New");
    watched("old", [[1, 1]], NOW - 100 * DAY);
    watched("new", [[1, 1]], NOW - 1 * DAY);

    await backfillUpNextCatalog(USER, { now: NOW, maxShows: 1 });
    expect((await buildUpNext(USER, { now: NOW, maxHealShows: 0 })).map((e) => e.showTitle)).toEqual(["New"]);
  });

  // It runs on the sync path but writes only shared catalog rows and drives no
  // prune, so a dead provider must cost coverage and nothing else.
  it("never throws when the provider is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    unopenedShow("a", "Alpha");
    watched("a", [[1, 1]], NOW - DAY);
    await expect(backfillUpNextCatalog(USER, { now: NOW })).resolves.toMatchObject({ healed: 1 });
  });

  it("does nothing for a user with no episode state", async () => {
    stubTmdb();
    expect(await backfillUpNextCatalog("nobody", { now: NOW })).toEqual({ healed: 0, remaining: 0 });
  });
});
