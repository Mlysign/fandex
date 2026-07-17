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

// H2c: where to send the user AFTER a fresh login, so login-with-intent lands
// back on the item page they started from instead of the default /dashboard. It
// rides its OWN short-lived httpOnly cookie (not the provider `state`, which is a
// security nonce), set by the connect route and read by the callback. Same
// browser-binding property as the nonce: an attacker can't set our cookie
// cross-site, and isSafeReturnPath below caps the blast radius to a same-origin
// path regardless.
const RETURN_COOKIE = "rr2_oauth_return";

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

// ── H2c return-path cookie ───────────────────────────────────────────────────

// Open-redirect guard. Accept ONLY a same-origin absolute path: it must start
// with a single "/", so no scheme ("https://…", "javascript:"), no protocol-
// relative ("//evil.com"), and no backslash trick ("/\evil.com", which some
// browsers normalize toward "//"). Everything the callback trusts as a redirect
// target flows through here.
export function isSafeReturnPath(p: string | null | undefined): p is string {
  return (
    typeof p === "string" &&
    p.startsWith("/") &&
    !p.startsWith("//") &&
    !p.startsWith("/\\")
  );
}

// Stash the post-login return path for the flow, but only if it's a safe
// same-origin path — an unsafe or absent value simply sets nothing, so the
// callback falls back to its default redirect.
export function setOAuthReturnCookie(res: NextResponse, path: string | null | undefined): void {
  if (!isSafeReturnPath(path)) return;
  res.cookies.set({
    name: RETURN_COOKIE,
    value: path,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
  });
}

// Read the return path planted at the start of the flow. Re-validated on the way
// out (defense in depth — the cookie can't normally hold an unsafe value, but the
// redirect target must never be taken on trust).
export function readOAuthReturn(req: NextRequest): string | null {
  const v = req.cookies.get(RETURN_COOKIE)?.value ?? null;
  return isSafeReturnPath(v) ? v : null;
}

// Clear the single-use return cookie. Call on every callback exit alongside
// clearOAuthState.
export function clearOAuthReturn(res: NextResponse): void {
  res.cookies.set({ name: RETURN_COOKIE, value: "", path: "/", maxAge: 0 });
}
