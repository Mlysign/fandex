import { NextRequest } from "next/server";
import { exchangeTraktCode, getTraktUserInfo } from "@/lib/sources/trakt";
import { handleOAuthCallback } from "@/lib/oauthConnect";

export async function GET(req: NextRequest) {
  return handleOAuthCallback(req, {
    provider: "trakt",
    connectedLabel: "trakt",
    errorRedirect: "/login?error=trakt_failed",
    resolve: async (code) => {
      const tokens = await exchangeTraktCode(code);
      const userInfo = await getTraktUserInfo(tokens.access_token);
      return {
        providerUserId: userInfo.username,
        displayName: userInfo.name ?? userInfo.username,
        avatarUrl: userInfo.images?.avatar?.full ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
      };
    },
  });
}
