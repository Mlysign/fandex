import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { forgetExhausted, kvGet, kvSet } from "../src/budget";
import { BASELINE_GO_KEY, BASELINE_JSON_KEY, runBaselineStep } from "../src/baseline";
import { upsertMediaItem } from "../src/catalog/ingest";
import { runFastScheduled } from "../src/cron";
import { POOL_COUNT_KEY, poolSize } from "../src/keptCounts";
import worker from "../src/index";
import { count, db, env, movieItem, showItem, tmdbMovie, wipe } from "./helpers";

// The baseline (migration 0008, src/baseline.ts): titles drawn at random go
// into the pool through the normal resolve, and devices learn which they are.

function providers(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return respond();
    throw new Error(`unexpected provider call: ${url}`);
  });
  return calls;
}

const draw = (rows: [string, string, string][], n = 1) =>
  db.batch(rows.map(([source, id, type]) =>
    db.prepare("INSERT INTO baseline_items (source, source_id, media_type, draw) VALUES (?, ?, ?, ?)").bind(source, id, type, n)));

const rowOf = (id: string) =>
  db.prepare("SELECT state, media_item_id, added FROM baseline_items WHERE source_id = ?").bind(id).first<{ state: string; media_item_id: string | null; added: number }>();

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("the baseline walk", () => {
  it("waits for a word", async () => {
    await draw([["tmdb", "11", "movie"]]);
    expect(await runBaselineStep(env)).toBeNull();
    expect((await rowOf("11"))!.state).toBe("pending");
  });

  it("puts each drawn title in the pool and remembers whether the draw is what put it there", async () => {
    // Already in the pool (somebody's library): no fetch, keeps its page.
    const held = await upsertMediaItem(db, showItem());
    // In the catalog, but only looked at: promoted, and the draw put it in the pool.
    const looked = await upsertMediaItem(db, movieItem({ id: 604, title: "The Matrix Reloaded", belongs_to_collection: null, external_ids: {} }), { browsed: 1 });
    await draw([["tmdb", "603", "show"], ["tmdb", "604", "movie"], ["tmdb", "605", "movie"], ["tmdb", "999", "movie"]]);
    await kvSet(db, BASELINE_GO_KEY, "1");
    await kvSet(db, "steam_tags_cursor", "done");
    expect(await poolSize(db)).toBe(1);

    const calls = providers({
      "/3/movie/605": () => Response.json(tmdbMovie({ id: 605, title: "The Matrix Revolutions", belongs_to_collection: null, external_ids: {} })),
      "/3/movie/999": () => new Response("{}", { status: 404 }),
    });
    expect(await runBaselineStep(env, 10)).toEqual({ in: 3, missing: 1, failed: 0, done: false });
    expect(calls.filter((u) => u.includes("/3/movie/")).sort()).toEqual([expect.stringContaining("/3/movie/605"), expect.stringContaining("/3/movie/999")]);

    expect(await rowOf("603")).toEqual({ state: "in", media_item_id: held.id, added: 0 });
    expect(await rowOf("604")).toEqual({ state: "in", media_item_id: looked.id, added: 1 });
    expect((await rowOf("605"))!.added).toBe(1);
    expect((await rowOf("999"))!.state).toBe("missing");
    // Every title is in the pool, and the kept size was dropped so nobody is told 1.
    expect(await count("media_items", "browsed = 1")).toBe(0);
    expect(await kvGet(db, POOL_COUNT_KEY)).toBeNull();
    expect(await poolSize(db)).toBe(3);

    // The next run finds the pass through, parks, and starts the game-tagging walks again.
    expect(await runBaselineStep(env)).toEqual({ in: 0, missing: 0, failed: 0, done: true });
    expect(await kvGet(db, "steam_tags_cursor")).toBe("");
    expect(await runBaselineStep(env)).toEqual({ in: 0, missing: 0, failed: 0, done: true });
  });

  it("keeps to its own daily budget and leaves the users' resolves theirs", async () => {
    await draw([["tmdb", "605", "movie"], ["tmdb", "606", "movie"]]);
    await kvSet(db, BASELINE_GO_KEY, "1");
    providers({
      "/3/movie/605": () => Response.json(tmdbMovie({ id: 605, title: "One", belongs_to_collection: null, external_ids: {} })),
      "/3/movie/606": () => Response.json(tmdbMovie({ id: 606, title: "Two", belongs_to_collection: null, external_ids: {} })),
    });
    const capped = { ...env, DAILY_BASELINE_CAP: "1" };
    expect(await runBaselineStep(capped, 10)).toEqual({ in: 1, missing: 0, failed: 0, done: false, budget: true });
    expect((await rowOf("606"))!.state).toBe("pending");
    const spent = await db.prepare("SELECT kind, n FROM daily_budget ORDER BY kind").all<{ kind: string; n: number }>();
    expect(spent.results.map((r) => r.kind)).toEqual(["baseline"]);
    // The rest of today stays refused; tomorrow starts where today stopped.
    expect((await runBaselineStep(env, 10))!.budget).toBe(true);
    await db.prepare("DELETE FROM daily_budget").run();
    forgetExhausted();
    expect(await runBaselineStep(env, 10)).toEqual({ in: 1, missing: 0, failed: 0, done: false });
  });

  it("goes round again for a title the provider failed on, then stops asking", async () => {
    await draw([["tmdb", "605", "movie"]]);
    await kvSet(db, BASELINE_GO_KEY, "1");
    providers({ "/3/movie/605": () => new Response("down", { status: 500 }) });
    const runs = [];
    for (let i = 0; i < 8; i++) runs.push(await runBaselineStep(env));
    expect(runs.filter((r) => r!.failed).length).toBe(3);
    expect(runs.at(-1)!.done).toBe(true);
    expect((await rowOf("605"))!.state).toBe("pending");
  });

  it("runs only in the minutes the ten-minute trigger does not", async () => {
    await draw([["tmdb", "603", "show"]]);
    await upsertMediaItem(db, showItem());
    await kvSet(db, BASELINE_GO_KEY, "1");
    await runFastScheduled(env, Date.UTC(2026, 9, 26, 12, 10));
    expect((await rowOf("603"))!.state).toBe("pending");
    await runFastScheduled(env, Date.UTC(2026, 9, 26, 12, 11));
    expect((await rowOf("603"))!.state).toBe("in");
  });
});

describe("GET /v1/catalog/baseline", () => {
  it("names the baseline's pool titles, keeps the answer, and answers a 304 to a device that has it", async () => {
    expect(await (await call("/v1/catalog/baseline")).json()).toEqual({ draw: 0, items: [] });
    await db.prepare("DELETE FROM kv WHERE key = ?").bind(BASELINE_JSON_KEY).run();

    const held = await upsertMediaItem(db, showItem());
    const added = await upsertMediaItem(db, movieItem());
    await draw([["tmdb", "603", "show"], ["tmdb", "603", "movie"], ["tmdb", "1", "movie"]]);
    await db.batch([
      db.prepare("UPDATE baseline_items SET state = 'in', media_item_id = ?, added = 0 WHERE media_type = 'show'").bind(held.id),
      db.prepare("UPDATE baseline_items SET state = 'in', media_item_id = ?, added = 1 WHERE media_type = 'movie' AND source_id = '603'").bind(added.id),
    ]);
    const res = await call("/v1/catalog/baseline");
    expect(res.status).toBe(200);
    const body = await res.json() as { draw: number; items: [string, string, number][] };
    expect(body.draw).toBe(1);
    expect(body.items.sort()).toEqual([[held.id, "show", 0], [added.id, "movie", 1]].sort());

    const etag = res.headers.get("ETag")!;
    expect((await call("/v1/catalog/baseline", { headers: { "If-None-Match": etag } })).status).toBe(304);
    // Kept: a change to the table shows only once the kept answer runs out.
    await db.prepare("UPDATE baseline_items SET added = 0").run();
    expect((await (await call("/v1/catalog/baseline")).json() as typeof body).items.sort()).toEqual(body.items.sort());
  });
});
