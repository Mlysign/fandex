import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

// getSession() reads the cookie via next/headers — stub it with a settable token.
const cookieState = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "rr2_session" && cookieState.token ? { value: cookieState.token } : undefined),
  }),
}));

import { initDb, run, get } from "./db";
import { createSession, getSession, bumpSessionEpoch } from "./session";

initDb();

const USER = "u1";
const base = { userId: USER, identityId: "id1", provider: "trakt" as const, displayName: "Nils" };

beforeEach(() => {
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  cookieState.token = null;
});

describe("session revocation (S4)", () => {
  it("accepts a freshly minted token", async () => {
    cookieState.token = await createSession(base);
    const s = await getSession();
    expect(s?.userId).toBe(USER);
  });

  it("rejects a token issued before an epoch bump (logout/disconnect)", async () => {
    cookieState.token = await createSession(base);
    bumpSessionEpoch(USER);
    expect(await getSession()).toBeNull();
  });

  it("accepts a token re-issued after the bump", async () => {
    await createSession(base); // stale, epoch 0
    bumpSessionEpoch(USER);
    cookieState.token = await createSession(base); // stamped with the new epoch
    const s = await getSession();
    expect(s?.userId).toBe(USER);
  });

  it("survives several bumps (only the latest generation is valid)", async () => {
    bumpSessionEpoch(USER);
    bumpSessionEpoch(USER);
    const current = await createSession(base);
    bumpSessionEpoch(USER);
    cookieState.token = current;
    expect(await getSession()).toBeNull();
  });

  it("rejects a token whose user no longer exists (H4.6 account deletion)", async () => {
    // The subtle one: an epoch bump can't revoke the sessions of a deleted
    // account, because the row it would bump is gone. A first-generation token
    // carries se=0, so any `?? 0` fallback in currentEpoch() would make it match
    // and keep verifying — a deleted user staying logged in.
    cookieState.token = await createSession(base);
    expect((await getSession())?.userId).toBe(USER);
    run("DELETE FROM users WHERE id = ?", [USER]);
    expect(await getSession()).toBeNull();
  });

  it("treats a legacy token without an epoch claim as generation 0 (non-breaking rollout)", async () => {
    // Mirrors a JWT minted before S4 shipped — no `se` claim.
    const legacy = await new SignJWT({ ...base })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("dev-only-insecure-secret-rr2"));
    cookieState.token = legacy;
    expect((await getSession())?.userId).toBe(USER); // valid at epoch 0
    bumpSessionEpoch(USER);
    expect(await getSession()).toBeNull(); // …but revoked once the epoch moves
  });
});

const lastSeen = () =>
  get<{ last_seen_at: number }>("SELECT last_seen_at FROM users WHERE id = ?", [USER])!.last_seen_at;
const setLastSeen = (ts: number) => run("UPDATE users SET last_seen_at = ? WHERE id = ?", [ts, USER]);
const nowSec = () => Math.floor(Date.now() / 1000);

describe("last_seen_at activity stamp (H3.8 metric)", () => {
  it("stamps a stale last_seen_at on a valid session", async () => {
    setLastSeen(nowSec() - 3 * 86_400);
    cookieState.token = await createSession(base);
    expect(await getSession()).not.toBeNull();
    expect(lastSeen()).toBeGreaterThanOrEqual(nowSec() - 5);
  });

  it("writes at most once per UTC day (the hot-path guard)", async () => {
    // Earlier today: already stamped, so a second visit must NOT write again.
    // getSession() runs several times per render — without this guard every
    // authenticated read would become a write.
    const earlierToday = nowSec() - 60;
    setLastSeen(earlierToday);
    cookieState.token = await createSession(base);
    await getSession();
    await getSession();
    expect(lastSeen()).toBe(earlierToday);
  });

  it("stamps again once the day rolls over", async () => {
    setLastSeen(nowSec() - 86_400);
    cookieState.token = await createSession(base);
    await getSession();
    expect(lastSeen()).toBeGreaterThanOrEqual(nowSec() - 5);
  });

  it("does not stamp for a revoked token", async () => {
    // The stamp must sit AFTER epoch validation: a token someone logged out of
    // must not be able to report its owner as active.
    const stale = nowSec() - 3 * 86_400;
    cookieState.token = await createSession(base);
    bumpSessionEpoch(USER);
    setLastSeen(stale);
    expect(await getSession()).toBeNull();
    expect(lastSeen()).toBe(stale);
  });
});
