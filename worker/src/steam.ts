// A signed-in person's Steam library and wishlist, read from the Steam Web API.
//
//   GET /v1/me/steam   → {"library":[{appid,playtime,lastPlayed}],"wishlist":[{appid,addedAt}]}
//
// The Worker holds the Steam key; a Web API key may never ship in the app
// (docs/app-plan.md). The app does everything else on the device, as it does
// for Trakt (mobile/src/lib/steamSync.ts): it maps each app id to a catalog
// title through /v1/lookup and /v1/resolve, and writes the result as
// explicit upserts and deletes.
//
// ⚠️ THE PRUNE INVARIANT reaches back to here. What this answers decides what
// the device deletes, so the answer is whole or it is an error: either Steam
// call failing is a 502, never half an answer. And a private profile is not an
// empty one: Steam answers a private library with no `games` at all, which
// would read as "this person owns nothing" and delete every Steam row. It is a
// 409 `steam-private` instead, and the device changes nothing.
//
// Steam's terms (PLATFORMS.md): 100,000 calls a day, commercial use allowed,
// attribution required, and the privacy policy names Steam and what is read.

import { httpFetch } from "@/lib/http";
import { capFrom, spend } from "./budget";
import { first } from "./d1";
import type { Env } from "./env";
import { allow, error, json } from "./http";

const STEAM_API = "https://api.steampowered.com";
/** A SteamID64. Steam's own ids are 17 digits. */
const STEAM_ID = /^\d{17}$/;
/** Two Steam calls a sync. A day's syncs for every account fit many times over in Steam's 100,000. */
const DEFAULT_DAILY_STEAM_CAP = 2000;
const STEAM_BUDGET_MS = 15_000;

export interface SteamLibraryEntry { appid: number; playtime: number; lastPlayed: number | null }
export interface SteamWishlistEntry { appid: number; addedAt: number | null }

interface SteamCtx { env: Env; request: Request }

export async function steamLibrary(c: SteamCtx, userId: string): Promise<Response> {
  const { env } = c;
  if (!env.STEAM_API_KEY) return error(503, "not-configured", "Steam sync is not switched on.");
  const identity = await first<{ provider_user_id: string }>(
    env.DB,
    "SELECT provider_user_id FROM user_identities WHERE user_id = ? AND provider = 'steam'",
    [userId],
  );
  if (!identity) return error(404, "not-connected", "This account has no Steam connected.");
  const steamId = identity.provider_user_id;
  if (!STEAM_ID.test(steamId)) return error(409, "steam-id-invalid", "The Steam id on this account is not one Steam knows.");

  if (!(await allow(env.RL_RESOLVE, `steam:${userId}`))) return error(429, "rate-limited");
  if (!(await spend(env.DB, "steam", capFrom(env.DAILY_STEAM_CAP, DEFAULT_DAILY_STEAM_CAP), 2))) {
    return error(503, "budget-exhausted", "Steam cannot be asked again until tomorrow (UTC).");
  }

  let owned: Response;
  let wished: Response;
  try {
    const key = encodeURIComponent(env.STEAM_API_KEY);
    [owned, wished] = await Promise.all([
      httpFetch(`${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_played_free_games=1&format=json`,
        { appScopedAuth: true, budgetMs: STEAM_BUDGET_MS }),
      httpFetch(`${STEAM_API}/IWishlistService/GetWishlist/v1/?key=${key}&steamid=${steamId}`,
        { appScopedAuth: true, budgetMs: STEAM_BUDGET_MS }),
    ]);
  } catch (e) {
    console.warn("steam_fetch_failed", { error: e instanceof Error ? e.message : String(e) });
    return error(502, "provider-unavailable");
  }
  if (!owned.ok || !wished.ok) {
    console.warn("steam_fetch_failed", { owned: owned.status, wishlist: wished.status });
    return error(502, "provider-unavailable");
  }
  const ownedBody = (await owned.json()) as { response?: { game_count?: number; games?: any[] } };
  const wishedBody = (await wished.json()) as { response?: { items?: any[] } };

  const games = ownedBody?.response?.games;
  // See the header: no `games` is a private profile (or Steam not saying),
  // never "owns nothing". A public profile with no games still says game_count 0.
  if (!Array.isArray(games)) {
    if (ownedBody?.response?.game_count === 0) return json({ library: [], wishlist: wishlistOf(wishedBody) }, 200, PRIVATE);
    return error(409, "steam-private", "Steam did not share this library. Its game details have to be public for Fandex to read them.");
  }
  const library: SteamLibraryEntry[] = games
    .filter((g) => Number.isInteger(g?.appid) && g.appid > 0)
    .map((g) => ({
      appid: g.appid,
      playtime: Number.isFinite(g.playtime_forever) ? g.playtime_forever : 0,
      lastPlayed: Number.isFinite(g.rtime_last_played) && g.rtime_last_played > 0 ? g.rtime_last_played : null,
    }));
  return json({ library, wishlist: wishlistOf(wishedBody) }, 200, PRIVATE);
}

/** An empty or private wishlist both answer `{}`: read as empty, which the device's guard bounds (steamSync.ts). */
function wishlistOf(body: { response?: { items?: any[] } }): SteamWishlistEntry[] {
  const items = Array.isArray(body?.response?.items) ? body.response.items : [];
  return items
    .filter((i) => Number.isInteger(i?.appid) && i.appid > 0)
    .map((i) => ({ appid: i.appid, addedAt: Number.isFinite(i.date_added) && i.date_added > 0 ? i.date_added : null }));
}

const PRIVATE = { "Cache-Control": "private, no-store" };
