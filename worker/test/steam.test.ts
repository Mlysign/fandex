import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { createSession } from "../src/auth/session";
import { resolveItem } from "../src/catalog/resolve";
import worker from "../src/index";
import { count, db, env, igdbGame, wipe } from "./helpers";

// The Steam half of a device's Steam sync: the library and wishlist, read with
// the Worker's key, whole or an error, and a Steam app id resolved through the
// IGDB game IGDB maps it to.

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const STEAM_ID = "76561197960287930";
const withKey = { ...env, STEAM_API_KEY: "test-steam-key" };

async function call(path: string, e: typeof env = withKey): Promise<Response> {
  const token = await createSession(env, { userId: USER, provider: "google", displayName: "Nils" });
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function steam(owned: () => Response, wishlist: () => Response) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.includes("GetOwnedGames")) return owned();
    if (url.includes("GetWishlist")) return wishlist();
    throw new Error(`unexpected provider call: ${url}`);
  });
  return calls;
}

beforeEach(async () => {
  await wipe();
  __resetBreakers();
  await db.batch([
    db.prepare("INSERT INTO users (id) VALUES (?)").bind(USER),
    db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('steam', ?, ?)").bind(STEAM_ID, USER),
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /v1/me/steam", () => {
  it("answers the library and the wishlist, with the key on the server only", async () => {
    const calls = steam(
      () => Response.json({ response: { game_count: 2, games: [
        { appid: 2073850, playtime_forever: 1200, rtime_last_played: 1790000000 },
        { appid: 70, playtime_forever: 0, rtime_last_played: 0 },
      ] } }),
      () => Response.json({ response: { items: [{ appid: 1091500, date_added: 1700000000 }] } }),
    );
    const res = await call("/v1/me/steam");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      library: [{ appid: 2073850, playtime: 1200, lastPlayed: 1790000000 }, { appid: 70, playtime: 0, lastPlayed: null }],
      wishlist: [{ appid: 1091500, addedAt: 1700000000 }],
    });
    expect(calls.every((u) => u.includes(`steamid=${STEAM_ID}`))).toBe(true);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("reads a private library as an error, never as an empty one", async () => {
    steam(() => Response.json({ response: {} }), () => Response.json({ response: {} }));
    const res = await call("/v1/me/steam");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "steam-private" });
  });

  it("answers a public library that is empty as empty", async () => {
    steam(() => Response.json({ response: { game_count: 0 } }), () => Response.json({ response: {} }));
    expect(await (await call("/v1/me/steam")).json()).toEqual({ library: [], wishlist: [] });
  });

  it("is an error when either half fails, never half an answer", async () => {
    steam(() => Response.json({ response: { game_count: 1, games: [{ appid: 70 }] } }), () => new Response("busy", { status: 503 }));
    expect((await call("/v1/me/steam")).status).toBe(502);
  });

  it("says why when it cannot ask at all", async () => {
    expect((await call("/v1/me/steam", env)).status).toBe(503);
    await db.prepare("DELETE FROM user_identities WHERE provider = 'steam'").run();
    expect((await call("/v1/me/steam")).status).toBe(404);
  });
});

describe("resolving a Steam app id", () => {
  it("stores the IGDB game IGDB maps it to, and keeps the app id as an alias", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      if (url.includes("/v4/external_games")) return Response.json(/uid = "2073850"/.test(body) ? [{ game: 214417 }] : []);
      if (url.includes("/v4/games")) return Response.json(/where id = 214417/.test(body) ? [igdbGame({ id: 214417, name: "The Finals" })] : []);
      return Response.json([]);
    });
    const out = await resolveItem(env, "steam", "game", "2073850");
    expect(out).toMatchObject({ ok: true, created: true });
    expect(await count("media_links", "source = 'igdb' AND source_id = '214417'")).toBe(1);
    expect(await count("provider_aliases", "source = 'steam' AND source_id = '2073850'")).toBe(1);
    // An app IGDB has no game for is not found, and creates nothing.
    expect(await resolveItem(env, "steam", "game", "999")).toEqual({ ok: false, reason: "not-found" });
  });
});
