import { NextRequest, NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "crypto";

// CSRF protection for the OAuth connect/link flows (S1). Every connect route
// mints a random nonce, stores it in a short-lived httpOnly cookie, and embeds
// the SAME value in the provider `state` (or Steam/TMDB return handle). On
// callback we require the value echoed back by the provider to match the
// cookie — proving the redirect was initiated by THIS browser, not forged by an
// attacker to silently link their provider account to (or log them into) a
// victim's session.
//
// The *link target* is derived separately from the session cookie, never from
// client-supplied state — see handleOAuthCallback / the callback routes.
const STATE_COOKIE = "rr2_oauth_state";
const STATE_MAX_AGE = 600; // 10 min — enough to complete a provider approval

// Mint a fresh, URL-safe nonce to carry through a single OAuth flow.
export function createOAuthNonce(): string {
  return randomBytes(32).toString("base64url");
}

// Attach the nonce to `res` as a short-lived, single-use httpOnly cookie.
// sameSite=lax so it survives the top-level GET redirect back from the provider.
export function setOAuthStateCookie(res: NextResponse, nonce: string): void {
  res.cookies.set({
    name: STATE_COOKIE,
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
}

// Constant-time compare the value echoed back by the provider against the
// cookie planted at the start of the flow. Missing either side → reject.
export function verifyOAuthState(req: NextRequest, received: string | null): boolean {
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? null;
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Clear the single-use state cookie. Call on every callback exit (success or
// failure) so a nonce is never replayable.
export function clearOAuthState(res: NextResponse): void {
  res.cookies.set({ name: STATE_COOKIE, value: "", path: "/", maxAge: 0 });
}
