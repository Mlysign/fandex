// Steam's store tags for a game (2026-10-25): the one crowd-voted, crowd-ranked
// tag list any games provider has ("Tower Defense", "Roguelike Deckbuilder",
// "Story Rich"), which IGDB's editorial keywords are not. The old site stored
// them as `resolvedTags` on a Steam link; the new stack never fetched Steam's
// store at all, so until this a game's voted tier was empty (docs/fandex-score.md §3.9).
//
// Two calls, both on api.steampowered.com, which the Web API terms cover
// (PLATFORMS.md, "Steam Web API terms"): `IStoreService/GetTagList` names every
// tag id once, and `IStoreBrowseService/GetItems` answers a batch of apps with
// their top tags as (id, weight). Nothing here opens the store front end's
// undocumented query service. The key is the Worker's `STEAM_API_KEY`, passed
// in: a Web API key never ships in the app (docs/app-plan.md).
//
// ⚠️ A failed call THROWS, as every provider fetch here does. The cron step
// that stores the answer must never read an outage as "Steam has no tags for
// this game" and write that down.

import { httpFetch } from "@/lib/http";

const STEAM_API = "https://api.steampowered.com";
/** Tags asked for per app. Steam shows twenty on a store page; past that the weights are noise. */
export const STEAM_TAG_COUNT = 20;
/** Apps per GetItems call. The old site's batch; well inside the URL limit. */
export const STEAM_ITEMS_BATCH = 50;
const STEAM_BUDGET_MS = 15_000;

/** Tag id → name, from `GetTagList`. About 450 entries; a caller keeps it for a while. */
export async function getSteamTagMap(apiKey: string): Promise<Record<number, string>> {
  const res = await httpFetch(
    `${STEAM_API}/IStoreService/GetTagList/v1/?key=${encodeURIComponent(apiKey)}&language=english`,
    { appScopedAuth: true, budgetMs: STEAM_BUDGET_MS },
  );
  if (!res.ok) throw new Error(`Steam GetTagList ${res.status}`);
  const data = await res.json();
  const map: Record<number, string> = {};
  for (const t of data?.response?.tags ?? []) {
    if (Number.isInteger(t?.tagid) && typeof t?.name === "string" && t.name) map[t.tagid] = t.name;
  }
  if (!Object.keys(map).length) throw new Error("Steam GetTagList answered no tags");
  return map;
}

export interface SteamStoreTags {
  appid: number;
  name: string | null;
  /** The tag names, most voted first. Empty when Steam lists the app without tags. */
  tags: string[];
}

/**
 * The voted tags of each app, most voted first, resolved through `tagMap`. An
 * app Steam does not answer for (delisted, region-locked) is missing from the
 * map; the call itself failing throws.
 */
export async function getSteamStoreTags(apiKey: string, appIds: number[], tagMap: Record<number, string>): Promise<Map<number, SteamStoreTags>> {
  const out = new Map<number, SteamStoreTags>();
  const ids = [...new Set(appIds.filter((id) => Number.isInteger(id) && id > 0))];
  for (let i = 0; i < ids.length; i += STEAM_ITEMS_BATCH) {
    const batch = ids.slice(i, i + STEAM_ITEMS_BATCH);
    const inputJson = JSON.stringify({
      ids: batch.map((appid) => ({ appid })),
      context: { language: "english", country_code: "DE", steam_realm: 1 },
      data_request: { include_tag_count: STEAM_TAG_COUNT },
    });
    const res = await httpFetch(
      `${STEAM_API}/IStoreBrowseService/GetItems/v1?key=${encodeURIComponent(apiKey)}&input_json=${encodeURIComponent(inputJson)}`,
      { appScopedAuth: true, budgetMs: STEAM_BUDGET_MS },
    );
    if (!res.ok) throw new Error(`Steam GetItems ${res.status}`);
    const data = await res.json();
    for (const item of data?.response?.store_items ?? []) {
      if (!Number.isInteger(item?.appid)) continue;
      out.set(item.appid, { appid: item.appid, name: typeof item.name === "string" ? item.name : null, tags: rankedTagNames(item.tags, tagMap) });
    }
  }
  return out;
}

/** `[{tagid, weight}]` as names, heaviest first, ids the map does not know dropped. */
export function rankedTagNames(tags: unknown, tagMap: Record<number, string>): string[] {
  if (!Array.isArray(tags)) return [];
  return [...tags]
    .filter((t: any) => Number.isInteger(t?.tagid))
    .sort((a: any, b: any) => (Number(b?.weight) || 0) - (Number(a?.weight) || 0))
    .map((t: any) => tagMap[t.tagid])
    .filter((n): n is string => typeof n === "string" && !!n)
    .filter((n, i, all) => all.indexOf(n) === i)
    .slice(0, STEAM_TAG_COUNT);
}

const STEAM_APP_URL = /store\.steampowered\.com\/app\/(\d{1,10})/;

/** The Steam app a stored IGDB payload points at through its websites, or null. */
export function steamAppIdOf(igdb: { websites?: unknown } | null | undefined): number | null {
  if (!Array.isArray(igdb?.websites)) return null;
  for (const w of igdb.websites as { url?: unknown }[]) {
    const m = typeof w?.url === "string" ? STEAM_APP_URL.exec(w.url) : null;
    if (m) return Number(m[1]);
  }
  return null;
}
