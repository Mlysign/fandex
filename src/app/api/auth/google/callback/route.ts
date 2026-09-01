import type { NextRequest } from "next/server";
import { exchangeGoogleCode, getGoogleUserInfo } from "@/lib/sources/google";
import { handleOAuthCallback } from "@/lib/oauthConnect";

// See the sibling route.ts for why this is dynamic: the redirect_uri handed to
// Google's token endpoint is built from NEXT_PUBLIC_BASE_URL at request time,
// and it must be byte-identical to the one used to start the flow.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

  return handleOAuthCallback(req, {
    provider: "google",
    connectedLabel: "google",
    errorRedirect: "/?error=google_failed",
    resolve: async (code) => {
      const tokens = await exchangeGoogleCode(code, base);
      const info = await getGoogleUserInfo(tokens.access_token);
      return {
        // The `sub` claim, not the email: stable, unique per app, and it does
        // not change if the person renames their account.
        providerUserId: info.sub,
        displayName: info.name ?? info.given_name ?? null,
        avatarUrl: info.picture ?? null,
        // Deliberately empty. Google is identity-only here — nothing calls a
        // Google API after this request returns, so storing a live credential
        // (even encrypted at rest) would be a liability buying nothing. The
        // column stays populated-but-worthless rather than becoming a token
        // somebody later assumes they can use.
        accessToken: "",
        // `access_type: online`, so Google issues none.
        refreshToken: null,
        tokenExpiresAt: null,
      };
    },
  });
}
