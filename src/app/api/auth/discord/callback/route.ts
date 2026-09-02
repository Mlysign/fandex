import type { NextRequest } from "next/server";
import {
  exchangeDiscordCode, getDiscordUserInfo, discordAvatarUrl, discordDisplayName,
} from "@/lib/sources/discord";
import { handleOAuthCallback } from "@/lib/oauthConnect";

// See the sibling route.ts for why this is dynamic: the redirect_uri handed to
// Discord's token endpoint is built from NEXT_PUBLIC_BASE_URL at request time,
// and it must be byte-identical to the one used to start the flow.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

  return handleOAuthCallback(req, {
    provider: "discord",
    connectedLabel: "discord",
    errorRedirect: "/?error=discord_failed",
    resolve: async (code) => {
      const tokens = await exchangeDiscordCode(code, base);
      const info = await getDiscordUserInfo(tokens.access_token);
      return {
        // The snowflake id, not the username: stable, unique, and unchanged when
        // somebody renames their account. Discord usernames ARE reusable after a
        // change, so keying on one would eventually hand an account to a stranger.
        providerUserId: info.id,
        displayName: discordDisplayName(info),
        avatarUrl: discordAvatarUrl(info),
        // Deliberately empty, exactly as Google's is. Discord is identity-only
        // here — nothing calls a Discord API after this request returns, so
        // storing a live credential (even encrypted at rest) would be a liability
        // buying nothing. The column stays populated-but-worthless rather than
        // becoming a token somebody later assumes they can use.
        accessToken: "",
        // ⚠️ Discord DOES return a refresh token, unlike Google under
        // `access_type: online`. Dropping it is the point: keeping a
        // self-renewing credential for an integration that makes no further
        // calls is the liability above with a longer life. If a future feature
        // needs the Discord API, take the token then and say so in the privacy
        // policy — do not quietly start storing it here.
        refreshToken: null,
        tokenExpiresAt: null,
      };
    },
  });
}
