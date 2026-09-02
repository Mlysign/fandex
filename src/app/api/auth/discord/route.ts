import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDiscordAuthUrl, discordConfigured } from "@/lib/sources/discord";
import { createOAuthNonce, setOAuthStateCookie, setOAuthReturnCookie } from "@/lib/oauthState";

// Start the Discord sign-in flow. Mirrors the Google route exactly: mint a CSRF
// nonce, plant it in an httpOnly cookie, carry the same value in `state`.
//
// force-dynamic because the redirect URL is built from NEXT_PUBLIC_BASE_URL at
// request time. Without it Next prerenders route handlers at BUILD time, and
// Railway's build-phase env differs from its runtime env — the wrong origin gets
// baked in permanently, status 200 either way. Verify in `npm run build`'s route
// table: this must read `ƒ (Dynamic)`, never `○ (Static)`.
// → memory: railway-build-vs-runtime-env
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Not configured is a 404, not a broken redirect: without both halves of the
  // credential the flow can only fail at the callback, after the user has
  // already been sent to Discord and approved something.
  if (!discordConfigured()) {
    return NextResponse.json({ error: "Discord sign-in is not configured" }, { status: 404 });
  }

  // The configured public origin, not req.nextUrl.origin — behind Railway's
  // proxy that resolves to the internal bind host (0.0.0.0:8080), and Discord
  // matches the redirect_uri EXACTLY against the URIs registered in the portal.
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

  const nonce = createOAuthNonce();
  const res = NextResponse.redirect(getDiscordAuthUrl(nonce, base));
  setOAuthStateCookie(res, nonce);
  // H2c: where to land after a fresh login (login-with-intent). Only a safe
  // same-origin path is honoured; anything else sets nothing (see oauthState).
  setOAuthReturnCookie(res, req.nextUrl.searchParams.get("returnTo"));
  return res;
}
