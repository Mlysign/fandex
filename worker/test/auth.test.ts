import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bumpSessionEpoch, createSession, readSession, signPendingMerge, verifyPendingMerge,
} from "../src/auth/session";
import { completeMerge, signIn } from "../src/auth/signin";
import { IdentityRejected, verifyGoogleIdToken, verifyTraktToken, type VerifiedIdentity } from "../src/auth/verify";
import { upsertMediaItem } from "../src/catalog/ingest";
import { count, db, env, gameItem, movieItem, wipe } from "./helpers";

beforeEach(wipe);

const bearer = (token: string) => new Request("https://api.test/v1/me", { headers: { Authorization: `Bearer ${token}` } });
const google = (sub: string, name = "Nils"): VerifiedIdentity => ({ provider: "google", providerUserId: sub, displayName: name, avatarUrl: null });
const trakt = (username: string): VerifiedIdentity => ({ provider: "trakt", providerUserId: username, displayName: username, avatarUrl: null });

async function newUser(id = crypto.randomUUID()): Promise<string> {
  await db.prepare("INSERT INTO users (id) VALUES (?)").bind(id).run();
  return id;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

describe("sessions", () => {
  it("round-trips a token as a bearer header and as a cookie", async () => {
    const userId = await newUser();
    const token = await createSession(env, { userId, provider: "google", displayName: "Nils" });

    const viaBearer = await readSession(env, bearer(token));
    expect(viaBearer).toEqual({ user: { userId, provider: "google", displayName: "Nils" }, via: "bearer" });

    const viaCookie = await readSession(env, new Request("https://api.test/", { headers: { Cookie: `other=1; fx_session=${token}` } }));
    expect(viaCookie?.via).toBe("cookie");
    expect(viaCookie?.user.userId).toBe(userId);
  });

  it("carries nothing in the payload but the id, the provider and a display name", async () => {
    const userId = await newUser();
    const token = await createSession(env, { userId, provider: "google", displayName: "Nils" });
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(Object.keys(payload).sort()).toEqual(["dn", "exp", "iat", "p", "se", "uid"]);
  });

  it("rejects every outstanding token once the epoch is bumped", async () => {
    const userId = await newUser();
    const token = await createSession(env, { userId, provider: "google", displayName: null });
    expect(await readSession(env, bearer(token))).not.toBeNull();
    await bumpSessionEpoch(db, userId);
    expect(await readSession(env, bearer(token))).toBeNull();
    // A token minted after the bump works again.
    const fresh = await createSession(env, { userId, provider: "google", displayName: null });
    expect(await readSession(env, bearer(fresh))).not.toBeNull();
  });

  it("treats a token for an erased account as no session, not as epoch 0", async () => {
    const userId = await newUser();
    const token = await createSession(env, { userId, provider: "google", displayName: null });
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    expect(await readSession(env, bearer(token))).toBeNull();
  });

  it("rejects a token signed with another secret, and garbage", async () => {
    const userId = await newUser();
    const forged = await new SignJWT({ uid: userId, p: "google", dn: null, se: 0 })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-different-secret-entirely-123456"));
    expect(await readSession(env, bearer(forged))).toBeNull();
    expect(await readSession(env, bearer("not.a.jwt"))).toBeNull();
    expect(await readSession(env, new Request("https://api.test/"))).toBeNull();
  });

  it("refuses to sign anything without a real secret", async () => {
    const userId = await newUser();
    await expect(createSession({ ...env, JWT_SECRET: "" }, { userId, provider: "google", displayName: null })).rejects.toThrow(/JWT_SECRET/);
    await expect(createSession({ ...env, JWT_SECRET: "short" }, { userId, provider: "google", displayName: null })).rejects.toThrow(/JWT_SECRET/);
  });

  it("stamps last-seen once a day, and only for a valid token", async () => {
    const userId = await newUser();
    await db.prepare("UPDATE users SET last_seen_at = 1000 WHERE id = ?").bind(userId).run();
    const token = await createSession(env, { userId, provider: "google", displayName: null });

    await readSession(env, bearer("garbage"));
    expect((await db.prepare("SELECT last_seen_at s FROM users WHERE id = ?").bind(userId).first<{ s: number }>())!.s).toBe(1000);

    await readSession(env, bearer(token));
    const after = (await db.prepare("SELECT last_seen_at s FROM users WHERE id = ?").bind(userId).first<{ s: number }>())!.s;
    expect(after).toBeGreaterThan(1000);
  });

  it("keeps a merge proof and a session from standing in for each other", async () => {
    const a = await newUser();
    const b = await newUser();
    const session = await createSession(env, { userId: a, provider: "google", displayName: null });
    const proof = await signPendingMerge(env, { from: a, into: b, provider: "trakt" });

    expect(await verifyPendingMerge(env, proof)).toEqual({ from: a, into: b, provider: "trakt" });
    expect(await verifyPendingMerge(env, session)).toBeNull();
    expect(await readSession(env, bearer(proof))).toBeNull();
  });
});

// ── Verifying what a provider vouched for ────────────────────────────────────

describe("Google ID tokens", () => {
  let keys: JWTVerifyGetKey;
  let sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
    keys = createLocalJWKSet({ keys: [jwk] });
    sign = (claims, opts = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(opts.iss ?? "https://accounts.google.com")
        .setAudience(opts.aud ?? "test-google-client.apps.googleusercontent.com")
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? "1h")
        .sign(privateKey);
  });

  it("accepts a token issued to this app", async () => {
    const id = await verifyGoogleIdToken(env, await sign({ sub: "1234567890", name: "Nils M", picture: "https://x/y.png" }), keys);
    expect(id).toEqual({ provider: "google", providerUserId: "1234567890", displayName: "Nils M", avatarUrl: "https://x/y.png" });
  });

  it("rejects a token issued to ANOTHER app, which is the check that matters", async () => {
    // Google-signed, unexpired, a real user: and minted for somebody else's
    // site. Accepting it would let that site's operator sign in as the user.
    const token = await sign({ sub: "1234567890" }, { aud: "someone-else.apps.googleusercontent.com" });
    await expect(verifyGoogleIdToken(env, token, keys)).rejects.toBeInstanceOf(IdentityRejected);
  });

  it("rejects everything when no client id is configured, rather than accepting anything", async () => {
    const token = await sign({ sub: "1234567890" });
    await expect(verifyGoogleIdToken({ ...env, GOOGLE_CLIENT_ID: "" }, token, keys)).rejects.toBeInstanceOf(IdentityRejected);
  });

  it("rejects a wrong issuer, an expired token, a missing subject and a bad signature", async () => {
    await expect(verifyGoogleIdToken(env, await sign({ sub: "1" }, { iss: "https://evil.example" }), keys)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifyGoogleIdToken(env, await sign({ sub: "1" }, { exp: "-1h" }), keys)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifyGoogleIdToken(env, await sign({ name: "no subject" }), keys)).rejects.toBeInstanceOf(IdentityRejected);

    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ sub: "1" }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com").setAudience("test-google-client.apps.googleusercontent.com")
      .setExpirationTime("1h").sign(other.privateKey);
    await expect(verifyGoogleIdToken(env, forged, keys)).rejects.toBeInstanceOf(IdentityRejected);
  });

  it("accepts any of several configured client ids", async () => {
    const multi = { ...env, GOOGLE_CLIENT_ID: "web.apps.googleusercontent.com, android.apps.googleusercontent.com" };
    const token = await sign({ sub: "7" }, { aud: "android.apps.googleusercontent.com" });
    expect((await verifyGoogleIdToken(multi, token, keys)).providerUserId).toBe("7");
  });
});

describe("Trakt tokens", () => {
  const answering = (status: number, body: unknown) => {
    const calls: Request[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input as string, init));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { impl, calls };
  };

  it("asks Trakt whose token it is, with OUR client id", async () => {
    const { impl, calls } = answering(200, { username: "nilsm", name: "Nils", images: { avatar: { full: "https://t/a.png" } } });
    const id = await verifyTraktToken(env, "tok_abc", impl);
    expect(id).toEqual({ provider: "trakt", providerUserId: "nilsm", displayName: "Nils", avatarUrl: "https://t/a.png" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.trakt.tv/users/me");
    expect(calls[0].headers.get("trakt-api-key")).toBe("test-trakt-client");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer tok_abc");
  });

  it("rejects a token Trakt refuses, and tells an outage apart from a refusal", async () => {
    await expect(verifyTraktToken(env, "tok", answering(401, {}).impl)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifyTraktToken(env, "tok", answering(403, {}).impl)).rejects.toBeInstanceOf(IdentityRejected);
    // A 5xx is Trakt being down. That must not read as "this person is nobody".
    const outage = verifyTraktToken(env, "tok", answering(503, {}).impl);
    await expect(outage).rejects.toThrow(/503/);
    await expect(outage).rejects.not.toBeInstanceOf(IdentityRejected);
  });

  it("rejects an answer with no username, and a malformed token without calling Trakt", async () => {
    await expect(verifyTraktToken(env, "tok", answering(200, { name: "x" }).impl)).rejects.toBeInstanceOf(IdentityRejected);
    const { impl, calls } = answering(200, { username: "x" });
    await expect(verifyTraktToken(env, "has a space", impl)).rejects.toBeInstanceOf(IdentityRejected);
    await expect(verifyTraktToken(env, "", impl)).rejects.toBeInstanceOf(IdentityRejected);
    expect(calls).toHaveLength(0);
  });
});

// ── Which account is that? ───────────────────────────────────────────────────

describe("signing in", () => {
  it("creates an account for an identity nobody has seen", async () => {
    const out = await signIn(env, google("g-1"), null);
    expect(out.kind).toBe("created");
    if (out.kind !== "created") return;
    expect(await count("users")).toBe(1);
    expect(await count("user_identities", "user_id = ?", [out.user.userId])).toBe(1);
    expect((await readSession(env, bearer(out.token)))?.user.userId).toBe(out.user.userId);
  });

  it("signs the owner back in, without creating anything", async () => {
    const first = await signIn(env, google("g-1"), null);
    const again = await signIn(env, google("g-1"), null);
    expect(again.kind).toBe("signed-in");
    if (first.kind !== "created" || again.kind !== "signed-in") return;
    expect(again.user.userId).toBe(first.user.userId);
    expect(await count("users")).toBe(1);
  });

  it("links a new identity to the signed-in account", async () => {
    const first = await signIn(env, google("g-1"), null);
    if (first.kind !== "created") throw new Error("setup");
    const linked = await signIn(env, trakt("nilsm"), first.user);
    expect(linked.kind).toBe("linked");
    if (linked.kind !== "linked") return;
    expect(linked.user.userId).toBe(first.user.userId);
    expect(await count("users")).toBe(1);
    expect(await count("user_identities", "user_id = ?", [first.user.userId])).toBe(2);
  });

  it("never stores a provider token", async () => {
    await signIn(env, trakt("nilsm"), null);
    const cols = await db.prepare("PRAGMA table_info(user_identities)").all<{ name: string }>();
    expect(cols.results.map((c) => c.name).filter((n) => /token|secret/i.test(n))).toEqual([]);
  });

  it("creates one account when the same new identity signs in twice at once", async () => {
    const outs = await Promise.all([signIn(env, google("g-race"), null), signIn(env, google("g-race"), null)]);
    const ids = outs.map((o) => ("user" in o ? o.user.userId : null));
    expect(ids[0]).not.toBeNull();
    expect(ids[0]).toBe(ids[1]);
    expect(await count("users")).toBe(1);
    expect(await count("user_identities")).toBe(1);
  });

  it("merges straight away when the identity belongs to another account and nothing overlaps", async () => {
    // The established account, reached with Trakt.
    const established = await signIn(env, trakt("nilsm"), null);
    // A fresh account, made by signing in with Google on a new device.
    const fresh = await signIn(env, google("g-1"), null);
    if (established.kind !== "created" || fresh.kind !== "created") throw new Error("setup");
    const film = await upsertMediaItem(db, movieItem());
    await db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation) VALUES (?, ?, 'local', 'wishlist')")
      .bind(fresh.user.userId, film.id).run();

    // Signed in as the fresh account, the person proves they own the Trakt one.
    const out = await signIn(env, trakt("nilsm"), fresh.user);
    expect(out.kind).toBe("merged");
    if (out.kind !== "merged") return;
    // The session is for the SURVIVOR, which is not who started the request.
    expect(out.user.userId).toBe(established.user.userId);
    expect(await count("users")).toBe(1);
    expect(await count("user_identities", "user_id = ?", [established.user.userId])).toBe(2);
    expect(await count("user_item_state", "user_id = ?", [established.user.userId])).toBe(1);
    // The old token names an account that no longer exists.
    expect(await readSession(env, bearer(fresh.token))).toBeNull();
    expect((await readSession(env, bearer(out.token)))?.user.userId).toBe(established.user.userId);
  });

  it("asks rather than picking a winner when both accounts hold the same title", async () => {
    const established = await signIn(env, trakt("nilsm"), null);
    const fresh = await signIn(env, google("g-1"), null);
    if (established.kind !== "created" || fresh.kind !== "created") throw new Error("setup");
    const film = await upsertMediaItem(db, movieItem());
    const game = await upsertMediaItem(db, gameItem());
    const put = (user: string, item: string, rating: number) =>
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, rating) VALUES (?, ?, 'local', 'library', ?)")
        .bind(user, item, rating).run();
    await put(established.user.userId, film.id, 9);
    await put(fresh.user.userId, film.id, 4);
    await put(fresh.user.userId, game.id, 7);

    const out = await signIn(env, trakt("nilsm"), fresh.user);
    expect(out.kind).toBe("merge-required");
    if (out.kind !== "merge-required") return;
    expect(out.conflicts).toMatchObject({ itemState: 1, episodeState: 0, cleanRows: 1, sampleTitles: ["The Matrix"] });
    // Nothing was written: both accounts are exactly as they were.
    expect(await count("users")).toBe(2);
    expect(await count("user_item_state")).toBe(3);

    // "Keep mine": the signed-in account's 4 wins over the established 9.
    const done = await completeMerge(env, fresh.user, out.mergeToken, "keep-mine");
    expect(done.kind).toBe("merged");
    if (done.kind !== "merged") return;
    expect(done.user.userId).toBe(established.user.userId);
    expect(await count("users")).toBe(1);
    const rows = await db.prepare("SELECT media_item_id, rating FROM user_item_state WHERE user_id = ? ORDER BY rating")
      .bind(established.user.userId).all<{ media_item_id: string; rating: number }>();
    expect(rows.results).toEqual([{ media_item_id: film.id, rating: 4 }, { media_item_id: game.id, rating: 7 }]);
  });

  it("keeps the established rows under keep-theirs", async () => {
    const established = await signIn(env, trakt("nilsm"), null);
    const fresh = await signIn(env, google("g-1"), null);
    if (established.kind !== "created" || fresh.kind !== "created") throw new Error("setup");
    const film = await upsertMediaItem(db, movieItem());
    for (const [user, rating] of [[established.user.userId, 9], [fresh.user.userId, 4]] as const) {
      await db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, rating) VALUES (?, ?, 'local', 'library', ?)")
        .bind(user, film.id, rating).run();
    }
    const out = await signIn(env, trakt("nilsm"), fresh.user);
    if (out.kind !== "merge-required") throw new Error("setup");
    await completeMerge(env, fresh.user, out.mergeToken, "keep-theirs");
    const row = await db.prepare("SELECT rating FROM user_item_state").first<{ rating: number }>();
    expect(row!.rating).toBe(9);
    expect(await count("user_item_state")).toBe(1);
  });

  it("refuses a merge proof presented by anyone but the account it was minted for", async () => {
    const a = await signIn(env, trakt("a"), null);
    const b = await signIn(env, google("b"), null);
    const c = await signIn(env, google("c"), null);
    if (a.kind !== "created" || b.kind !== "created" || c.kind !== "created") throw new Error("setup");
    const proof = await signPendingMerge(env, { from: b.user.userId, into: a.user.userId, provider: "trakt" });
    expect((await completeMerge(env, c.user, proof, "keep-mine")).kind).toBe("invalid");
    expect((await completeMerge(env, b.user, "garbage", "keep-mine")).kind).toBe("invalid");
    expect(await count("users")).toBe(3);
  });

  it("refuses when both accounts already sign in with the same provider", async () => {
    // Account A: google g-a + trakt nilsm. Account B: google g-b.
    const a = await signIn(env, google("g-a"), null);
    if (a.kind !== "created") throw new Error("setup");
    await signIn(env, trakt("nilsm"), a.user);
    const b = await signIn(env, google("g-b"), null);
    if (b.kind !== "created") throw new Error("setup");

    // Signed in as B, proving ownership of A's Trakt. Both have a Google
    // identity, so there is no unambiguous way to join them.
    const out = await signIn(env, trakt("nilsm"), b.user);
    expect(out).toEqual({ kind: "provider-taken", provider: "trakt", conflict: "google" });
    expect(await count("users")).toBe(2);
  });

  it("carries a hidden title across a merge without colliding", async () => {
    const established = await signIn(env, trakt("nilsm"), null);
    const fresh = await signIn(env, google("g-1"), null);
    if (established.kind !== "created" || fresh.kind !== "created") throw new Error("setup");
    const film = await upsertMediaItem(db, movieItem());
    const game = await upsertMediaItem(db, gameItem());
    // Both hid the film. Only the fresh account hid the game.
    for (const [user, item] of [[established.user.userId, film.id], [fresh.user.userId, film.id], [fresh.user.userId, game.id]]) {
      await db.prepare("INSERT INTO user_hidden_items (user_id, media_item_id) VALUES (?, ?)").bind(user, item).run();
    }
    const out = await signIn(env, trakt("nilsm"), fresh.user);
    expect(out.kind).toBe("merged");
    expect(await count("user_hidden_items", "user_id = ?", [established.user.userId])).toBe(2);
  });
});
