import { NextRequest, NextResponse } from "next/server";
import { getTraktAuthUrl } from "@/lib/sources/trakt";
import { createOAuthNonce, setOAuthStateCookie, setOAuthReturnCookie } from "@/lib/oauthState";

export async function GET(req: NextRequest) {
  // `state` is a pure CSRF nonce (verified against an httpOnly cookie on
  // callback). The link target is derived from the session at callback time, so
  // it is deliberately NOT encoded here — a client-supplied userId can't be trusted.
  const nonce = createOAuthNonce();
  const res = NextResponse.redirect(getTraktAuthUrl(nonce));
  setOAuthStateCookie(res, nonce);
  // H2c: remember where to land after a fresh login (login-with-intent). Only a
  // safe same-origin path is honored; anything else is ignored (see oauthState).
  setOAuthReturnCookie(res, req.nextUrl.searchParams.get("returnTo"));
  return res;
}
