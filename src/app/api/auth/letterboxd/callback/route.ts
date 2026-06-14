import { NextRequest } from "next/server";
import { exchangeLetterboxdCode, getLetterboxdMe } from "@/lib/sources/letterboxd";
import { handleOAuthCallback } from "@/lib/oauthConnect";

export async function GET(req: NextRequest) {
  return handleOAuthCallback(req, {
    provider: "letterboxd",
    connectedLabel: "Letterboxd",
    errorRedirect: "/settings?error=letterboxd_failed",
    resolve: async (code) => {
      const tokens = await exchangeLetterboxdCode(code);
      const me = await getLetterboxdMe(tokens.access_token);
      return {
        providerUserId: me.id,
        displayName: me.displayName ?? me.username,
        avatarUrl: me.avatar?.sizes?.[0]?.url ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: null,
      };
    },
  });
}
