import { NextRequest, NextResponse } from "next/server";
import { getLetterboxdAuthUrl } from "@/lib/sources/letterboxd";
import { createOAuthNonce, setOAuthStateCookie, setOAuthReturnCookie } from "@/lib/oauthState";

export async function GET(req: NextRequest) {
  // `state` is a pure CSRF nonce; the link target comes from the session on
  // callback, never from client-supplied state (see handleOAuthCallback).
  const nonce = createOAuthNonce();
  const res = NextResponse.redirect(getLetterboxdAuthUrl(nonce));
  setOAuthStateCookie(res, nonce);
  // H2c: post-login app path (login-with-intent), same-origin paths only.
  setOAuthReturnCookie(res, req.nextUrl.searchParams.get("returnTo"));
  return res;
}
