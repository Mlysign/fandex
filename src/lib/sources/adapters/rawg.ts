import { get } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import {
  getRawgUserToPlay, getRawgUserToPlayAuth, getRawgUserPlayed,
  addToRawgToPlay, removeFromRawgToPlay, markRawgBeaten, rateRawgGame,
} from "../rawg";
import { METADATA } from "@/lib/metadata/registry";

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

function toPulled(g: any): PulledItem {
  return { sourceId: String(g.id), title: g.name, releaseDate: g.released ?? null, type: "game", rawData: g };
}

// RAWG adapter. All RAWG-specific quirks live HERE and nowhere else:
//  • the personal rating is the top-level `user_rating` (1-5), NOT user_game.rating
//  • writing a rating goes through /api/reviews (the games endpoint drops it)
//  • app 0-10 ↔ RAWG 1/3/4/5 scale conversion (handled inside rawg.ts)
export const rawgSource: MediaSource = {
  ...CATALOG.rawg,

  async context(userId) {
    const identity = get<any>(
      "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'rawg'",
      [userId]
    );
    if (!identity) return null;
    const metadata = identity.metadata ? safeParse(identity.metadata) : {};
    const slug = metadata.slug ?? identity.display_name ?? identity.provider_user_id;
    // RAWG tokens are long-lived — no refresh step needed.
    return { userId, identity, token: identity.access_token ?? null, slug };
  },

  async pullWishlist(ctx) {
    const games = ctx.token
      ? await getRawgUserToPlayAuth(ctx.token, ctx.slug!)
      : await getRawgUserToPlay(ctx.slug!);
    return games.map(toPulled);
  },

  async resolveSourceId(_ctx, _type, ids) {
    return ids.rawg != null ? String(ids.rawg) : null;
  },

  async pushWishlist(ctx, sourceId, _type, add) {
    if (!ctx.token) return;
    const id = parseInt(sourceId);
    if (add) await addToRawgToPlay(ctx.token, id);
    else await removeFromRawgToPlay(ctx.token, id);
  },

  async pullLibrary(ctx) {
    const games = await getRawgUserPlayed(ctx.slug!, ctx.token ?? undefined);
    return games.map((g: any) => ({
      ...toPulled(g),
      status: g.user_game?.status === "owned" ? "owned" : "played",
      // user_rating is RAWG's 1-5 personal score → app 2-10. Null when unrated.
      rating: typeof g.user_rating === "number" && g.user_rating > 0 ? g.user_rating * 2 : null,
      reviewedAt: null,
    }));
  },

  // rateRawgGame already ensures the game is in the library (beaten) and records
  // the score via /api/reviews — so this both rates and marks played.
  async pushRating(ctx, sourceId, _type, appRating) {
    if (!ctx.token) return;
    await rateRawgGame(ctx.token, parseInt(sourceId), appRating);
  },

  async pushStatus(ctx, sourceId) {
    if (!ctx.token) return;
    await markRawgBeaten(ctx.token, parseInt(sourceId));
  },

  // Cross-enrich a RAWG game with its Steam link by exact-name match. Only for
  // wishlist pulls — owned/played libraries can be huge, so we skip the (slow)
  // per-item Steam search there, matching the legacy sync.
  async enrich(item, mediaItemId, kind) {
    if (kind !== "wishlist") return;
    try {
      const link = await METADATA.steam?.searchByTitle?.(item.title, "game");
      if (link) {
        linkSourceToItem(mediaItemId, {
          source: "steam", sourceId: link.sourceId, type: "game",
          title: link.title, releaseDate: link.releaseDate, rawData: link.rawData,
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch { /* enrichment optional */ }
  },
};
