import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, readSession } from "../src/auth/session";
import worker from "../src/index";
import {
  APP_COUNT_MAX, bump, countAppBatch, countRequest, flushUsage, forgetUsage, isoWeek, routeKind, usageSnapshot,
} from "../src/usage";
import { count, db, env, wipe } from "./helpers";

// The usage counters: totals per day, off until switched on, never a user id,
// and never more row writes than their own budget allows.

const on = { ...env, USAGE_COUNTERS: "1" } as typeof env;
const USER = "aaaaaaaa-0000-4000-8000-0000000000aa";
const DAY = 86_400;

async function counters(): Promise<Record<string, number>> {
  const rows = await db.prepare("SELECT key, SUM(n) AS n FROM usage_daily GROUP BY key").all<{ key: string; n: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.key, r.n]));
}

async function post(path: string, body: unknown, e: typeof env, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    e, ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await wipe();
  forgetUsage();
});

describe("the switch", () => {
  it("counts nothing while USAGE_COUNTERS is not 1", async () => {
    bump(env, "active");
    countRequest(env, "GET", ["v1", "search", "games"], 200, () => undefined);
    expect(countAppBatch(env, { counts: { "screen:home": 3 } })).toBe(0);
    expect(await flushUsage(env)).toBe(0);
    expect(await count("usage_daily")).toBe(0);
    expect(await count("daily_budget", "kind = 'usage'")).toBe(0);
  });

  it("the app's route answers 200 and writes nothing while off", async () => {
    const res = await post("/v1/t/usage", { counts: { "screen:home": 3 } }, env);
    expect(res.status).toBe(200);
    await flushUsage(env);
    expect(await count("usage_daily")).toBe(0);
  });
});

describe("writing", () => {
  it("gathers counts and writes one row per key, adding to what is there", async () => {
    bump(on, "active");
    bump(on, "active");
    bump(on, "req:search", 3);
    expect(await count("usage_daily")).toBe(0); // nothing is written when it happens
    expect(await flushUsage(on)).toBe(2);
    bump(on, "active");
    await flushUsage(on);
    expect(await counters()).toEqual({ active: 3, "req:search": 3 });
    expect(await count("usage_daily")).toBe(2);
  });

  it("stops writing past its daily budget, and drops what it could not write", async () => {
    const tight = { ...on, DAILY_USAGE_CAP: "3" } as typeof env;
    bump(tight, "a");
    bump(tight, "b");
    expect(await flushUsage(tight)).toBe(2); // 2 rows + the budget row = 3
    bump(tight, "c");
    expect(await flushUsage(tight)).toBe(0);
    expect(Object.keys(await counters()).sort()).toEqual(["a", "b"]);
  });

  it("has no column that could name an account or a device", async () => {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('usage_daily')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name).sort()).toEqual(["day", "key", "n"]);
  });
});

describe("what the server counts", () => {
  it("names the kind of a request and skips what is not worth a count", () => {
    expect(routeKind("GET", ["v1", "catalog", "delta"])).toBe("catalog");
    expect(routeKind("GET", ["v1", "search", "games"])).toBe("search");
    expect(routeKind("GET", ["v1", "me", "state"])).toBe("me-read");
    expect(routeKind("PUT", ["v1", "me", "state"])).toBe("me-write");
    expect(routeKind("GET", ["v1", "health"])).toBeNull();
    expect(routeKind("POST", ["v1", "t", "usage"])).toBeNull();
    expect(routeKind("GET", ["v1", "admin", "usage"])).toBeNull();
  });

  it("counts a failed request under its status", async () => {
    countRequest(on, "GET", ["v1", "search", "games"], 502, () => undefined);
    countRequest(on, "GET", ["v1", "lookup"], 429, () => undefined);
    countRequest(on, "GET", ["v1", "lookup"], 404, () => undefined);
    await flushUsage(on);
    expect(await counters()).toEqual({ "req:search": 1, "req:lookup": 2, "err:502": 1, "err:429": 1 });
  });

  it("puts a moment in its ISO week", () => {
    expect(isoWeek(Date.UTC(2027, 1, 16) / 1000)).toBe("2027-W07"); // launch day, a Tuesday
    expect(isoWeek(Date.UTC(2027, 0, 1) / 1000)).toBe("2026-W53"); // a Friday that belongs to the old year
    expect(isoWeek(Date.UTC(2026, 11, 28) / 1000)).toBe("2026-W53");
    expect(isoWeek(Date.UTC(2027, 0, 4) / 1000)).toBe("2027-W01");
  });

  it("counts an account once on its first request of a day, and once for the week", async () => {
    const now = Math.floor(Date.now() / 1000);
    const created = now - 30 * DAY;
    await db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)").bind(USER, created, now - 9 * DAY).run();
    const token = await createSession(on, { userId: USER, provider: "google", displayName: null });
    const request = () => new Request("https://api.test/v1/me", { headers: { Authorization: `Bearer ${token}` } });

    // Two requests that both read the old stamp: one of them counts.
    await Promise.all([readSession(on, request()), readSession(on, request())]);
    await readSession(on, request());
    await flushUsage(on);
    expect(await counters()).toEqual({ active: 1, wactive: 1, [`ret:${isoWeek(created)}`]: 1 });
    const seen = await db.prepare("SELECT last_seen_at AS t FROM users WHERE id = ?").bind(USER).first<{ t: number }>();
    expect(seen!.t).toBeGreaterThanOrEqual(now);
  });

  it("still stamps an account whose last-seen day was never set", async () => {
    await db.prepare("INSERT INTO users (id) VALUES (?)").bind(USER).run();
    await db.prepare("UPDATE users SET last_seen_at = NULL WHERE id = ?").bind(USER).run().catch(() => undefined);
    const token = await createSession(env, { userId: USER, provider: "google", displayName: null });
    await readSession(env, new Request("https://api.test/v1/me", { headers: { Authorization: `Bearer ${token}` } }));
    const seen = await db.prepare("SELECT last_seen_at AS t FROM users WHERE id = ?").bind(USER).first<{ t: number | null }>();
    expect(seen!.t).toBeGreaterThan(0);
  });
});

describe("what the app sends", () => {
  it("keeps the counts on the list, clamps them, and drops the rest", async () => {
    const taken = countAppBatch(on, { counts: { "screen:home": 4, why: 1e9, "screen:secret": 5, day: "1", "rec:book": 0, user: 1 } });
    expect(taken).toBe(2);
    await flushUsage(on);
    expect(await counters()).toEqual({ "app:screen:home": 4, "app:why": APP_COUNT_MAX });
  });

  it("takes a batch over the route without reading who sent it", async () => {
    const res = await post("/v1/t/usage", { counts: { day: 1, "session:1to5": 1 }, userId: "nope" }, on, { Authorization: "Bearer not-a-token" });
    expect(res.status).toBe(200);
    await flushUsage(on);
    expect(await counters()).toMatchObject({ "app:day": 1, "app:session:1to5": 1 });
    expect(await count("users")).toBe(0);
  });

  it("answers 200 to a body that is not a batch", async () => {
    expect((await post("/v1/t/usage", ["x"], on)).status).toBe(200);
    expect((await post("/v1/t/usage", { counts: [1, 2] }, on)).status).toBe(200);
    await flushUsage(on);
    expect(await count("usage_daily", "key LIKE 'app:%'")).toBe(0);
  });
});

describe("the admin snapshot", () => {
  it("reads the counters and works the rest out from the rows accounts already have", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.batch([
      db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES ('u1', ?, ?)").bind(now - 20 * DAY, now),
      db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES ('u2', ?, ?)").bind(now - 20 * DAY, now),
      db.prepare("INSERT INTO media_items (id, type, title) VALUES ('m1', 'movie', 'A'), ('m2', 'movie', 'B'), ('m3', 'movie', 'C'), ('m4', 'movie', 'D'), ('m5', 'movie', 'E'), ('g1', 'game', 'G')"),
    ]);
    const rate = (user: string, item: string, at: number) =>
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, rating, reviewed_at, added_at, updated_at) VALUES (?, ?, 'local', 'library', 8, ?, ?, ?)").bind(user, item, at, at, at);
    await db.batch([
      // u1: five films in the first week, then a game two weeks in (a new media type).
      ...["m1", "m2", "m3", "m4", "m5"].map((m) => rate("u1", m, now - 19 * DAY)),
      rate("u1", "g1", now - 5 * DAY),
      // u2: one film.
      rate("u2", "m1", now - 19 * DAY),
    ]);
    bump(on, "active", 2);
    await flushUsage(on);

    const snap = await usageSnapshot(on, 30, now);
    expect(snap.on).toBe(true);
    expect(snap.counters).toEqual([expect.objectContaining({ key: "active", n: 2 })]);
    expect(snap.mediaMix).toEqual([{ types: 1, accounts: 1 }, { types: 2, accounts: 1 }]);
    expect(snap.firstWeek).toEqual([{ week: isoWeek(now - 20 * DAY), created: 2, rated5: 1 }]);
    expect(snap.newMediaType).toEqual([{ type: "game", accounts: 1 }]);
  });

  it("is a 404 for anybody who is not an admin", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://api.test/v1/admin/usage"), on, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
