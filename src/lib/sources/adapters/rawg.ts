import { get } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import type { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import { crossLinkGame } from "../crossLink";
import {
  getRawgUserToPlay, getRawgUserToPlayAuth, getRawgUserPlayed,
  addToRawgToPlay, removeFromRawgToPlay, markRawgBeaten, rateRawgGame, deleteRawgReview,
} from "../rawg";
import { METADATA } from "@/lib/metadata/registry";
import { decryptNullable } from "@/lib/crypto";

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
    return { userId, identity, token: decryptNullable(identity.access_token), slug };
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

  // The rating lives in a review, so clearing it deletes that review. Needs
  // ctx.slug (RAWG has no "my review for game X" endpoint — see deleteRawgReview).
  // Without this, a locally-cleared game rating came straight back on the next
  // pull, since pullLibrary above reads `user_rating` off the profile.
  async clearRating(ctx, sourceId) {
    if (!ctx.token || !ctx.slug) return;
    await deleteRawgReview(ctx.token, parseInt(sourceId), ctx.slug);
  },

  async pushStatus(ctx, sourceId) {
    if (!ctx.token) return;
    await markRawgBeaten(ctx.token, parseInt(sourceId));
  },

  // Give the game every catalog link it's missing — Steam above all, since it's
  // the tag source (see crossLink.ts). Runs for LIBRARY pulls too, which is the
  // fix: this used to `return` unless kind === "wishlist", so nothing anyone
  // actually played was ever cross-linked, and 473 of 1,090 catalog games had no
  // Steam link at all. Safe to run everywhere now because an item that already
  // has its links costs one indexed SELECT, and `budget` bounds the rest.
  async enrich(item, mediaItemId, _kind, budget) {
    await crossLinkGame(mediaItemId, item.title, { releaseDate: item.releaseDate, budget });
  },
};
