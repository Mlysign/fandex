import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { get, run } from "@/lib/db";
import type { SessionUser } from "@/types";

// Sessions are signed with JWT_SECRET. Refuse to run in production without it
// rather than silently falling back to a source-controlled default (which would
// make every session forgeable — anyone could mint a JWT for any userId). A
// clearly-insecure fallback is kept ONLY for local dev/test so `npm run dev` and
// the test suite work without a configured secret.
//
// Resolved LAZILY (on first sign/verify), not at module load: `next build`
// evaluates route modules with NODE_ENV=production and no JWT_SECRET, so an eager
// check would (wrongly) fail the build. Boot-time fail-fast for a real server is
// handled by instrumentation.ts → validateEnv(); this just guards actual use.
let _secret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const secret = process.env.JWT_SECRET;
  if (secret) return (_secret = new TextEncoder().encode(secret));
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is required in production. Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }
  return (_secret = new TextEncoder().encode("dev-only-insecure-secret-rr2"));
}

export const SESSION_COOKIE = "rr2_session";

// Session revocation (S4). Every token is stamped with the user's session_epoch
// at sign time; a token whose stamp is behind the user's current epoch is
// rejected. Bumping the epoch (logout / disconnect) therefore invalidates every
// outstanding token for that user server-side — the 30-day cookie is no longer
// un-revocable. Legacy tokens carry no epoch (read as 0) and stay valid until
// the first bump, so the rollout is non-breaking.
// Returns null when the user row is GONE, which is not the same as "epoch 0".
// After H4.6 account deletion there is nothing to bump — the row a bump would
// have written to no longer exists — so a `?? 0` fallback here would keep every
// outstanding token of a deleted account verifying happily (a first-generation
// token carries se=0 and would match the fallback exactly). getSession() treats
// null as "no valid session", which is what erasure has to mean.
function userSessionRow(userId: string): { epoch: number; lastSeenAt: number } | null {
  const row = get<{ session_epoch: number; last_seen_at: number }>(
    "SELECT session_epoch, last_seen_at FROM users WHERE id = ?",
    [userId]
  );
  if (!row) return null;
  return { epoch: row.session_epoch ?? 0, lastSeenAt: row.last_seen_at ?? 0 };
}

const SECONDS_PER_DAY = 86_400;

// H3.8 metric plumbing. `users.last_seen_at` used to be written ONLY by the RAWG
// and Steam auth callbacks, so it never moved for a TMDB/Trakt user and never
// moved at all for an ordinary revisit on an existing 30-day cookie — it was a
// false friend that undercounted activity badly. Stamping it here covers every
// authenticated request instead, because this is the one funnel they all pass
// through (requireSession/withUser both land on getSession).
//
// Rate-limited to one write per user per UTC day: getSession() runs on a hot
// path, often several times per render, and an unconditional UPDATE would turn
// every authenticated read into a write. The freshness check itself is free —
// the epoch lookup already reads the row, so this rides along on that SELECT
// rather than adding one.
//
// Deliberately best-effort: a metric must never be able to fail a login, so a
// write error is swallowed. Worst case we lose one day's stamp for one user.
function touchLastSeen(userId: string, lastSeenAt: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (Math.floor(lastSeenAt / SECONDS_PER_DAY) === Math.floor(now / SECONDS_PER_DAY)) return;
  try {
    run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now, userId]);
  } catch {
    // Non-fatal by design — see above.
  }
}

export function bumpSessionEpoch(userId: string): void {
  run("UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?", [userId]);
}

export async function createSession(user: SessionUser): Promise<string> {
  // At sign time the users row always exists (it was just created/looked up by
  // the auth route), so the ?? 0 is only a type-level fallback.
  return new SignJWT({ ...user, se: userSessionRow(user.userId)?.epoch ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .setIssuedAt()
    .sign(getSecret());
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    const user = payload as unknown as SessionUser & { se?: number };
    // Reject tokens revoked by an epoch bump since they were issued — and tokens
    // belonging to a user who no longer exists (deleted account, see above).
    const row = userSessionRow(user.userId);
    if (row === null) return null;
    if ((payload.se as number | undefined ?? 0) !== row.epoch) return null;
    // Only after the token is fully validated — a revoked or forged token must
    // not be able to stamp activity on someone else's account.
    touchLastSeen(user.userId, row.lastSeenAt);
    return user;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("Unauthorized");
  return s;
}

export function setSessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  };
}
