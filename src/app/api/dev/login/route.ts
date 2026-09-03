import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/session";
import type { SessionUser, Source } from "@/types";
import { SMOKETEST_USER_ID } from "@/lib/smoketestAccount";

// Dev-only login shortcut. Mints a REAL session for a configured users.id so a
// local browser — or an unattended agent session driving the preview tools —
// can reach the logged-in surfaces. /library, /wishlist, /insights and the
// item-detail personal block all redirect anonymous visitors away, so without
// this the only way to see them is a full OAuth round-trip through a real
// provider account, which an automated session cannot do.
//
// THREE independent gates, every one fail-closed:
//   1. NODE_ENV !== "production" — 404s on Railway, unconditionally. This is
//      the gate that matters; the other two are depth.
//   2. DEV_LOGIN_USER_ID is set — unset (the default, and what .env.example
//      ships) means the route does not exist.
//   3. The host is loopback — not reachable from another machine on the LAN.
// A miss on any gate is a 404, not a 403: devAdmin.ts's convention is that a
// gated route's existence isn't something a caller needs to learn about.
//
// GET rather than POST on purpose — this exists to be typed into a browser bar
// or driven by a headless preview, and it is unreachable anywhere a CSRF-shaped
// concern could apply. Do NOT relax gate 1 to make this work against a deployed
// instance; that would turn it into a total authentication bypass.
//
// Session revocation still applies normally: the token is stamped with the
// user's current session_epoch by createSession(), so logging out (or any
// disconnect) invalidates it exactly like a real one.

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

function isLoopback(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return notFound();
  if (!isLoopback(req)) return notFound();

  // ── ?as=smoketest — the throwaway account (2026-09-03) ────────────────────
  //
  // Nils: "can you create a new user account for you to use when running
  // smoketests? this would allow you to really mess with the library."
  //
  // Without an argument this route still signs in as DEV_LOGIN_USER_ID, which is
  // HIS account, where rating a movie is a real write-back to Trakt and TMDB
  // that then has to be undone by hand. That cost is why destructive checks were
  // rare, and why "you can no longer rate games" survived a whole session of
  // verification: nobody rated a game.
  //
  // Note what does NOT change: both gates above still apply, and the account
  // only exists if `scripts/smoketest-account.mjs` created it. No env var, so
  // nothing has to be appended to `.env` — the file whose missing trailing
  // newline concatenated a secret onto DISCORD_CLIENT_SECRET.
  const smoketest = req.nextUrl.searchParams.get("as") === "smoketest";
  const userId = smoketest ? SMOKETEST_USER_ID : process.env.DEV_LOGIN_USER_ID?.trim();
  if (!userId) return notFound();

  // The session's identity fields have to describe a real identity row: the
  // rest of the app reads session.provider (e.g. to decide which adapters can
  // write) and would misbehave on a synthesized one.
  const identity = get<{ id: string; provider: string; display_name: string | null }>(
    `SELECT id, provider, display_name FROM user_identities
      WHERE user_id = ? ORDER BY created_at LIMIT 1`,
    [userId]
  );
  if (!identity) return notFound();   // no identity row means the account was never created

  const user: SessionUser = {
    userId,
    identityId: identity.id,
    provider: identity.provider as Source,
    displayName: identity.display_name,
  };

  const token = await createSession(user);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(setSessionCookie(token));
  return res;
}
