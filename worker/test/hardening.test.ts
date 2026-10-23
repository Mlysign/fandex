import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { spend } from "../src/budget";
import { LINKS_GUARD_SQL, LINKS_TOKEN_SQL, upsertMediaItem } from "../src/catalog/ingest";
import { lookupRefsJson, resolveItem } from "../src/catalog/resolve";
import { runHousekeepingStep } from "../src/cron";
import { cachedAnswer, clientIp, readJson } from "../src/http";
import worker from "../src/index";
import { applyStateWrite, parseStateWrite } from "../src/me";
import { count, db, env, igdbGame, movieItem, wipe } from "./helpers";

// What the 2026-10-23 review closed: the open routes that could spend the day's
// D1 reads, one account spending everybody's writes, a provider id that
// answered as another being fetched again on every sync, and the race between
// two writers deriving one item.

const USER = "aaaaaaaa-0000-4000-8000-000000000001";

async function call(path: string, init: RequestInit = {}, e = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const jsonBody = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
/** A limiter that refuses everything. */
const closed = { limit: async () => ({ success: false }) } as unknown as RateLimit;

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("the open read routes", () => {
  const refs = [{ source: "tmdb", type: "movie", id: "603" }, { source: "tmdb", type: "movie", id: "604" }];

  it("rate-limits and budgets /v1/lookup by the refs it answers", async () => {
    expect((await call("/v1/lookup", { method: "POST", ...jsonBody({ refs }) }, { ...env, RL_READ: closed })).status).toBe(429);
    const tight = { ...env, DAILY_LOOKUP_CAP: "3" };
    expect((await call("/v1/lookup", { method: "POST", ...jsonBody({ refs }) }, tight)).status).toBe(200);
    const over = await call("/v1/lookup", { method: "POST", ...jsonBody({ refs }) }, tight);
    expect(over.status).toBe(503);
    expect(await over.json()).toMatchObject({ error: "budget-exhausted" });
  });

  it("rate-limits and budgets the catalog delta by the page", async () => {
    expect((await call("/v1/catalog/delta", {}, { ...env, RL_READ: closed })).status).toBe(429);
    const tight = { ...env, DAILY_DELTA_CAP: "1" };
    expect((await call("/v1/catalog/delta", {}, tight)).status).toBe(200);
    expect((await call("/v1/catalog/delta", {}, tight)).status).toBe(503);
  });

  it("settles the delta cursor against D1's own clock", async () => {
    const body = (await (await call("/v1/catalog/delta")).json()) as { serverTime: number };
    const d1 = (await db.prepare("SELECT unixepoch() AS now").first<{ now: number }>())!.now;
    expect(Math.abs(body.serverTime - d1)).toBeLessThanOrEqual(1);
  });
});

describe("a refused budget", () => {
  it("costs no row write once the isolate has seen it refused", async () => {
    expect(await spend(db, "probe", 1)).toBe(true);
    expect(await spend(db, "probe", 1)).toBe(false);
    const n = async () => (await db.prepare("SELECT n FROM daily_budget WHERE kind = 'probe'").first<{ n: number }>())!.n;
    expect(await n()).toBe(2);
    expect(await spend(db, "probe", 1)).toBe(false);
    expect(await n()).toBe(2);
  });
});

describe("one account's share of the day's writes", () => {
  it("refuses an account past its own share while others can still write", async () => {
    const other = "bbbbbbbb-0000-4000-8000-000000000002";
    await db.batch([db.prepare("INSERT INTO users (id) VALUES (?)").bind(USER), db.prepare("INSERT INTO users (id) VALUES (?)").bind(other)]);
    const film = (await upsertMediaItem(db, movieItem())).id;
    const tight = { ...env, DAILY_USER_WRITE_CAP_PER_USER: "1" };
    const one = (relation: string) => parseStateWrite({ items: { upsert: [{ mediaItemId: film, source: "local", relation }] } });
    expect(await applyStateWrite(tight, USER, one("wishlist"))).toMatchObject({ ok: true });
    expect(await applyStateWrite(tight, USER, one("library"))).toEqual({ ok: false, reason: "budget" });
    expect(await applyStateWrite(tight, other, one("library"))).toMatchObject({ ok: true });
  });
});

describe("request plumbing", () => {
  it("keys an IPv6 caller by its /64, and leaves IPv4 alone", () => {
    const ip = (v: string) => clientIp(new Request("https://x", { headers: { "CF-Connecting-IP": v } }));
    expect(ip("2001:db8:1:2:aaaa::1")).toBe(ip("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(ip("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ip("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ip("2001:db8:1:2::1")).not.toBe(ip("2001:db8:1:3::1"));
    expect(ip("203.0.113.9")).toBe("203.0.113.9");
    expect(ip("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
  });

  it("caps a body by its bytes, also when it streams in without a length", async () => {
    const umlauts = JSON.stringify({ s: "ü".repeat(60) }); // 69 characters, 129 bytes
    await expect(readJson(new Request("https://x", { method: "POST", body: umlauts }), 100)).rejects.toMatchObject({ status: 413 });
    const stream = new ReadableStream({
      start(c) { for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(50))); c.close(); },
    });
    await expect(readJson(new Request("https://x", { method: "POST", body: stream }), 100)).rejects.toMatchObject({ status: 413 });
    expect(await readJson(new Request("https://x", { method: "POST", body: '{"a":1}' }), 100)).toEqual({ a: 1 });
  });

  it("hands an edge-cache hit to the client with the short lifetime", () => {
    const hit = new Response("{}", { headers: { "Cache-Control": "public, max-age=604800", "Content-Type": "application/json" } });
    const out = cachedAnswer(hit);
    expect(out.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(out.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("a provider id that answered as another", () => {
  it("is remembered, so the next lookup and resolve of it cost no provider call", async () => {
    // IGDB game 100 is a port of game 200: resolving 100 stores 200.
    const port = igdbGame({ id: 100, name: "Port", game_type: 11, parent_game: 200 });
    const main = igdbGame({ id: 200, name: "Main" });
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push(`${url} ${body}`);
      if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      if (url.includes("/v4/games")) return Response.json(/where id = 100/.test(body) ? [port] : /where id = 200/.test(body) ? [main] : []);
      return Response.json([]);
    });
    const first = await resolveItem(env, "igdb", "game", "100");
    expect(first).toMatchObject({ ok: true, created: true });
    expect(await count("provider_aliases", "source = 'igdb' AND source_id = '100'")).toBe(1);

    const before = calls.length;
    expect(await resolveItem(env, "igdb", "game", "100")).toEqual({ ok: true, id: (first as { id: string }).id, created: false });
    expect(calls.length).toBe(before);
    const found = JSON.parse(await lookupRefsJson(db, [{ source: "igdb", type: "game", id: "100" }]));
    expect(found.found).toEqual([expect.objectContaining({ id: "100", mediaItemId: (first as { id: string }).id })]);
    expect(found.missing).toEqual([]);
  });
});

describe("two writers deriving one item", () => {
  it("fails the later write batch when the links moved under it", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    const token = (await db.prepare(LINKS_TOKEN_SQL).bind(id).first<{ token: string }>())!.token;
    expect(await db.prepare(LINKS_GUARD_SQL).bind(token, id).first()).not.toBeNull();
    // Another writer stores a link in between.
    await db.prepare("UPDATE media_links SET last_synced = last_synced + 1 WHERE media_item_id = ?").bind(id).run();
    await expect(db.batch([db.prepare(LINKS_GUARD_SQL).bind(token, id)])).rejects.toThrow(/malformed JSON/i);
  });
});

describe("housekeeping", () => {
  it("drops old spending counters and calendar months nobody may ask for, once a day", async () => {
    const now = Date.UTC(2026, 9, 23, 12);
    await db.batch([
      db.prepare("INSERT INTO daily_budget (day, kind, n) VALUES ('2026-01-01', 'fetch', 3), ('2026-10-23', 'fetch', 1)"),
      db.prepare(`INSERT INTO calendar_month (region, month, built_at, payload) VALUES
        ('DE', '2023-01', 0, '{}'), ('DE', '2026-10', 0, '{}'), ('DE', '2030-01', 0, '{}')`),
    ]);
    expect(await runHousekeepingStep(env, now)).toEqual({ budgetRows: 1, months: 2 });
    expect(await count("daily_budget")).toBe(1);
    expect(await count("calendar_month")).toBe(1);
    expect(await runHousekeepingStep(env, now)).toBeNull();
  });
});
