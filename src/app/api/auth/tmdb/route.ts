import { NextRequest, NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { createTmdbRequestToken } from "@/lib/sources/tmdb";
import { setOAuthStateCookie, setOAuthReturnCookie } from "@/lib/oauthState";

// Start the TMDB connect flow: create a request token and send the user to TMDB
// to approve, with redirect_to pointing back at our callback. The user's existing
// session cookie (if any) is read in the callback for account linking.
export async function GET(req: NextRequest) {
  // Use the configured public origin, not req.nextUrl.origin (which is the
  // internal 0.0.0.0:8080 behind Railway's proxy) so TMDB redirects back correctly.
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
  try {
    const token = await createTmdbRequestToken();
    const callback = `${base}/api/auth/tmdb/callback`;
    const url = `https://www.themoviedb.org/authenticate/${token}?redirect_to=${encodeURIComponent(callback)}`;
    const res = NextResponse.redirect(url);
    // CSRF (S1): TMDB has no `state` param, and it appends its own query to
    // redirect_to, so we can't round-trip a nonce there. Instead bind THIS
    // browser to this single-use request_token — the callback rejects any
    // request_token that doesn't match this cookie.
    setOAuthStateCookie(res, token);
    // H2c: post-login app path (login-with-intent), same-origin paths only.
    setOAuthReturnCookie(res, req.nextUrl.searchParams.get("returnTo"));
    return res;
  } catch (e) {
    log.error("tmdb_auth_error", { ...errorFields(e) });
    return NextResponse.redirect(new URL("/settings?error=tmdb_failed", base));
  }
}
