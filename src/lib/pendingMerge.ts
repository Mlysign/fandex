import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";

// The parked "these two accounts may be joined" proof (2026-09-02).
//
// A merge with overlapping titles needs the user to choose a winner, and that
// choice happens on a FORM — so the decision arrives on a later request than the
// OAuth callback that discovered the overlap. Something has to carry, across that
// gap, the fact that the person demonstrably controlled BOTH accounts.
//
// ⚠️ WHY A SIGNED TOKEN AND NOT A `?from=…&to=…` QUERY. Two account ids in a URL
// are two ids anyone can type. The whole authorisation for a merge is "you just
// proved, via a live OAuth round-trip, that you hold the identity owning the
// other account" — a claim that exists for a moment inside the callback and
// nowhere else. Signing it is what makes it survive the redirect without becoming
// forgeable. Same reasoning as `oauthState`'s nonce, one step further along.
//
// ⚠️ THE TOKEN IS NOT SUFFICIENT ON ITS OWN. The execute route ALSO checks that
// the current session is the `from` account. A token is a capability, and a
// capability that outlives the session it was minted for would let a shared or
// stale browser fold somebody else's account away. Both halves, every time.

const COOKIE = "rr2_pending_merge";
/** Long enough to read the form and decide, short enough to be nearly useless if leaked. */
const MAX_AGE = 15 * 60;

export interface PendingMerge {
  /** The account being merged away — always the one currently signed in. */
  from: string;
  /** The account that survives: the one owning the provider that was connected. */
  into: string;
  /** The provider that was being connected, for the form's wording. */
  provider: string;
}

let _secret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const secret = process.env.JWT_SECRET;
  if (secret) return (_secret = new TextEncoder().encode(secret));
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }
  // Dev only, and deliberately the same shape session.ts uses.
  return (_secret = new TextEncoder().encode("dev-insecure-secret-change-me"));
}

export async function signPendingMerge(p: PendingMerge): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .setIssuedAt()
    .sign(getSecret());
}

export function setPendingMergeCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function readPendingMerge(req: NextRequest): Promise<PendingMerge | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const { from, into, provider } = payload as unknown as PendingMerge;
    if (!from || !into || from === into) return null;
    return { from, into, provider: provider ?? "" };
  } catch {
    // Expired or tampered. Indistinguishable on purpose: both mean "no pending
    // merge", and telling them apart would only help someone probing.
    return null;
  }
}

export function clearPendingMerge(res: NextResponse): void {
  res.cookies.set({ name: COOKIE, value: "", path: "/", maxAge: 0 });
}
