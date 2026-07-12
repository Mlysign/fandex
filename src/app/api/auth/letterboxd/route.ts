import { NextResponse } from "next/server";
import { getLetterboxdAuthUrl } from "@/lib/sources/letterboxd";
import { createOAuthNonce, setOAuthStateCookie } from "@/lib/oauthState";

export async function GET() {
  // `state` is a pure CSRF nonce; the link target comes from the session on
  // callback, never from client-supplied state (see handleOAuthCallback).
  const nonce = createOAuthNonce();
  const res = NextResponse.redirect(getLetterboxdAuthUrl(nonce));
  setOAuthStateCookie(res, nonce);
  return res;
}
