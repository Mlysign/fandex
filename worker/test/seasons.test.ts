import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { upsertMediaItem } from "../src/catalog/ingest";
import { showEpisodesJson } from "../src/catalog/read";
import { seasonRowsFromTmdb, storeShowSeasons } from "../src/catalog/seasons";
import { runShowSeasonsStep, SHOW_SEASONS_DUE_SQL } from "../src/cron";
import { count, db, env, movieItem, showItem, wipe } from "./helpers";

// TMDB's `seasons` on /tv/{id}, cut down to what is stored.
const korraSeasons = [
  { season_number: 0, name: "Specials", episode_count: 3, air_date: null, poster_path: "/sp.jpg", overview: "" },
  { season_number: 1, name: "Book One: Air", episode_count: 12, air_date: "2012-04-14", poster_path: "/b1.jpg", overview: "Korra in Republic City." },
  { season_number: 2, name: "Book Two: Spirits", episode_count: 14, air_date: "2013-09-13", poster_path: null, overview: "" },
];

const seasonsOf = (id: string) =>
  db.prepare("SELECT season_number, name, episode_count, air_date, poster_url FROM show_seasons WHERE media_item_id = ? ORDER BY season_number")
    .bind(id).all<{ season_number: number; name: string | null; episode_count: number; air_date: string | null; poster_url: string | null }>()
    .then((r) => r.results);

function tmdb(answers: Record<string, unknown[] | number>): string[] {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const id = /\/tv\/(\d+)\?/.exec(url)?.[1];
    const answer = id ? answers[id] : undefined;
    if (answer === undefined) throw new Error(`unexpected provider call: ${url}`);
    if (typeof answer === "number") return new Response("{}", { status: answer });
    return Response.json({ id: Number(id), name: "A show", seasons: answer });
  });
  return calls;
}

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("a TMDB show's seasons, stored at ingest", () => {
  it("stores the numbered seasons of a full payload, so the tracker has something to draw", async () => {
    const { id } = await upsertMediaItem(db, showItem({ id: 33880, name: "The Legend of Korra", seasons: korraSeasons }));

    expect(await seasonsOf(id)).toEqual([
      { season_number: 1, name: "Book One: Air", episode_count: 12, air_date: "2012-04-14", poster_url: "https://image.tmdb.org/t/p/w342/b1.jpg" },
      { season_number: 2, name: "Book Two: Spirits", episode_count: 14, air_date: "2013-09-13", poster_url: null },
    ]);
    const body = JSON.parse((await showEpisodesJson(db, id))!);
    expect(body.seasons.map((s: { season: number }) => s.season)).toEqual([1, 2]);
    // The blob stays projected: the season list is not kept in it.
    const raw = (await db.prepare("SELECT raw_data FROM media_links WHERE media_item_id = ?").bind(id).first<{ raw_data: string }>())!.raw_data;
    expect(JSON.parse(raw).seasons).toBeUndefined();
  });

  it("writes nothing when a refresh changed nothing, and only the season that changed when one did", async () => {
    const { id } = await upsertMediaItem(db, showItem({ seasons: korraSeasons }));
    const rows = seasonRowsFromTmdb(korraSeasons)!;
    expect(await storeShowSeasons(db, id, rows)).toBe(0);
    const renamed = rows.map((r) => (r.season_number === 2 ? { ...r, name: "Book Two" } : r));
    expect(await storeShowSeasons(db, id, renamed)).toBe(1);
    expect((await seasonsOf(id))[1].name).toBe("Book Two");
  });

  it("drops a season's stored episodes when its count moves, so the device asks TMDB again", async () => {
    const { id } = await upsertMediaItem(db, showItem({ seasons: korraSeasons }));
    await db.batch([1, 2].flatMap((season) => [1, 2].map((episode) =>
      db.prepare("INSERT INTO show_episodes (media_item_id, season_number, episode_number, title) VALUES (?, ?, ?, 'x')").bind(id, season, episode),
    )));

    await upsertMediaItem(db, showItem({ seasons: korraSeasons.map((s) => (s.season_number === 2 ? { ...s, episode_count: 15 } : s)) }));

    expect(await count("show_episodes", "media_item_id = ? AND season_number = 1", [id])).toBe(2);
    expect(await count("show_episodes", "media_item_id = ? AND season_number = 2", [id])).toBe(0);
    expect((await seasonsOf(id))[1].episode_count).toBe(15);
  });

  it("leaves stored seasons alone for a payload that carries none, a thin one, or a film", async () => {
    const { id } = await upsertMediaItem(db, showItem({ seasons: korraSeasons }));
    // A payload with no `seasons` says nothing about them.
    await upsertMediaItem(db, showItem({ name: "Deadwood (renamed)" }));
    // A season TMDB stops listing keeps its row: less said is not proof of less.
    await upsertMediaItem(db, showItem({ seasons: korraSeasons.slice(0, 2) }));
    expect((await seasonsOf(id)).map((s) => s.season_number)).toEqual([1, 2]);

    const thin = await upsertMediaItem(db, { ...showItem({ id: 9001, name: "Thin", seasons: korraSeasons }), thin: true });
    expect(await seasonsOf(thin.id)).toEqual([]);
    const film = await upsertMediaItem(db, movieItem({ seasons: korraSeasons }));
    expect(await seasonsOf(film.id)).toEqual([]);
  });
});

describe("the walk over TMDB shows stored without seasons (2026-10-30)", () => {
  const cursor = () => db.prepare("SELECT value FROM kv WHERE key = 'show_seasons_cursor'").first<{ value: string }>().then((r) => r?.value ?? null);

  it("fills each show that has none, skips those that have them, moves past a 404, and parks", async () => {
    const seeded = await upsertMediaItem(db, showItem({ id: 100, name: "Seeded", seasons: korraSeasons }));
    const korra = await upsertMediaItem(db, showItem({ id: 33880, name: "The Legend of Korra" }));
    const gone = await upsertMediaItem(db, showItem({ id: 200, name: "Deleted on TMDB" }));
    const bare = await upsertMediaItem(db, showItem({ id: 300, name: "No numbered seasons" }));
    await upsertMediaItem(db, movieItem({ id: 400 }));
    const calls = tmdb({ 33880: korraSeasons, 200: 404, 300: [korraSeasons[0]] });

    expect(await runShowSeasonsStep(env, 10)).toEqual({ stored: 1, empty: 1, failed: 1 });
    expect((await seasonsOf(korra.id)).map((s) => s.season_number)).toEqual([1, 2]);
    expect(await seasonsOf(gone.id)).toEqual([]);
    expect(await seasonsOf(bare.id)).toEqual([]);
    expect(await seasonsOf(seeded.id)).toHaveLength(2);
    // One small call each, without the detail appends, and none for the show that had seasons or the film.
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => !c.includes("append_to_response"))).toBe(true);

    // Past the last id: the walk parks for good and asks nothing more.
    expect(await runShowSeasonsStep(env, 10)).toEqual({ stored: 0, empty: 0, failed: 0 });
    expect(await cursor()).toBe("done");
    expect(await runShowSeasonsStep(env, 10)).toEqual({ stored: 0, empty: 0, failed: 0 });
    expect(calls).toHaveLength(3);
  });

  it("walks in batches from its cursor", async () => {
    for (const id of [11, 12, 13]) await upsertMediaItem(db, showItem({ id, name: `Show ${id}` }));
    tmdb({ 11: korraSeasons, 12: korraSeasons, 13: korraSeasons });

    expect(await runShowSeasonsStep(env, 2)).toEqual({ stored: 2, empty: 0, failed: 0 });
    expect(await cursor()).toBe("12");
    expect(await runShowSeasonsStep(env, 2)).toEqual({ stored: 1, empty: 0, failed: 0 });
    expect(await count("show_seasons")).toBe(6);
  });

  it("stops without moving past a show when TMDB's circuit is open, and asks it again next run", async () => {
    await upsertMediaItem(db, showItem({ id: 33880, name: "The Legend of Korra" }));
    tmdb({ 33880: 503 });
    // Failures until the breaker opens; each moves the walk past nothing but the one show it was about.
    let opened = false;
    for (let i = 0; i < 20 && !opened; i++) {
      await db.prepare("DELETE FROM kv WHERE key = 'show_seasons_cursor'").run();
      const r = await runShowSeasonsStep(env, 1);
      opened = r.failed === 0 && r.stored === 0 && r.empty === 0;
    }
    expect(opened).toBe(true);
    expect(await cursor()).toBeNull();
  });

  it("reads the links from its cursor by the primary key, and probes show_seasons by its own", async () => {
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${SHOW_SEASONS_DUE_SQL}`).bind("", 6).all<{ detail: string }>()).results.map((r) => r.detail);
    expect(plan.some((d) => /SEARCH l USING (PRIMARY KEY|INDEX sqlite_autoindex_media_links)/.test(d)), plan.join(" | ")).toBe(true);
    expect(plan.some((d) => /SEARCH s USING PRIMARY KEY/.test(d)), plan.join(" | ")).toBe(true);
    expect(plan.some((d) => /SCAN (l|s)\b/.test(d)), plan.join(" | ")).toBe(false);

    // Twenty films and five shows, two of them with seasons: one batch of three reads about what it passes.
    for (let i = 0; i < 20; i++) await upsertMediaItem(db, movieItem({ id: 1000 + i, title: `Film ${i}` }));
    for (let i = 0; i < 5; i++) await upsertMediaItem(db, showItem({ id: 2000 + i, name: `Show ${i}`, ...(i < 2 ? { seasons: korraSeasons } : {}) }));
    const res = await db.prepare(SHOW_SEASONS_DUE_SQL).bind("", 3).all();
    expect(res.results).toHaveLength(3);
    expect(res.meta.rows_read).toBeLessThanOrEqual(40);
  });
});
