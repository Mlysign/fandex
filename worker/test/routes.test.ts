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
    expect((await call("/v1/items/comic/the-matrix")).status).toBe(400);
    expect((await call("/v1/items/not-a-uuid")).status).toBe(400);
  });

  it("answers which films open on another day in a country, and rejects anything but item ids", async () => {
    const { id } = await upsertMediaItem(db, movieItem({
      release_dates: { results: [{ iso_3166_1: "DE", release_dates: [{ release_date: "1999-06-17T00:00:00.000Z", type: 3 }] }] },
    }));
    const ok = await call("/v1/catalog/release-dates", { method: "POST", ...jsonBody({ region: "DE", ids: [id] }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ region: "DE", dates: { [id]: "1999-06-17" } });
    expect((await call("/v1/catalog/release-dates", { method: "POST", ...jsonBody({ region: "DE", ids: ["nope"] }) })).status).toBe(400);
    expect((await call("/v1/catalog/release-dates", { method: "POST", ...jsonBody({ region: "DE" }) })).status).toBe(400);
  });

  it("serves the taxonomy with an etag, and a 304 for a client that has it", async () => {
    const first = await call("/v1/taxonomy");
    const etag = first.headers.get("ETag")!;
    expect(etag).toBeTruthy();
    const again = await call("/v1/taxonomy", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    // A browser must ask every time too, or a sweep waits out its HTTP cache.
    expect(first.headers.get("Cache-Control")).toBe("no-cache");
    // An old etag gets the whole body.
    const stale = await call("/v1/taxonomy", { headers: { "If-None-Match": 'W/"old"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("ETag")).toBe(etag);
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

  it("logs out only this device with scope=device, clearing its cookie", async () => {
    const phone = await session();
    const laptop = await createSession(env, { userId: USER, provider: "google", displayName: "Nils" });
    const res = await call("/v1/auth/logout?scope=device", { method: "POST", headers: auth(phone) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect((await call("/v1/me", { headers: auth(laptop) })).status).toBe(200);
  });
});

describe("signing in over HTTP", () => {
  it("rejects a credential the provider does not vouch for", async () => {
    const google = jsonBody({ idToken: "not-a-real-token", nonce: "n".repeat(64) });
    const res = await call("/v1/auth/google", { method: "POST", ...google });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "identity-rejected" });
    expect((await call("/v1/auth/google", { method: "POST", ...jsonBody({}) })).status).toBe(400);
    // A Google token with no nonce beside it is not looked at.
    expect((await call("/v1/auth/google", { method: "POST", ...jsonBody({ idToken: "not-a-real-token" }) })).status).toBe(400);
    expect(await count("users")).toBe(0);
  });

  it("signs a Trakt user in, and the token it returns works", async () => {
    providers({ "api.trakt.tv/users/settings": () => Response.json({ username: "nilsm", name: "Nils" }) });
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
    providers({ "api.trakt.tv/users/settings": () => Response.json({ username: "nilsm" }) });
    const body = jsonBody({ accessToken: "tok_abc" });
    const res = await call("/v1/auth/trakt", { method: "POST", body: body.body, headers: { ...body.headers, Origin: ORIGIN } });
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^fx_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  });

  it("answers 502, not 401, when the provider is down", async () => {
    providers({ "api.trakt.tv/users/settings": () => new Response("upstream", { status: 503 }) });
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

  it("opens a port's or an edition's main game, and keeps a remake as itself", async () => {
    const games: Record<string, any> = {
      "914": igdbGame({ id: 914, name: "Tony Hawk's Pro Skater 3", game_type: 0 }),
      "234861": igdbGame({ id: 234861, name: "Tony Hawk's Pro Skater 3", game_type: 11, parent_game: 914 }),
      "500": igdbGame({ id: 500, name: "Gothic II: Gold Edition", game_type: 3, version_parent: 2262 }),
      "2262": igdbGame({ id: 2262, name: "Gothic II", game_type: 0 }),
      "1877": igdbGame({ id: 1877, name: "Dead Space", game_type: 8, parent_game: 19 }),
    };
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("oauth2/token")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      if (url.includes("game_time_to_beats")) return Response.json([]);
      const id = /where id = (\d+)/.exec(String(init?.body ?? ""))?.[1] ?? "";
      asked.push(id);
      return Response.json(games[id] ? [games[id]] : []);
    });
    const open = async (id: string) => (await (await call(`/v1/resolve/igdb/game/${id}`)).json()) as any;
    const titleOf = async (itemId: string) => (await db.prepare("SELECT l.source_id FROM media_links l WHERE l.media_item_id = ?").bind(itemId).first<{ source_id: string }>())!.source_id;

    // Neither held: the port is fetched, then its main game, and only the main game is stored.
    const port = await open("234861");
    expect(await titleOf(port.id)).toBe("914");
    expect(await count("media_links", "source_id = ?", ["234861"])).toBe(0);
    // The main game already held: the port answers with it, and nothing is created.
    expect(await open("234861")).toMatchObject({ id: port.id, created: false });
    expect(await open("914")).toMatchObject({ id: port.id, created: false });
    // An edition goes to its version_parent.
    expect(await titleOf((await open("500")).id)).toBe("2262");
    // A remake has a parent_game too, and is a game of its own.
    expect(await titleOf((await open("1877")).id)).toBe("1877");
    expect(asked).not.toContain("19");
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
  const slugOf = async (id: string) => (await db.prepare("SELECT slug FROM media_items WHERE id = ?").bind(id).first<{ slug: string }>())?.slug;

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
      { source: "tmdb", type: "movie", id: "603", mediaItemId: film.id, slug: await slugOf(film.id) },
      { source: "tmdb", type: "show", id: "603", mediaItemId: show.id, slug: await slugOf(show.id) },
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
    expect((await lookup([{ source: "tmdb", type: "comic", id: "1" }])).status).toBe(400);
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
      // The card every games route answers with, so a searched game has genres to score from.
      genres: ["Role-playing (RPG)", "Fantasy"],
    }]);
  });

  it("wants at least two characters", async () => {
    expect((await call("/v1/search/games?q=a")).status).toBe(400);
    expect((await call("/v1/search/games")).status).toBe(400);
  });

  it("never sends the provider an angle bracket", async () => {
    // IGDB's edge refuses a request carrying a tag, and a refusal reads as an outage.
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("oauth2/token")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      bodies.push(String(init?.body ?? ""));
      return Response.json([]);
    });
    expect((await call("/v1/search/games?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20zelda")).status).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/[<>]/);
    expect(bodies[0]).toContain("zelda");
    // What is left after the brackets go still has to be a search term.
    expect((await call("/v1/search/games?q=%3C%3E%3Ca")).status).toBe(400);
  });

  it("asks IGDB for no ports and no editions, and keeps remakes and expansions", async () => {
    // Every port is a game of its own there, with the same name and year; opening
    // one from search made it a second title (69 pool rows on 2026-10-15). `parent_game = null`
    // would also drop every DLC, remaster and remake, which are works of their own.
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("oauth2/token")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      bodies.push(String(init?.body ?? ""));
      return Response.json([]);
    });
    await call("/v1/search/games?q=tony%20hawk");
    expect(bodies[0]).toContain("where version_parent = null & game_type != 11;");
    expect(bodies[0]).not.toContain("parent_game = null");
  });

  it("stops asking IGDB after five rejected credentials, and tries again later", async () => {
    // The auth latch (src/lib/http.ts): five 401s in a row mean our own key is
    // dead, and every further call would spend a request on a known answer.
    // Nobody had run it through the Worker before.
    let status = 401;
    const calls = providers({
      "id.twitch.tv/oauth2/token": () => Response.json({ access_token: "t", expires_in: 5_000_000 }),
      "api.igdb.com/v4/games": () => (status === 200 ? Response.json([igdbGame()]) : new Response("", { status })),
    });
    const igdbCalls = () => calls.filter((u) => u.includes("api.igdb.com")).length;

    for (let i = 0; i < 5; i++) expect((await call(`/v1/search/games?q=latch%20${i}`)).status).toBe(502);
    expect(igdbCalls()).toBe(5);

    // Latched: the sixth search answers 502 without a request, and browse, which
    // is best-effort, an empty page it does not cache. Neither reaches IGDB.
    expect((await call("/v1/search/games?q=latch%20six")).status).toBe(502);
    const browse = await call("/v1/browse/games?page=1");
    expect(browse.status).toBe(200);
    expect(((await browse.json()) as any).results).toEqual([]);
    expect(igdbCalls()).toBe(5);

    // Fifteen minutes on, one probe goes out. The key works again, so it closes.
    status = 200;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 15 * 60_000 + 1_000);
    const res = await call("/v1/search/games?q=latch%20later");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).results).toHaveLength(1);
    expect(igdbCalls()).toBe(6);
  });
});

describe("game browse and facet games", () => {
  /** Every IGDB query body, for asserting what was asked. */
  function igdb(answer: () => Response): string[] {
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("oauth2/token")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      bodies.push(String(init?.body ?? ""));
      return answer();
    });
    return bodies;
  }

  it("pages upcoming games as cards, most anticipated first, card fields only", async () => {
    const bodies = igdb(() => Response.json([igdbGame()]));
    const res = await call("/v1/browse/games?page=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0]).toMatchObject({ source: "igdb", sourceId: "1942", type: "game", title: "The Witcher 3: Wild Hunt" });
    expect(body.more).toBe(false);
    expect(bodies[0]).toContain("sort hypes desc");
    expect(bodies[0]).toContain("offset 40");
    // The card shape: no keywords or companies, which are most of a full payload's bytes.
    expect(bodies[0]).not.toContain("involved_companies");
  });

  it("pages the last sixty days' games, most rated first, for Home's trending rail", async () => {
    const bodies = igdb(() => Response.json([igdbGame()]));
    expect((await call("/v1/browse/games?page=1&window=recent")).status).toBe(200);
    expect(bodies[0]).toContain("sort total_rating_count desc");
  });

  it("refuses a page out of range", async () => {
    expect((await call("/v1/browse/games?page=0")).status).toBe(400);
    expect((await call("/v1/browse/games?page=11")).status).toBe(400);
    expect((await call("/v1/browse/games?page=x")).status).toBe(400);
  });

  it("finds a tag's games by theme, keyword or genre, and a studio's by company", async () => {
    const bodies = igdb(() => Response.json([igdbGame()]));
    expect((await call("/v1/facet/games?kind=tag&q=cyberpunk%20facet%20test")).status).toBe(200);
    expect(bodies[0]).toMatch(/themes\.name ~ \*"cyberpunk facet test"\*/);
    expect((await call("/v1/facet/games?kind=studio&q=cd%20projekt%20facet%20test")).status).toBe(200);
    expect(bodies[1]).toMatch(/involved_companies\.company\.name ~ \*"cd projekt facet test"\*/);
  });

  it("answers a failed IGDB call with 502, so it is never cached as no games", async () => {
    igdb(() => new Response("down", { status: 500 }));
    expect((await call("/v1/facet/games?kind=tag&q=failing%20facet%20test")).status).toBe(502);
  });

  it("wants a kind and a term", async () => {
    expect((await call("/v1/facet/games?kind=person&q=nolan")).status).toBe(400);
    expect((await call("/v1/facet/games?kind=tag&q=a")).status).toBe(400);
  });
});

describe("the small print of the API", () => {
  it("says which verbs a real route takes, and still 404s a path that is not one", async () => {
    const res = await call("/v1/taxonomy", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect((await call("/v1/lookup")).headers.get("Allow")).toBe("POST");
    expect((await call("/v1/nope", { method: "POST" })).status).toBe(404);
  });

  it("answers an admin route 404 whatever the verb, to anybody who is not an admin", async () => {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) expect((await call("/v1/admin/users", { method })).status).toBe(404);
  });

  it("answers HEAD on any GET route as GET would, and a show id that is not one 404 (2026-10-23)", async () => {
    const head = await call("/v1/taxonomy", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await call("/v1/items/movie/no-such-film", { method: "HEAD" })).status).toBe(404);
    expect((await call("/v1/shows/abc/episodes")).status).toBe(404);
  });

  it("answers HEAD on health with the headers and no body", async () => {
    const res = await call("/v1/health", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("lists in health the providers this isolate has stopped calling", async () => {
    expect(((await (await call("/v1/health")).json()) as any).openProviderCircuits).toEqual({});
  });

  it("has episodes for a show only: a film's id is not a show with none", async () => {
    const film = await upsertMediaItem(db, movieItem());
    const show = await upsertMediaItem(db, showItem());
    expect((await call(`/v1/shows/${film.id}/episodes`)).status).toBe(404);
    expect((await call(`/v1/shows/${show.id}/episodes`)).status).toBe(200);
  });
});

describe("the test accounts", () => {
  // Both spelled out. The test pool reads `.dev.vars` like `wrangler dev` does,
  // so on a machine that has prepared the local stack `env` arrives with the
  // switch already on, and "off" has to be said, not assumed.
  const local: typeof env = { ...env, DEV_LOGIN: "1" };
  const deployed: typeof env = { ...env, DEV_LOGIN: undefined };
  const post = (host: string, e: typeof env = local, body: unknown = {}) => {
    const ctx = createExecutionContext();
    return worker.fetch(new Request(`http://${host}/v1/dev/login`, { method: "POST", ...jsonBody(body) }), e, ctx);
  };

  it("do not exist on a Worker that was not told it is a developer's", async () => {
    expect((await post("localhost:8787", deployed)).status).toBe(404);
    expect((await post("localhost:8787", { ...env, DEV_LOGIN: "true" })).status).toBe(404);
    expect((await post("localhost:8787", { ...env, DEV_LOGIN: "0" })).status).toBe(404);
    expect(await count("users")).toBe(0);
  });

  it("do not exist at any address but this machine's, whatever the Worker was told", async () => {
    for (const host of ["fandex.org", "fandex-api.fandex-worker.workers.dev", "localhost.evil.example", "127.0.0.1.evil.example"]) {
      expect((await post(host)).status).toBe(404);
    }
    expect(await count("users")).toBe(0);
  });

  it("sign in on localhost with a token that works, and the account is made once", async () => {
    const first = await post("localhost:8787");
    expect(first.status).toBe(200);
    const { token, user } = (await first.json()) as any;
    expect(user).toMatchObject({ userId: "d0d0d0d0-0000-4000-8000-000000000001", provider: "google" });
    await post("127.0.0.1:8787");
    expect(await count("users")).toBe(1);
    expect(await count("user_identities")).toBe(1);
    const me = await call("/v1/me", { headers: auth(token) });
    expect(((await me.json()) as any).identities).toEqual([expect.objectContaining({ provider: "google", displayName: "Smoke Test" })]);
  });

  it("has a second account, and refuses a name it does not know", async () => {
    const plain = (await (await post("localhost:8787", local, { account: "plain" })).json()) as any;
    expect(plain.user.userId).toBe("d0d0d0d0-0000-4000-8000-000000000002");
    expect((await post("localhost:8787", local, { account: "nils" })).status).toBe(400);
  });

  it("joins two accounts end to end: connect, the form's answer, then the merge", async () => {
    const login = async (account: string) => (await (await post("localhost:8787", local, { account })).json()) as any;
    const connect = (token: string, account: string) => worker.fetch(
      new Request("http://localhost:8787/v1/dev/login", { method: "POST", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify({ account, connect: true }) }),
      local, createExecutionContext(),
    );
    const film = await upsertMediaItem(db, movieItem());
    const rate = (token: string, rating: number) => call("/v1/me/state", {
      method: "PUT", headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ items: { upsert: [{ mediaItemId: film.id, source: "local", relation: "library", status: "watched", rating }] } }),
    });

    const third = await login("third");
    expect(third.user).toMatchObject({ userId: "d0d0d0d0-0000-4000-8000-000000000003", provider: "discord" });
    expect((await rate(third.token, 9)).status).toBe(200);
    const plain = await login("plain");
    expect((await rate(plain.token, 4)).status).toBe(200);

    // Without a session there is nobody to connect to.
    expect((await worker.fetch(new Request("http://localhost:8787/v1/dev/login", { method: "POST", ...jsonBody({ account: "third", connect: true }) }), local, createExecutionContext())).status).toBe(401);

    // Signed in as "plain", connecting "third" finds another account holding the same film.
    const asked = await connect(plain.token, "third");
    expect(asked.status).toBe(409);
    const body = (await asked.json()) as any;
    expect(body).toMatchObject({
      error: "merge-required", provider: "discord",
      conflicts: { itemState: 1, cleanRows: 0 },
      mine: { provider: "google", displayName: "Plain Test", titles: 1 },
      theirs: { provider: "discord", displayName: "Third Test", titles: 1 },
    });
    expect(await count("users")).toBe(2);

    // No default: a merge with no resolution is refused.
    const merge = (resolution?: string) => call("/v1/auth/merge", {
      method: "POST", headers: { ...auth(plain.token), "Content-Type": "application/json" },
      body: JSON.stringify({ mergeToken: body.mergeToken, ...(resolution ? { resolution } : {}) }),
    });
    expect((await merge()).status).toBe(400);
    const done = await merge("keep-mine");
    expect(done.status).toBe(200);
    const joined = (await done.json()) as any;
    // The session is for the account the connected way in belongs to, holding "plain"'s 4.
    expect(joined.user.userId).toBe("d0d0d0d0-0000-4000-8000-000000000003");
    expect(await count("users")).toBe(1);
    const rows = await db.prepare("SELECT user_id, rating FROM user_item_state").all<{ user_id: string; rating: number }>();
    expect(rows.results).toEqual([{ user_id: "d0d0d0d0-0000-4000-8000-000000000003", rating: 4 }]);
  });

  it("comes back empty after its account is deleted", async () => {
    const { token } = (await (await post("localhost:8787")).json()) as any;
    const item = await upsertMediaItem(db, movieItem());
    await call("/v1/me/state", { method: "PUT", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify({ hidden: { add: [item.id] } }) });
    expect(await count("user_hidden_items")).toBe(1);
    expect((await call("/v1/me", { method: "DELETE", headers: auth(token) })).status).toBe(200);
    expect(await count("users")).toBe(0);
    const again = (await (await post("localhost:8787")).json()) as any;
    expect(await count("user_hidden_items")).toBe(0);
    expect((await call("/v1/me", { headers: auth(again.token) })).status).toBe(200);
  });
});
