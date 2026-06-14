import { get } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
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

  // Cross-enrich a Steam game with its RAWG link by exact-name match. Wishlist
  // only — owned libraries can be huge, so the legacy sync skipped it there too.
  async enrich(item, mediaItemId, kind) {
    if (kind !== "wishlist") return;
    try {
      const link = await METADATA.rawg?.searchByTitle?.(item.title, "game");
      if (link) {
        linkSourceToItem(mediaItemId, {
          source: "rawg", sourceId: link.sourceId, type: "game",
          title: link.title, releaseDate: link.releaseDate, rawData: link.rawData,
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    } catch { /* enrichment optional */ }
  },
};
