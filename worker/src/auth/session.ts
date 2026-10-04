// Sessions: a signed JWT, carried as a bearer token by the app and as a cookie
// by a browser. A port of src/lib/session.ts with the same two properties:
//
//   • REVOCABLE. Every token is stamped with the user's session_epoch; a token
//     whose stamp is behind the row's is rejected. Logging out bumps the epoch,
//     which invalidates every outstanding token for that user at once.
//   • DEAD WITH THE ACCOUNT. A token whose user row is gone is not "epoch 0",
//     it is no session. A `?? 0` fallback there would keep every token of an
//     erased account verifying, because a first-generation token carries se=0.
//
// The token is SIGNED, not encrypted: anyone holding it can read it. Nothing
// goes in the payload but the user id, which provider minted it, and a display
// name. No email, no provider token, no provider user id.

import { SignJWT, jwtVerify } from "jose";
import { first, nowSeconds, run } from "../d1";
import type { Env } from "../env";

export interface SessionUser {
  userId: string;
  /** The provider this session was minted from: google | trakt | steam. */
  provider: string;
  displayName: string | null;
}

export interface Session {
  user: SessionUser;
  /** How the token arrived. A cookie session needs the CSRF check; a bearer one cannot be forged cross-site. */
  via: "bearer" | "cookie";
}

export const SESSION_COOKIE = "fx_session";
const SESSION_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

/**
 * No dev fallback, unlike the Next app. A Worker has no "local build" phase
 * that needs to import this without a secret, and a default here would be a
 * forgeable session the day the secret went missing.
 */
function secret(env: Env): Uint8Array {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
    throw new Error("JWT_SECRET is not set (or is too short to be a secret)");
  }
  return new TextEncoder().encode(env.JWT_SECRET);
}

async function sessionRow(db: D1Database, userId: string): Promise<{ epoch: number; lastSeenAt: number } | null> {
  const row = await first<{ session_epoch: number; last_seen_at: number }>(
    db,
    "SELECT session_epoch, last_seen_at FROM users WHERE id = ?",
    [userId],
  );
  if (!row) return null;
  return { epoch: row.session_epoch ?? 0, lastSeenAt: row.last_seen_at ?? 0 };
}

export async function createSession(env: Env, user: SessionUser): Promise<string> {
  const row = await sessionRow(env.DB, user.userId);
  if (!row) throw new Error("createSession: no such user");
  return new SignJWT({ uid: user.userId, p: user.provider, dn: user.displayName, se: row.epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret(env));
}

function tokenFrom(request: Request): { token: string; via: "bearer" | "cookie" } | null {
  const auth = request.headers.get("Authorization");
  if (auth && /^Bearer\s+\S/i.test(auth)) return { token: auth.replace(/^Bearer\s+/i, "").trim(), via: "bearer" };
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) {
        const value = part.slice(eq + 1).trim();
        if (value) return { token: value, via: "cookie" };
      }
    }
  }
  return null;
}

/**
 * The session a request carries, or null. Never throws for a bad token: a
 * forged, expired or revoked one is simply not a session.
 *
 * `defer` is ctx.waitUntil. The last-seen stamp rides on it so a metric can
 * neither slow a request down nor fail one.
 */
export async function readSession(
  env: Env,
  request: Request,
  defer?: (p: Promise<unknown>) => void,
): Promise<Session | null> {
  const found = tokenFrom(request);
  if (!found) return null;
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(found.token, secret(env), { algorithms: ["HS256"] }));
  } catch {
    return null;
  }
  const userId = typeof payload.uid === "string" ? payload.uid : null;
  if (!userId) return null;

  const row = await sessionRow(env.DB, userId);
  if (row === null) return null;
  if (((payload.se as number | undefined) ?? 0) !== row.epoch) return null;

  // Only after the token is fully validated: a revoked or forged token must not
  // be able to stamp activity on someone else's account. Once per UTC day, so
  // an authenticated read is not also a row write.
  const now = nowSeconds();
  if (Math.floor(row.lastSeenAt / SECONDS_PER_DAY) !== Math.floor(now / SECONDS_PER_DAY)) {
    const touch = run(env.DB, "UPDATE users SET last_seen_at = ? WHERE id = ?", [now, userId]).catch(() => undefined);
    if (defer) defer(touch); else await touch;
  }

  return {
    user: {
      userId,
      provider: typeof payload.p === "string" ? payload.p : "unknown",
      displayName: typeof payload.dn === "string" ? payload.dn : null,
    },
    via: found.via,
  };
}

/** Invalidate every outstanding token for this user. */
export async function bumpSessionEpoch(db: D1Database, userId: string): Promise<void> {
  await run(db, "UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?", [userId]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * SECONDS_PER_DAY}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ── The pending-merge proof ──────────────────────────────────────────────────
//
// When a sign-in proves the caller also owns a SECOND account and the two hold
// overlapping titles, the merge needs a decision from the person. This token is
// what carries the proof across that pause: it says "the holder demonstrated
// control of both accounts a moment ago". Short-lived, and audience-scoped so
// it can never be presented as a session.

const MERGE_AUDIENCE = "fandex:merge";

export interface PendingMerge {
  from: string;
  into: string;
  provider: string;
}

export async function signPendingMerge(env: Env, m: PendingMerge): Promise<string> {
  return new SignJWT({ from: m.from, into: m.into, p: m.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(MERGE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret(env));
}

export async function verifyPendingMerge(env: Env, token: string): Promise<PendingMerge | null> {
  try {
    const { payload } = await jwtVerify(token, secret(env), { algorithms: ["HS256"], audience: MERGE_AUDIENCE });
    if (typeof payload.from !== "string" || typeof payload.into !== "string" || typeof payload.p !== "string") return null;
    return { from: payload.from, into: payload.into, provider: payload.p };
  } catch {
    return null;
  }
}
