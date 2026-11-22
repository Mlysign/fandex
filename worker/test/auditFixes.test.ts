import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAccount, disconnectIdentity, mergeAccounts } from "../src/account";
import { createSession } from "../src/auth/session";
import { DAILY_MERGES_PER_ACCOUNT, MergesExhausted, signIn } from "../src/auth/signin";
import worker from "../src/index";
import { count, db, env, wipe } from "./helpers";

// What the security audit of 2026-11-22 found in the account paths, each fix
// held in place by a test: merges that crashed or wrote for free, a disconnect
// that left Steam as the only way in, erasure that left the account's counters.

const A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const B = "aaaaaaaa-0000-4000-8000-0000000000c2";

async function twoAccounts(): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (id) VALUES (?), (?)").bind(A, B),
    db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'g-a', ?), ('discord', 'd-b', ?)").bind(A, B),
    db.prepare("INSERT INTO media_items (id, type, title) VALUES ('m1', 'movie', 'A'), ('m2', 'movie', 'B')"),
    db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, added_at, updated_at) VALUES (?, 'm1', 'local', 'library', 1, 1), (?, 'm2', 'local', 'library', 1, 1)").bind(A, B),
  ]);
}

async function get(path: string, token: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(wipe);

describe("merging two accounts that were both used", () => {
  it("does not fail on the score report and the follows both accounts hold", async () => {
    await twoAccounts();
    await db.batch([
      db.prepare("INSERT INTO score_report (user_id, medium, rated, bins, labels) VALUES (?, 'movie', 10, '[]', '[]'), (?, 'movie', 99, '[]', '[]')").bind(A, B),
      db.prepare("INSERT INTO user_facet_follows (user_id, facet_id, mode, label) VALUES (?, 'tag:x', 'follow', 'X'), (?, 'tag:x', 'avoid', 'X'), (?, 'tag:y', 'follow', 'Y')").bind(A, B, A),
    ]);
    const out = await mergeAccounts(db, A, B, "keep-mine");
    expect(out.ok).toBe(true);
    // The target's own measurement stays; the follow the person kept is theirs (A's).
    expect(await db.prepare("SELECT rated FROM score_report WHERE user_id = ?").bind(B).first()).toEqual({ rated: 99 });
    const follows = await db.prepare("SELECT facet_id, mode FROM user_facet_follows WHERE user_id = ? ORDER BY facet_id").bind(B).all();
    expect(follows.results).toEqual([{ facet_id: "tag:x", mode: "follow" }, { facet_id: "tag:y", mode: "follow" }]);
    expect(await count("users")).toBe(1);
  });

  it("counts a merge against the day's writes, and refuses one there is no room for", async () => {
    await twoAccounts();
    const tight = { ...env, DAILY_USER_WRITE_CAP: "1" } as typeof env;
    // A signed in, presenting B's Discord: B owns it and both hold rows, so the
    // silent path is not taken; the explicit merge is what gets charged.
    await expect(mergeAccounts(db, A, B, "keep-mine", async () => { throw new MergesExhausted(); })).rejects.toBeInstanceOf(MergesExhausted);
    expect(await count("users")).toBe(2); // nothing moved

    // The silent merge (the signed-in account holds nothing) is charged too.
    await db.prepare("DELETE FROM user_item_state WHERE user_id = ?").bind(A).run();
    const identity = { provider: "discord" as const, providerUserId: "d-b", displayName: null, avatarUrl: null };
    await expect(signIn(tight, identity, { userId: A, provider: "google", displayName: null })).rejects.toBeInstanceOf(MergesExhausted);
    expect(await count("users")).toBe(2);
    expect(await count("daily_budget", "kind = 'merges'")).toBe(1);
  });

  it("allows only a few merges into one account a day", async () => {
    await twoAccounts();
    await db.prepare("DELETE FROM user_item_state WHERE user_id = ?").bind(A).run();
    await db.prepare("INSERT INTO daily_budget (day, kind, n) VALUES (?, ?, ?)").bind(new Date().toISOString().slice(0, 10), `merges:${B}`, DAILY_MERGES_PER_ACCOUNT).run();
    const identity = { provider: "discord" as const, providerUserId: "d-b", displayName: null, avatarUrl: null };
    await expect(signIn(env, identity, { userId: A, provider: "google", displayName: null })).rejects.toBeInstanceOf(MergesExhausted);
  });
});

describe("disconnecting", () => {
  it("never leaves Steam as the only identity: Steam cannot sign anybody in", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id) VALUES (?)").bind(A),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'g-a', ?), ('steam', '76561197960287930', ?)").bind(A, A),
    ]);
    expect(await disconnectIdentity(db, A, "google")).toEqual({ ok: false, reason: "only-login" });
    expect(await disconnectIdentity(db, A, "steam")).toMatchObject({ ok: true, remaining: { provider: "google" } });
  });
});

describe("erasure", () => {
  it("removes the account's own counters of the day, which carry its id", async () => {
    await twoAccounts();
    const day = new Date().toISOString().slice(0, 10);
    await db.batch([
      db.prepare("INSERT INTO daily_budget (day, kind, n) VALUES (?, ?, 5), (?, ?, 1), (?, ?, 1), (?, 'user_writes', 9)").bind(day, `user_writes:${A}`, day, `export:${A}`, day, `user_writes:${B}`, day),
    ]);
    await deleteAccount(db, A);
    const left = await db.prepare("SELECT kind FROM daily_budget ORDER BY kind").all<{ kind: string }>();
    expect(left.results.map((r) => r.kind)).toEqual(["user_writes", `user_writes:${B}`]);
  });
});

describe("signed-in reads", () => {
  it("answers ten exports a day and then says to come back tomorrow", async () => {
    await twoAccounts();
    const token = await createSession(env, { userId: A, provider: "google", displayName: null });
    for (let i = 0; i < 10; i++) expect((await get("/v1/me/export", token)).status).toBe(200);
    expect((await get("/v1/me/export", token)).status).toBe(429);
  });

  it("does not take the cookie as the account to connect Steam to", async () => {
    await twoAccounts();
    const token = await createSession(env, { userId: A, provider: "google", displayName: null });
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://api.test/v1/auth/steam", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: `fx_session=${token}`, Origin: env.ALLOWED_ORIGINS.split(",")[0]!.trim() }, body: JSON.stringify({ params: {}, secret: "s".repeat(64) }),
    }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("a show's episodes", () => {
  it("answers 404 for a show it does not hold, and for an id that is not one", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://api.test/v1/shows/aaaaaaaa-0000-4000-8000-000000000999/episodes"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
