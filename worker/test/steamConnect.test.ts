import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/session";
import { IdentityRejected, nonceHash, STEAM_RETURN_PATH, steamProfileName, verifySteamOpenId } from "../src/auth/verify";
import worker from "../src/index";
import { count, db, env, wipe } from "./helpers";

// Connecting a Steam account: the Worker asks Steam whether an OpenID answer is
// real, and only for an answer that names Steam, a Steam id, and our own page.
// Steam is a connection, never a way in.

const ORIGIN = env.ALLOWED_ORIGINS.split(",")[0]!.trim();
const STEAM_ID = "76561197960287930";
const USER = "aaaaaaaa-0000-4000-8000-0000000000b1";
const OTHER = "aaaaaaaa-0000-4000-8000-0000000000b2";
const NOW = Math.floor(Date.UTC(2026, 10, 22, 17, 0, 0) / 1000);
// The secret the device kept, and the state it put in the return address: its hash.
const SECRET = "s".repeat(64);
const STATE = await nonceHash(SECRET);

function answer(over: Record<string, string> = {}): Record<string, string> {
  return {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": `${ORIGIN}${STEAM_RETURN_PATH}?state=${STATE}`,
    "openid.response_nonce": "2026-11-22T17:00:00ZqYp3example",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...over,
  };
}

const says = (body: string, status = 200): typeof fetch => (async () => new Response(body, { status })) as unknown as typeof fetch;
const VALID = "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n";

describe("verifySteamOpenId", () => {
  it("accepts an answer Steam confirms, and asks Steam with the same values", async () => {
    let sent = "";
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => { sent = String(init?.body); return new Response(VALID); }) as unknown as typeof fetch;
    const identity = await verifySteamOpenId(env, answer(), SECRET, { fetchImpl, now: NOW });
    expect(identity).toEqual({ provider: "steam", providerUserId: STEAM_ID, displayName: null, avatarUrl: null });
    const posted = new URLSearchParams(sent);
    expect(posted.get("openid.mode")).toBe("check_authentication");
    expect(posted.get("openid.sig")).toBe("c2lnbmF0dXJl");
    expect(posted.get("openid.claimed_id")).toBe(`https://steamcommunity.com/openid/id/${STEAM_ID}`);
  });

  const rejected: [string, Record<string, string>][] = [
    ["a cancelled sign-in", { "openid.mode": "cancel" }],
    ["another sign-in service's endpoint", { "openid.op_endpoint": "https://evil.example/openid/login" }],
    ["an id on another host that ends like a Steam id", { "openid.claimed_id": `https://evil.example/openid/id/${STEAM_ID}`, "openid.identity": `https://evil.example/openid/id/${STEAM_ID}` }],
    ["an identity that differs from the claimed id", { "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931" }],
    ["an answer issued for another site", { "openid.return_to": "https://other.example/auth/steam?state=abc" }],
    ["an answer for another page of ours", { "openid.return_to": `${ORIGIN}/auth/discord` }],
    ["an answer whose claimed id is not signed", { "openid.signed": "signed,op_endpoint,identity,return_to,response_nonce,assoc_handle" }],
    ["an answer whose return address is not signed", { "openid.signed": "signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle" }],
    ["an answer with no signature", { "openid.sig": "" }],
    ["an old answer", { "openid.response_nonce": "2026-11-22T16:50:00Zold" }],
    ["an answer started with another device's secret", { "openid.return_to": `${ORIGIN}${STEAM_RETURN_PATH}?state=${"x".repeat(43)}` }],
    ["an answer with no time in its nonce", { "openid.response_nonce": "nonsense" }],
  ];
  for (const [what, over] of rejected) {
    it(`rejects ${what}, without asking Steam`, async () => {
      const fetchImpl = vi.fn(says(VALID));
      await expect(verifySteamOpenId(env, answer(over), SECRET, { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW })).rejects.toBeInstanceOf(IdentityRejected);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }

  it("rejects what Steam does not confirm, and text that only contains the words", async () => {
    await expect(verifySteamOpenId(env, answer(), SECRET, { fetchImpl: says("ns:x\nis_valid:false\n"), now: NOW })).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifySteamOpenId(env, answer(), SECRET, { fetchImpl: says("error:not is_valid:true at all\n"), now: NOW })).rejects.toBeInstanceOf(IdentityRejected);
  });

  it("rejects a value that is not text, and an answer used before", async () => {
    await expect(verifySteamOpenId(env, { ...answer(), "openid.sig": 5 as unknown as string }, SECRET, { fetchImpl: says(VALID), now: NOW })).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifySteamOpenId(env, answer(), SECRET, { fetchImpl: says(VALID), now: NOW, usedBefore: async () => true })).rejects.toBeInstanceOf(IdentityRejected);
  });

  it("rejects an answer that comes without the secret, or with a wrong one, without asking Steam", async () => {
    const fetchImpl = vi.fn(says(VALID));
    const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW };
    await expect(verifySteamOpenId(env, answer(), undefined, deps)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifySteamOpenId(env, answer(), "short", deps)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifySteamOpenId(env, answer(), "t".repeat(64), deps)).rejects.toBeInstanceOf(IdentityRejected);
    // A phone's state carries the relay's prefix in front of the same hash.
    const phone = answer({ "openid.return_to": `${ORIGIN}${STEAM_RETURN_PATH}?state=app.${STATE}` });
    await expect(verifySteamOpenId(env, phone, SECRET, deps)).resolves.toMatchObject({ providerUserId: STEAM_ID });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is a provider failure, not a rejection, when Steam cannot be reached", async () => {
    const down = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const err = await verifySteamOpenId(env, answer(), SECRET, { fetchImpl: down, now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(IdentityRejected);
    await expect(verifySteamOpenId(env, answer(), SECRET, { fetchImpl: says("busy", 503), now: NOW })).rejects.not.toBeInstanceOf(IdentityRejected);
  });
});

describe("steamProfileName", () => {
  const withKey = { ...env, STEAM_API_KEY: "test-steam-key" } as typeof env;
  it("reads the public name of the right player, or nothing", async () => {
    const players = (list: unknown[]) => says(JSON.stringify({ response: { players: list } }));
    expect(await steamProfileName(withKey, STEAM_ID, players([{ steamid: STEAM_ID, personaname: " Gordon " }]))).toBe("Gordon");
    expect(await steamProfileName(withKey, STEAM_ID, players([{ steamid: "76561197960287931", personaname: "Other" }]))).toBeNull();
    expect(await steamProfileName(withKey, STEAM_ID, says("nope", 500))).toBeNull();
    expect(await steamProfileName({ ...env, STEAM_API_KEY: undefined } as typeof env, STEAM_ID, players([]))).toBeNull();
  });
});

describe("POST /v1/auth/steam", () => {
  const withKey = { ...env, STEAM_API_KEY: "test-steam-key" } as typeof env;
  // The route reads the clock, so the answer's nonce is stamped now.
  const fresh = () => answer({ "openid.response_nonce": `${new Date().toISOString().slice(0, 19)}Zroute` });

  function steam(valid = true) {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url.includes("steamcommunity.com/openid/login")) return new Response(valid ? VALID : "is_valid:false\n");
      if (url.includes("GetPlayerSummaries")) return new Response(JSON.stringify({ response: { players: [{ steamid: STEAM_ID, personaname: "Gordon" }] } }));
      throw new Error(`unexpected provider call: ${url}`);
    });
    return calls;
  }

  async function call(params: unknown, userId: string | null = USER): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (userId) headers.Authorization = `Bearer ${await createSession(env, { userId, provider: "google", displayName: "Nils" })}`;
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://api.test/v1/auth/steam", { method: "POST", headers, body: JSON.stringify({ params, secret: SECRET }) }), withKey, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  beforeEach(async () => {
    await wipe();
    await db.batch([
      db.prepare("INSERT INTO users (id) VALUES (?)").bind(USER),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id, display_name) VALUES ('google', 'g-1', ?, 'Nils')").bind(USER),
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is a 401 with no session, before Steam is asked anything", async () => {
    const calls = steam();
    const res = await call(fresh(), null);
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
    expect(await count("users")).toBe(1);
    expect(await count("user_identities", "provider = 'steam'")).toBe(0);
  });

  it("links the Steam id to the signed-in account, with its public name", async () => {
    steam();
    const res = await call(fresh());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "linked" });
    const row = await db.prepare("SELECT user_id, provider_user_id, display_name FROM user_identities WHERE provider = 'steam'").first();
    expect(row).toEqual({ user_id: USER, provider_user_id: STEAM_ID, display_name: "Gordon" });
  });

  it("refuses the same answer a second time", async () => {
    steam();
    const params = fresh();
    expect((await call(params)).status).toBe(200);
    const again = await call(params);
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ error: "identity-rejected" });
  });

  it("is a 401 when Steam does not confirm, and stores nothing", async () => {
    steam(false);
    expect((await call(fresh())).status).toBe(401);
    expect(await count("user_identities", "provider = 'steam'")).toBe(0);
    expect(await count("kv", "key LIKE 'steam-answer:%'")).toBe(0);
  });

  it("is a 400 for a body with no answer in it", async () => {
    steam();
    expect((await call(null)).status).toBe(400);
    expect((await call(["x"])).status).toBe(400);
  });

  it("offers the merge when another account that holds rows owns the Steam id", async () => {
    steam();
    await db.batch([
      db.prepare("INSERT INTO users (id) VALUES (?)").bind(OTHER),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('steam', ?, ?)").bind(STEAM_ID, OTHER),
      db.prepare("INSERT INTO media_items (id, type, title) VALUES ('m1', 'movie', 'A'), ('g1', 'game', 'G')"),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, added_at, updated_at) VALUES (?, 'm1', 'local', 'library', 1, 1)").bind(USER),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, added_at, updated_at) VALUES (?, 'g1', 'steam', 'library', 1, 1)").bind(OTHER),
    ]);
    const res = await call(fresh());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "merge-required", provider: "steam" });
    // Nothing moved: the Steam id is still the other account's.
    const row = await db.prepare("SELECT user_id FROM user_identities WHERE provider = 'steam'").first<{ user_id: string }>();
    expect(row!.user_id).toBe(OTHER);
  });
});
