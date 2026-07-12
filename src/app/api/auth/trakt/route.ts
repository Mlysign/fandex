import { NextResponse } from "next/server";
import { getTraktAuthUrl } from "@/lib/sources/trakt";
import { createOAuthNonce, setOAuthStateCookie } from "@/lib/oauthState";

export async function GET() {
  // `state` is a pure CSRF nonce (verified against an httpOnly cookie on
  // callback). The link target is derived from the session at callback time, so
  // it is deliberately NOT encoded here — a client-supplied userId can't be trusted.
  const nonce = createOAuthNonce();
  const res = NextResponse.redirect(getTraktAuthUrl(nonce));
  setOAuthStateCookie(res, nonce);
  return res;
}
