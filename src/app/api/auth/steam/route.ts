import { NextResponse } from "next/server";
import { getSteamLoginUrl } from "@/lib/sources/steam";
import { createOAuthNonce, setOAuthStateCookie } from "@/lib/oauthState";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:3000`;
  // CSRF (S1): carry a nonce (not the userId) in the return URL and verify it
  // against an httpOnly cookie on callback. The link target is derived from the
  // session there — the old `?link=<userId>` trusted a client-supplied id and
  // let anyone force-link a Steam account onto an arbitrary user.
  const nonce = createOAuthNonce();
  const returnTo = `${baseUrl}/api/auth/steam/callback?state=${nonce}`;
  const res = NextResponse.redirect(getSteamLoginUrl(returnTo));
  setOAuthStateCookie(res, nonce);
  return res;
}
