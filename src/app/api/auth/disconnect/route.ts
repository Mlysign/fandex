import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { run, query } from "@/lib/db";
import { createSession, setSessionCookie, bumpSessionEpoch } from "@/lib/session";
import { disconnectSource } from "@/lib/matcher";
import { Source } from "@/types";
import { parseJsonBody } from "@/lib/validate";
import { DisconnectPostSchema } from "@/lib/schemas";

export const POST = withUser(async (req: NextRequest, session) => {
  const { provider } = await parseJsonBody(req, DisconnectPostSchema);

  // Must have at least one other identity remaining
  const allIdentities = query<{ id: string; provider: string; display_name: string | null }>(
    "SELECT id, provider, display_name FROM user_identities WHERE user_id = ?",
    [session.userId]
  );
  if (allIdentities.length <= 1) {
    return NextResponse.json(
      { error: "Cannot disconnect your only login method" },
      { status: 400 }
    );
  }

  // Remove the identity
  run(
    "DELETE FROM user_identities WHERE user_id = ? AND provider = ?",
    [session.userId, provider]
  );

  // Remove this provider's wishlist + library state (keep media_items and
  // media_links – they may be shared with other sources). Goes through
  // user_item_state (the truth table) via disconnectSource rather than raw SQL
  // against user_watchlist/user_library, so a disconnect can't leave orphaned
  // truth rows the way a direct cache DELETE/UPDATE did (see 6b4756c).
  disconnectSource(session.userId, provider as Source);

  // Revoke every outstanding token for this user (S4) — in particular any session
  // minted from the identity we just removed. Then re-issue a fresh cookie for
  // THIS device against a still-connected identity, so disconnecting a provider
  // doesn't log the acting user out (but any OTHER devices are signed out).
  bumpSessionEpoch(session.userId);
  const remaining = allIdentities.find((i) => i.provider !== provider) ?? allIdentities[0];
  const token = await createSession({
    userId: session.userId,
    identityId: remaining.id,
    provider: remaining.provider as Source,
    displayName: remaining.display_name,
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(setSessionCookie(token));
  return res;
});
