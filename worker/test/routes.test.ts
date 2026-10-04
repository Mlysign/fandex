import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { createSession } from "../src/auth/session";
import { upsertMediaItem } from "../src/catalog/ingest";
import worker from "../src/index";
import { count, db, env, igdbGame, movieItem, showItem, tmdbMovie, wipe } from "./helpers";

// The Worker end to end: a Request in, a Response out, the real router, the
// real D1. Only the providers are faked, at `fetch`.

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const ORIGIN = "https://fandex.org";

async function call(path: string, init: RequestInit = {}, e = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function session(userId = USER): Promise<string> {
  await db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(userId).run();
  return createSession(env, { userId, provider: "google", displayName: "Nils" });
}

const auth = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
const jsonBody = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Answer provider calls by url. Anything unlisted fails the test loudly. */
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

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("routing", () => {
  it("answers health, and 404s what it does not serve", async () => {
    const health = await call("/v1/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, today: { fetches: 0, userWrites: 0 } });
    expect((await call("/v1/nope")).status).toBe(404);
    expect((await call("/")).status).toBe(404);
    expect((await call("/v2/health")).status).toBe(404);
  });

  it("serves an item by id and by slug, and rejects a malformed address", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    expect(((await (await call(`/v1/items/${id}`)).json()) as any).vector.title).toBe("The Matrix");
    expect(((await (await call("/v1/items/movie/the-matrix?region=DE")).json()) as any).id).toBe(id);
    expect((await call("/v1/items/movie/nope")).status).toBe(404);
    expect((await call("/v1/items/book/the-matrix")).status).toBe(400);
    expect((await call("/v1/items/not-a-uuid")).status).toBe(400);
  });

  it("serves the taxonomy with an etag, and a 304 for a client that has it", async () => {
    const first = await call("/v1/taxonomy");
    const etag = first.headers.get("ETag")!;
    expect(etag).toBeTruthy();
    const again = await call("/v1/taxonomy", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });
});

describe("CORS and CSRF", () => {
  it("allows a browser on an origin we serve, and says nothing to any other", async () => {
    const ok = await call("/v1/health", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(ok.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    const other = await call("/v1/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers a preflight only for an origin we serve", async () => {
    expect((await call("/v1/me/state", { method: "OPTIONS", headers: { Origin: ORIGIN } })).status).toBe(204);
    expect((await call("/v1/me/state", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("refuses a state-changing request on a cookie session from an unknown origin", async () => {
    const token = await session();
    const { id } = await upsertMediaItem(db, movieItem());
    const body = jsonBody({ hidden: { add: [id] } });
    const cookie = { Cookie: `fx_session=${token}`, ...body.headers };

    // Another site made the browser send this. The cookie rode along.
    const forged = await call("/v1/me/state", { method: "PUT", body: body.body, headers: { ...cookie, Origin: "https://evil.example" } });
    expect(forged.status).toBe(403);
    const noOrigin = await call("/v1/me/state", { method: "PUT", body: body.body, headers: cookie });
    expect(noOrigin.status).toBe(403);
    expect(await count("user_hidden_items")).toBe(0);

    const ours = await call("/v1/me/state", { method: "PUT", body: body.body, headers: { ...cookie, Origin: ORIGIN } });
    expect(ours.status).toBe(200);
    // A bearer token cannot be attached cross-site, so it needs no origin.
    const app = await call("/v1/me/state", { method: "PUT", body: body.body, headers: auth(token, body.headers) });
    expect(app.status).toBe(200);
  });

  it("lets a cookie session READ from anywhere it is sent", async () => {
    const token = await session();
    expect((await call("/v1/me", { headers: { Cookie: `fx_session=${token}` } })).status).toBe(200);
  });
});

describe("your rows", () => {
  it("asks for a session instead of answering as if you had nothing", async () => {
    for (const path of ["/v1/me", "/v1/me/state/items", "/v1/me/state/counts", "/v1/me/export"]) {
      const res = await call(path);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toMatchObject({ error: "unauthorized" });
    }
    expect((await call("/v1/me/state", { method: "PUT", ...jsonBody({}) })).status).toBe(401);
    expect((await call("/v1/me", { method: "DELETE" })).status).toBe(401);
  });

  it("writes and reads state through the API", async () => {
    const token = await session();
    const { id } = await upsertMediaItem(db, movieItem());
    const put = jsonBody({ items: { upsert: [{ mediaItemId: id, source: "trakt", relation: "library", rating: 9 }] } });
    const res = await call("/v1/me/state", { method: "PUT", body: put.body, headers: auth(token, put.headers) });
    expect(await res.json()).toMatchObject({ ok: true, applied: { itemsUpserted: 1 } });

    const rows = (await (await call("/v1/me/state/items", { headers: auth(token) })).json()) as any;
    expect(rows.rows).toEqual([expect.objectContaining({ mediaItemId: id, rating: 9 })]);
    expect(await (await call("/v1/me/state/counts", { headers: auth(token) })).json()).toMatchObject({ items: 1 });
    expect(((await (await call("/v1/health")).json()) as any).today.userWrites).toBe(1);
  });

  it("answers 400 with a reason for a write it cannot store", async () => {
    const token = await session();
    const bad = jsonBody({ items: { upsert: [{ mediaItemId: "x", source: "trakt", relation: "library" }] } });
    const res = await call("/v1/me/state", { method: "PUT", body: bad.body, headers: auth(token, bad.headers) });
    expect(res.status).toBe(400);
    const notJson = await call("/v1/me/state", { method: "PUT", body: "{", headers: auth(token) });
    expect(notJson.status).toBe(400);
  });

  it("saves preferences and returns the profile", async () => {
    const token = await session();
    const put = jsonBody({ country: "DE", mediaTypes: ["movie", "show"] });
    const res = await call("/v1/me/prefs", { method: "PUT", body: put.body, headers: auth(token, put.headers) });
    expect(((await res.json()) as any).user).toMatchObject({ country: "DE", mediaTypes: ["movie", "show"] });
  });

  it("exports as a download", async () => {
    const token = await session();
    const res = await call("/v1/me/export", { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="fandex-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(((await res.json()) as any).user.id).toBe(USER);
  });

  it("erases the account, after which the token is nobody's", async () => {
    const token = await session();
    const { id } = await upsertMediaItem(db, movieItem());
    await db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation) VALUES (?, ?, 'local', 'wishlist')").bind(USER, id).run();

    const res = await call("/v1/me", { method: "DELETE", headers: auth(token) });
    expect(await res.json()).toMatchObject({ deleted: true, userRowDeleted: true, total: 1 });
    expect(await count("users")).toBe(0);
    expect(await count("user_item_state")).toBe(0);
    expect((await call("/v1/me", { headers: auth(token) })).status).toBe(401);
  });

  it("logs out every device at once", async () => {
    const phone = await session();
    const laptop = await createSession(env, { userId: USER, provider: "google", displayName: "Nils" });
    expect((await call("/v1/auth/logout", { method: "POST", headers: auth(phone) })).status).toBe(200);
    expect((await call("/v1/me", { headers: auth(phone) })).status).toBe(401);
    expect((await call("/v1/me", { headers: auth(laptop) })).status).toBe(401);
  });
});

describe("signing in over HTTP", () => {
  it("rejects a credential the provider does not vouch for", async () => {
    const google = jsonBody({ idToken: "not-a-real-token" });
    const res = await call("/v1/auth/google", { method: "POST", ...google });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "identity-rejected" });
    expect((await call("/v1/auth/google", { method: "POST", ...jsonBody({}) })).status).toBe(400);
    expect(await count("users")).toBe(0);
  });

  it("signs a Trakt user in, and the token it returns works", async () => {
    providers({ "api.trakt.tv/users/me": () => Response.json({ username: "nilsm", name: "Nils" }) });
    const res = await call("/v1/auth/trakt", { method: "POST", ...jsonBody({ accessToken: "tok_abc" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ outcome: "created", user: { provider: "trakt", displayName: "Nils" } });
    // No Origin: this is the app. It gets the token in the body and no cookie.
    expect(res.headers.get("Set-Cookie")).toBeNull();

    const me = (await (await call("/v1/me", { headers: auth(body.token) })).json()) as any;
    expect(me.identities).toEqual([{ provider: "trakt", displayName: "Nils", avatarUrl: null }]);
    // The Trakt token was used once and is stored nowhere.
    const dump = JSON.stringify((await db.prepare("SELECT * FROM user_identities").all()).results);
    expect(dump).not.toContain("tok_abc");
  });

  it("gives a browser on our origin the cookie as well", async () => {
    providers({ "api.trakt.tv/users/me": () => Response.json({ username: "nilsm" }) });
    const body = jsonBody({ accessToken: "tok_abc" });
    const res = await call("/v1/auth/trakt", { method: "POST", body: body.body, headers: { ...body.headers, Origin: ORIGIN } });
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^fx_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  });

  it("answers 502, not 401, when the provider is down", async () => {
    providers({ "api.trakt.tv/users/me": () => new Response("upstream", { status: 503 }) });
    const res = await call("/v1/auth/trakt", { method: "POST", ...jsonBody({ accessToken: "tok_abc" }) });
    expect(res.status).toBe(502);
  });
});

describe("resolving a provider title", () => {
  it("answers from the catalog without calling the provider when the title is held", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    const calls = providers({});
    const res = await call("/v1/resolve/tmdb/movie/603");
    expect(await res.json()).toEqual({ id, created: false });
    expect(calls).toEqual([]);
    expect(((await (await call("/v1/health")).json()) as any).today.fetches).toBe(0);
  });

  it("fetches a title it does not hold, once, and keeps it out of the pool", async () => {
    const calls = providers({ "api.themoviedb.org/3/movie/603": () => Response.json(tmdbMovie()) });
    const first = (await (await call("/v1/resolve/tmdb/movie/603")).json()) as any;
    expect(first.created).toBe(true);
    const again = (await (await call("/v1/resolve/tmdb/movie/603")).json()) as any;
    expect(again).toEqual({ id: first.id, created: false });
    expect(calls).toHaveLength(1);

    const row = await db.prepare("SELECT title, browsed, slug FROM media_items WHERE id = ?").bind(first.id).first();
    expect(row).toEqual({ title: "The Matrix", browsed: 1, slug: "the-matrix" });
    expect(((await (await call("/v1/health")).json()) as any).today.fetches).toBe(1);
  });

  it("resolves a game through IGDB, minting the Twitch token once and sharing it", async () => {
    const calls = providers({
      "id.twitch.tv/oauth2/token": () => Response.json({ access_token: "twitch-app-token", expires_in: 5_000_000 }),
      "api.igdb.com/v4/game_time_to_beats": () => Response.json([]),
      "api.igdb.com/v4/games": () => Response.json([igdbGame()]),
    });
    const res = (await (await call("/v1/resolve/igdb/game/1942")).json()) as any;
    expect(res.created).toBe(true);
    expect(calls.filter((u) => u.includes("id.twitch.tv"))).toHaveLength(1);
    // Parked in D1 for the next isolate, so it does not mint its own.
    const stored = await db.prepare("SELECT value, expires_at FROM kv WHERE key = 'twitch_app_token'").first<{ value: string; expires_at: number }>();
    expect(JSON.parse(stored!.value).token).toBe("twitch-app-token");
    expect(stored!.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  it("writes nothing when the provider fails or has no such title", async () => {
    providers({
      "api.themoviedb.org/3/movie/1": () => new Response("{}", { status: 404 }),
      "api.themoviedb.org/3/movie/2": () => new Response("down", { status: 500 }),
    });
    expect((await call("/v1/resolve/tmdb/movie/1")).status).toBe(404);
    expect((await call("/v1/resolve/tmdb/movie/2")).status).toBe(502);
    expect(await count("media_items")).toBe(0);
    expect(await count("media_links")).toBe(0);
  });

  it("refuses a target that makes no sense before spending anything", async () => {
    const calls = providers({});
    for (const path of ["/v1/resolve/tmdb/game/1", "/v1/resolve/igdb/movie/1", "/v1/resolve/rawg/game/1",
      "/v1/resolve/tmdb/movie/abc", "/v1/resolve/tmdb/movie/1%3Bdrop"]) {
      expect((await call(path)).status, path).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(((await (await call("/v1/health")).json()) as any).today.fetches).toBe(0);
  });

  it("stops fetching once the day's budget is spent, and still serves what it holds", async () => {
    const tight = { ...env, DAILY_FETCH_CAP: "1" };
    const calls = providers({
      "api.themoviedb.org/3/movie/603": () => Response.json(tmdbMovie()),
      "api.themoviedb.org/3/movie/604": () => Response.json(tmdbMovie({ id: 604, title: "The Matrix Reloaded" })),
    });
    expect((await call("/v1/resolve/tmdb/movie/603", {}, tight)).status).toBe(200);
    const over = await call("/v1/resolve/tmdb/movie/604", {}, tight);
    expect(over.status).toBe(503);
    expect(await over.json()).toMatchObject({ error: "budget-exhausted" });
    expect(calls).toHaveLength(1);
    // A title already held costs no budget, so it keeps working.
    expect((await call("/v1/resolve/tmdb/movie/603", {}, tight)).status).toBe(200);
  });
});

describe("rate limits", () => {
  const closed = { limit: async () => ({ success: false }) } as unknown as RateLimit;
  const broken = { limit: async () => { throw new Error("limiter down"); } } as unknown as RateLimit;

  it("answers 429 before doing the expensive thing", async () => {
    const calls = providers({});
    expect((await call("/v1/resolve/tmdb/movie/603", {}, { ...env, RL_RESOLVE: closed })).status).toBe(429);
    expect((await call("/v1/auth/trakt", { method: "POST", ...jsonBody({ accessToken: "t" }) }, { ...env, RL_AUTH: closed })).status).toBe(429);
    expect(calls).toEqual([]);

    const token = await session();
    const { id } = await upsertMediaItem(db, movieItem());
    const put = jsonBody({ hidden: { add: [id] } });
    const res = await call("/v1/me/state", { method: "PUT", body: put.body, headers: auth(token, put.headers) }, { ...env, RL_WRITE: closed });
    expect(res.status).toBe(429);
    expect(await count("user_hidden_items")).toBe(0);
  });

  it("does not limit a title the catalog already holds", async () => {
    // One indexed read, no provider call, no write. A client syncing a library
    // resolves hundreds of these in a row and must not be throttled for it.
    const { id } = await upsertMediaItem(db, movieItem());
    const res = await call("/v1/resolve/tmdb/movie/603", {}, { ...env, RL_RESOLVE: closed });
    expect(await res.json()).toEqual({ id, created: false });
  });

  it("stays up when the limiter itself is down", async () => {
    providers({ "api.themoviedb.org/3/movie/603": () => Response.json(tmdbMovie()) });
    expect((await call("/v1/resolve/tmdb/movie/603", {}, { ...env, RL_RESOLVE: broken })).status).toBe(200);
  });
});

describe("looking up many provider ids at once", () => {
  const lookup = (refs: unknown) => call("/v1/lookup", { method: "POST", ...jsonBody({ refs }) });

  it("says which are held and which are not, without fetching anything", async () => {
    const film = await upsertMediaItem(db, movieItem());
    const show = await upsertMediaItem(db, showItem());
    const calls = providers({});
    const res = (await (await lookup([
      { source: "tmdb", type: "movie", id: "603" },
      { source: "tmdb", type: "show", id: 603 },
      { source: "tmdb", type: "movie", id: "999" },
      { source: "igdb", type: "game", id: "1942" },
    ])).json()) as any;

    // The same number is a film AND a show. The type decides which.
    expect(res.found).toEqual([
      { source: "tmdb", type: "movie", id: "603", mediaItemId: film.id },
      { source: "tmdb", type: "show", id: "603", mediaItemId: show.id },
    ]);
    expect(res.missing).toEqual([
      { source: "tmdb", type: "movie", id: "999" },
      { source: "igdb", type: "game", id: "1942" },
    ]);
    expect(calls).toEqual([]);
    expect(await count("media_items")).toBe(2);
  });

  it("answers empty lists, not nulls, when everything or nothing is held", async () => {
    await upsertMediaItem(db, movieItem());
    expect(await (await lookup([{ source: "tmdb", type: "movie", id: "603" }])).json()).toMatchObject({ missing: [] });
    expect(await (await lookup([{ source: "tmdb", type: "movie", id: "1" }])).json()).toMatchObject({ found: [] });
  });

  it("rejects a body that is not a list of refs", async () => {
    expect((await lookup([])).status).toBe(400);
    expect((await lookup("nope")).status).toBe(400);
    expect((await lookup([{ source: "tmdb", type: "book", id: "1" }])).status).toBe(400);
    expect((await lookup([{ source: "tmdb", type: "movie", id: "1'; DROP TABLE users; --" }])).status).toBe(400);
    expect((await lookup(Array.from({ length: 2001 }, (_, i) => ({ source: "tmdb", type: "movie", id: String(i) })))).status).toBe(400);
  });
});

describe("game search", () => {
  it("proxies IGDB and returns thin cards with the provider id to resolve", async () => {
    providers({
      "id.twitch.tv/oauth2/token": () => Response.json({ access_token: "t", expires_in: 5_000_000 }),
      "api.igdb.com/v4/games": () => Response.json([igdbGame()]),
    });
    const res = await call("/v1/search/games?q=witcher%20routes%20test");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).results).toEqual([{
      source: "igdb", sourceId: "1942", type: "game", title: "The Witcher 3: Wild Hunt",
      releaseDate: "2015-05-19", posterUrl: expect.stringContaining("co1wyy"), votes: 4200, rating: 94,
    }]);
  });

  it("wants at least two characters", async () => {
    expect((await call("/v1/search/games?q=a")).status).toBe(400);
    expect((await call("/v1/search/games")).status).toBe(400);
  });
});
