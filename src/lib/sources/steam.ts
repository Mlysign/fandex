import { httpFetch } from "@/lib/http";

const STEAM_API = "https://api.steampowered.com";
const API_KEY = process.env.STEAM_API_KEY!;

// ── OpenID ────────────────────────────────────────────────────────

export function getSteamLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": new URL(returnTo).origin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `https://steamcommunity.com/openid/login?${params}`;
}

export function extractSteamId(searchParams: URLSearchParams): string | null {
  const identity = searchParams.get("openid.claimed_id");
  if (!identity) return null;
  const match = identity.match(/\/id\/(\d+)$/);
  return match ? match[1] : null;
}

export async function verifySteamOpenId(searchParams: URLSearchParams): Promise<boolean> {
  const params = new URLSearchParams(searchParams);
  params.set("openid.mode", "check_authentication");
  const res = await httpFetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    body: params,
  });
  const text = await res.text();
  return text.includes("is_valid:true");
}

// ── Player info ───────────────────────────────────────────────────

export async function getSteamPlayerSummary(steamId: string) {
  const res = await httpFetch(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${API_KEY}&steamids=${steamId}`);
  const data = await res.json();
  return data.response?.players?.[0] ?? null;
}

export async function resolveVanityUrl(vanity: string): Promise<string> {
  const res = await httpFetch(`${STEAM_API}/ISteamUser/ResolveVanityURL/v1/?key=${API_KEY}&vanityurl=${encodeURIComponent(vanity)}`);
  const data = await res.json();
  if (data.response?.success === 1) return data.response.steamid;
  throw new Error(`Could not resolve Steam vanity URL: ${vanity}`);
}

// ── Wishlist ──────────────────────────────────────────────────────

export async function getSteamWishlistIds(steamId: string): Promise<number[]> {
  const res = await httpFetch(`${STEAM_API}/IWishlistService/GetWishlist/v1?steamid=${steamId}&key=${API_KEY}`);
  if (!res.ok) throw new Error(`Steam wishlist fetch failed: ${res.status}`);
  const data = await res.json();
  const items = data.response?.items ?? [];
  items.sort((a: any, b: any) => b.date_added - a.date_added);
  return items.map((i: any) => i.appid);
}

// ── Owned games (for the Library page) ────────────────────────────

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;   // minutes
  rtime_last_played: number;  // unix seconds, 0 if never
  img_icon_url?: string;
}

export async function getSteamOwnedGames(steamId: string): Promise<SteamOwnedGame[]> {
  const params = new URLSearchParams({
    key: API_KEY,
    steamid: steamId,
    include_appinfo: "1",
    include_played_free_games: "1",
    format: "json",
  });
  const res = await httpFetch(`${STEAM_API}/IPlayerService/GetOwnedGames/v1/?${params}`);
  if (!res.ok) throw new Error(`Steam owned games fetch failed: ${res.status}`);
  const data = await res.json();
  const games: SteamOwnedGame[] = data.response?.games ?? [];
  // Most-recently-played first; never-played fall to the end.
  games.sort((a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0));
  return games;
}

export async function getSteamAppDetails(appIds: number[]): Promise<Record<number, any>> {
  const results: Record<number, any> = {};
  const BATCH = 50;

  for (let i = 0; i < appIds.length; i += BATCH) {
    const batch = appIds.slice(i, i + BATCH);
    try {
      const inputJson = JSON.stringify({
        ids: batch.map((appid) => ({ appid })),
        // DE country code → euro prices; matches the DE-first region preference
        // used for TMDB streaming providers.
        context: { language: "english", country_code: "DE", steam_realm: 1 },
        data_request: {
          include_release: true,
          include_basic_info: true,
          include_short_description: true,
          include_platforms: true,
          include_screenshots: true,
          include_trailers: true,
          include_ratings: true,         // game_rating: USK/PEGI/ESRB age rating
          include_tag_count: 20,
          include_reviews: true,
          include_assets: true,
          include_supported_languages: true,
          include_included_items: true,  // DLC / bundled apps
        },
      });
      const res = await httpFetch(
        `${STEAM_API}/IStoreBrowseService/GetItems/v1?key=${API_KEY}&input_json=${encodeURIComponent(inputJson)}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.response?.store_items ?? []) {
        if (item.appid) results[item.appid] = item;
      }
    } catch (e) {
      console.error("[Steam] getAppDetails batch error:", e);
    }
    if (i + BATCH < appIds.length) await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

// ── Tag names ─────────────────────────────────────────────────────

let tagCache: Record<number, string> = {};

export async function getSteamTagMap(): Promise<Record<number, string>> {
  if (Object.keys(tagCache).length > 0) return tagCache;
  try {
    const res = await httpFetch(`${STEAM_API}/IStoreService/GetTagList/v1/?key=${API_KEY}&language=english`);
    if (!res.ok) return tagCache;
    const data = await res.json();
    tagCache = {};
    for (const tag of data.response?.tags ?? []) tagCache[tag.tagid] = tag.name;
  } catch { /* continue with empty */ }
  return tagCache;
}

export function resolveTagNames(tagIds: number[], tagMap: Record<number, string>): string[] {
  return tagIds.map((id) => tagMap[id]).filter(Boolean).slice(0, 8);
}

// Extract a YYYY-MM-DD release date from a Steam store item, if available.
export function extractSteamDate(data: any): string | null {
  const r = data?.release;
  if (!r) return null;
  if (r.steam_release_date) {
    return new Date(r.steam_release_date * 1000).toISOString().split("T")[0];
  }
  if (r.custom_release_date?.date) {
    const p = Date.parse(r.custom_release_date.date);
    if (!isNaN(p)) return new Date(p).toISOString().split("T")[0];
  }
  return null;
}

// ── Search (for detail panel lookups) ────────────────────────────

export async function searchSteamByName(name: string): Promise<{ appid: number; data: any } | null> {
  try {
    const normalized = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const res = await httpFetch(
      `https://store.steampowered.com/search/suggest?term=${encodeURIComponent(name)}&f=games&cc=US&realm=1&l=english&use_store_query=1`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" } }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const appMatches = [...html.matchAll(/data-ds-appid="(\d+)"/g)];
    const nameMatches = [...html.matchAll(/<div class="match_name[^"]*">([^<]+)<\/div>/g)];
    if (appMatches.length === 0) return null;

    let appid: number | null = null;
    for (let i = 0; i < appMatches.length; i++) {
      const id = parseInt(appMatches[i][1]);
      const n = nameMatches[i]?.[1]?.trim() ?? "";
      if (n.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim() === normalized) {
        appid = id; break;
      }
    }
    if (!appid) return null;

    const details = await getSteamAppDetails([appid]);
    const data = details[appid];
    if (!data) return null;
    return { appid, data };
  } catch { return null; }
}
