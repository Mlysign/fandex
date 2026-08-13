import { get } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import type { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import { crossLinkGame } from "../crossLink";
import {
  getSteamWishlistIds, getSteamOwnedGames, getSteamAppDetails,
  getSteamTagMap, resolveTagNames, extractSteamDate,
} from "../steam";
import { METADATA } from "@/lib/metadata/registry";

// Steam adapter (games). OpenID — read-only: Steam exposes no write API and no
// personal ratings, so it declares only read capabilities and implements no
// push methods. Data is fetched from the public Web API keyed by the user's
// steamId (no per-user token).
//
// NOTE: pull* not migrated yet — the legacy sync path cross-enriches with RAWG.
export const steamSource: MediaSource = {
  ...CATALOG.steam,

  async context(userId) {
    const identity = get<any>(
      "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'steam'",
      [userId]
    );
    if (!identity) return null;
    return { userId, identity, token: null, slug: identity.provider_user_id };
  },

  async pullWishlist(ctx) {
    if (!ctx.slug) return [];
    const appIds = await getSteamWishlistIds(ctx.slug);
    if (appIds.length === 0) return [];
    const tagMap = await getSteamTagMap();
    const details = await getSteamAppDetails(appIds);
    const items: PulledItem[] = [];
    for (const appId of appIds) {
      const data = details[appId];
      // Safe to drop silently: getSteamAppDetails THROWS on a failed batch, so a
      // missing appid here means Steam genuinely has no store item for it
      // (delisted / region-locked) — a real absence the prune should act on, not
      // a fetch we failed to make. Don't soften that throw without revisiting
      // this: it would turn an outage back into a silent wishlist deletion.
      if (!data || data.item_type !== 0) continue; // skip non-games
      if (data.tagids && Object.keys(tagMap).length > 0) data.resolvedTags = resolveTagNames(data.tagids, tagMap);
      items.push({
        sourceId: String(appId), title: data.name ?? `App ${appId}`, type: "game",
        releaseDate: extractSteamDate(data), rawData: { ...data, appid: appId },
      });
    }
    return items;
  },

  async pullLibrary(ctx) {
    if (!ctx.slug) return [];
    const games = await getSteamOwnedGames(ctx.slug);
    return games.map((g): PulledItem => ({
      sourceId: String(g.appid), title: g.name ?? `App ${g.appid}`, type: "game", releaseDate: null,
      rawData: { appid: g.appid, name: g.name, playtime_forever: g.playtime_forever, rtime_last_played: g.rtime_last_played, img_icon_url: g.img_icon_url },
      status: g.playtime_forever > 0 ? "played" : "owned",
      reviewedAt: g.rtime_last_played > 0 ? g.rtime_last_played : null,
    }));
  },

  // Same shared cross-link as the RAWG adapter — one rule ("a game carries every
  // game catalog's link"), one implementation. This half used to fetch only RAWG
  // and only for wishlists; see crossLink.ts for why both halves were wrong.
  async enrich(item, mediaItemId, _kind, budget) {
    await crossLinkGame(mediaItemId, item.title, { releaseDate: item.releaseDate, budget });
  },
};
