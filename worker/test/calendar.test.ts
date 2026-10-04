import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearBrowsePageCache } from "@/lib/discoverFeed";
import { __resetBreakers } from "@/lib/http";
import { calendarMonth, monthKey, regionsInUse, runCalendarStep, shiftMonth, validMonth } from "../src/calendar";
import worker from "../src/index";
import { count, db, env, wipe } from "./helpers";

const NOW = new Date("2026-10-04T12:00:00Z");

const movie = (id: number, title: string, date: string, popularity: number) => ({
  id, title, release_date: date, poster_path: `/p${id}.jpg`, overview: `About ${title}.`, genre_ids: [28],
  original_language: "en", vote_count: 100, vote_average: 7.1, popularity,
});
const show = (id: number, name: string, date: string, popularity: number) => ({
  id, name, first_air_date: date, poster_path: `/s${id}.jpg`, overview: "", genre_ids: [18],
  original_language: "en", vote_count: 50, vote_average: 8, popularity,
});
const game = (id: number, name: string, date: string, hypes: number) => ({
  id, name, first_release_date: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000), cover: { image_id: `co${id}` },
  hypes, genres: [{ name: "Adventure" }], platforms: [{ name: "PC (Microsoft Windows)" }],
});

interface Feeds { movies?: unknown[] | "down"; shows?: unknown[] | "down"; games?: unknown[] | "down" }

/** Fake the three provider pages. "down" answers 500, which the fetchers degrade to an empty list. */
function providers(feeds: Feeds): string[] {
  const calls: string[] = [];
  const page = (rows: unknown[] | "down" | undefined, wrap: (r: unknown[]) => unknown) =>
    rows === "down" ? new Response("down", { status: 500 }) : Response.json(wrap(rows ?? []));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
    if (url.includes("/discover/movie")) return page(feeds.movies, (r) => ({ results: r }));
    if (url.includes("/discover/tv")) return page(feeds.shows, (r) => ({ results: r }));
    if (url.includes("api.igdb.com/v4/games")) return page(feeds.games, (r) => r);
    throw new Error(`unexpected provider call: ${url}`);
  });
  return calls;
}

const full: Feeds = {
  movies: [movie(1, "Big Film", "2026-11-06", 90), movie(2, "Small Film", "2026-11-20", 10)],
  shows: [show(3, "A Show", "2026-11-12", 40)],
  games: [game(4, "A Game", "2026-11-14", 30)],
};

beforeEach(async () => {
  await wipe();
  clearBrowsePageCache();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("month keys", () => {
  it("shifts across a year boundary and validates the range", () => {
    expect(monthKey(NOW)).toBe("2026-10");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(validMonth("2026-11", NOW)).toBe(true);
    expect(validMonth("2028-10", NOW)).toBe(true);
    expect(validMonth("2028-11", NOW)).toBe(false);
    expect(validMonth("2026-13", NOW)).toBe(false);
    expect(validMonth("2026-1", NOW)).toBe(false);
    expect(validMonth("../etc", NOW)).toBe(false);
  });
});

describe("serving a month", () => {
  it("builds a month nobody has asked for, stores cards, and never the provider payloads", async () => {
    const calls = providers(full);
    const out = await calendarMonth(env, "2026-11", "DE", undefined, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const res = JSON.parse(out.body);
    expect(res).toMatchObject({ month: "2026-11", region: "DE", stale: false });
    expect(res.data.partial).toBe(false);
    expect(res.data.items.map((i: any) => i.title).sort()).toEqual(["A Game", "A Show", "Big Film", "Small Film"]);
    expect(res.data.items.find((i: any) => i.title === "Big Film")).toMatchObject({
      source: "tmdb", sourceId: "1", type: "movie", releaseDate: "2026-11-06",
      posterUrl: expect.stringContaining("/p1.jpg"), genres: ["Action"],
    });
    // The region reaches TMDB: a German month carries German release dates.
    expect(calls.find((u) => u.includes("/discover/movie"))).toContain("region=DE");

    const stored = await db.prepare("SELECT payload FROM calendar_month WHERE region = 'DE' AND month = '2026-11'").first<{ payload: string }>();
    expect(stored!.payload).not.toContain('"raw"');
    expect(stored!.payload.startsWith('{"partial":false')).toBe(true);
  });

  it("serves a stored month without calling a provider again", async () => {
    providers(full);
    await calendarMonth(env, "2026-11", "US", undefined, NOW);
    vi.restoreAllMocks();
    const calls = providers({});
    const again = await calendarMonth(env, "2026-11", "US", undefined, NOW);
    expect(again.ok).toBe(true);
    expect(calls).toEqual([]);
    expect(await count("daily_budget", "kind = 'calendar' AND n = 1")).toBe(1);
  });

  it("serves a stale month as it is and leaves the refresh to the cron", async () => {
    providers(full);
    await calendarMonth(env, "2026-11", "US", undefined, NOW);
    await db.prepare("UPDATE calendar_month SET built_at = built_at - 3 * 86400").run();
    vi.restoreAllMocks();
    const calls = providers({});
    const out = await calendarMonth(env, "2026-11", "US", undefined, NOW);
    expect(out.ok && JSON.parse(out.body).stale).toBe(true);
    expect(calls).toEqual([]);
  });

  it("stores nothing when every provider is down, so an outage is not cached as an empty month", async () => {
    providers({ movies: "down", shows: "down", games: "down" });
    expect(await calendarMonth(env, "2026-11", "US", undefined, NOW)).toEqual({ ok: false, reason: "provider" });
    expect(await count("calendar_month")).toBe(0);
  });

  it("marks a month partial when one provider contributed nothing", async () => {
    providers({ ...full, games: "down" });
    const out = await calendarMonth(env, "2026-11", "US", undefined, NOW);
    expect(out.ok && JSON.parse(out.body).data.partial).toBe(true);
  });

  it("asks the limiter only when it is about to fetch, and respects the daily cap", async () => {
    providers(full);
    expect(await calendarMonth(env, "2026-11", "US", async () => false, NOW)).toEqual({ ok: false, reason: "rate-limited" });
    await calendarMonth(env, "2026-11", "US", undefined, NOW);
    // Stored now: a closed limiter does not matter.
    expect((await calendarMonth(env, "2026-11", "US", async () => false, NOW)).ok).toBe(true);

    const tight = { ...env, DAILY_CALENDAR_CAP: "1" };
    expect(await calendarMonth(tight, "2026-12", "US", undefined, NOW)).toEqual({ ok: false, reason: "budget" });
  });

  it("rejects a month that is not one, before anything else", async () => {
    const calls = providers(full);
    expect(await calendarMonth(env, "2026-13", "US", undefined, NOW)).toEqual({ ok: false, reason: "bad-request" });
    expect(await calendarMonth(env, "1999-01", "US", undefined, NOW)).toEqual({ ok: false, reason: "bad-request" });
    expect(calls).toEqual([]);
  });

  it("is reachable over HTTP", async () => {
    providers(full);
    const ctx = createExecutionContext();
    const month = shiftMonth(monthKey(new Date()), 1);
    const res = await worker.fetch(new Request(`https://api.test/v1/calendar/${month}?region=DE`), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).region).toBe("DE");
    const bad = await worker.fetch(new Request("https://api.test/v1/calendar/nope"), env, createExecutionContext());
    expect(bad.status).toBe(400);
  });
});

describe("the cron's half", () => {
  it("builds for the regions somebody uses, plus the default", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, country) VALUES ('u1', 'DE')"),
      db.prepare("INSERT INTO users (id, country) VALUES ('u2', 'DE')"),
      db.prepare("INSERT INTO users (id) VALUES ('u3')"),
    ]);
    expect((await regionsInUse(db)).sort()).toEqual(["DE", "US"]);
  });

  it("fills the window one month per run, never-built first", async () => {
    providers(full);
    const built = new Set<string>();
    for (let i = 0; i < 12; i++) {
      clearBrowsePageCache();
      const step = await runCalendarStep(env, NOW);
      expect(step.failed).toBeUndefined();
      built.add(step.built!);
    }
    // -5 .. +6 around October 2026, for the one region in use.
    expect(built.size).toBe(12);
    expect(built.has("US:2026-05")).toBe(true);
    expect(built.has("US:2027-04")).toBe(true);
    // Everything is fresh now, so the next run has nothing to do.
    expect(await runCalendarStep(env, NOW)).toEqual({ built: null });
  });

  it("refreshes a month once it is past its TTL, and keeps the old row if the build fails", async () => {
    providers(full);
    for (let i = 0; i < 12; i++) { clearBrowsePageCache(); await runCalendarStep(env, NOW); }
    await db.prepare("UPDATE calendar_month SET built_at = built_at - 2 * 86400 WHERE month = '2026-11'").run();
    const before = await db.prepare("SELECT payload FROM calendar_month WHERE month = '2026-11'").first<{ payload: string }>();

    vi.restoreAllMocks();
    clearBrowsePageCache();
    providers({ movies: "down", shows: "down", games: "down" });
    expect(await runCalendarStep(env, NOW)).toEqual({ built: "US:2026-11", failed: true });
    const after = await db.prepare("SELECT payload FROM calendar_month WHERE month = '2026-11'").first<{ payload: string }>();
    expect(after!.payload).toBe(before!.payload);

    // And it stands down for a while instead of retrying the same month every run.
    vi.restoreAllMocks();
    const calls = providers(full);
    expect(await runCalendarStep(env, NOW)).toEqual({ built: null });
    expect(calls).toEqual([]);

    await db.prepare("DELETE FROM kv WHERE key = 'calendar_backoff'").run();
    expect(await runCalendarStep(env, NOW)).toEqual({ built: "US:2026-11" });
  });

  it("does not refetch a month that has fully elapsed for thirty days", async () => {
    providers(full);
    for (let i = 0; i < 12; i++) { clearBrowsePageCache(); await runCalendarStep(env, NOW); }
    // Ten days on: the past months are still inside their TTL, the open ones are not.
    const later = new Date(NOW.getTime() + 10 * 86_400_000);
    await db.prepare("UPDATE calendar_month SET built_at = built_at - 10 * 86400").run();
    const step = await runCalendarStep(env, later);
    expect(step.built).not.toBeNull();
    expect(step.built! >= "US:2026-10").toBe(true);
  });
});
