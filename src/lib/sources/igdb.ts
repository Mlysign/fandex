// IGDB (Internet Game Database) — a Twitch-owned games metadata catalog.
// Auth is Twitch OAuth client-credentials (an APP token, no per-user data — IGDB
// exposes only metadata via its public API). Used by the MetadataProvider layer.

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// IGDB is optional — when Twitch credentials aren't configured, the provider
// no-ops so the rest of the app (detail/merge) keeps working unaffected.
export function igdbConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

// Cached app access token (Twitch tokens last ~60 days — never mint per request).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("IGDB not configured");
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const p = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" });
  const res = await fetch(`${TWITCH_TOKEN_URL}?${p}`, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch token failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

// POST an Apicalypse query body to an IGDB endpoint.
async function igdbQuery(endpoint: string, body: string): Promise<any[]> {
  const token = await getToken();
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) throw new Error(`IGDB ${endpoint}: ${res.status}`);
  return res.json();
}

const GAME_FIELDS =
  "fields name,slug,summary,storyline,first_release_date,url,status,hypes," +
  "game_type,parent_game,version_parent," + // disambiguate base game vs port/remaster/edition
  "rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating,total_rating_count," +
  "cover.image_id,screenshots.image_id,artworks.image_id,videos.name,videos.video_id," +
  "genres.name,themes.name,game_modes.name,player_perspectives.name,franchises.name,game_engines.name," +
  "platforms.name,release_dates.human,release_dates.date,release_dates.platform.name,release_dates.release_region," +
  "age_ratings.organization,age_ratings.rating_category,alternative_names.name," +
  "dlcs.name,expansions.name,websites.url,websites.type," +
  "involved_companies.developer,involved_companies.publisher,involved_companies.company.name;";

// Attach how-long-to-beat data (separate endpoint, seconds) as `time_to_beat`.
async function withTimeToBeat(game: any | null): Promise<any | null> {
  if (!game) return game;
  try {
    const ttb = await igdbQuery("game_time_to_beats", `fields hastily,normally,completely,count; where game_id = ${game.id};`);
    if (ttb[0]) game.time_to_beat = ttb[0];
  } catch { /* optional — leave game as-is */ }
  return game;
}

export async function getIgdbGame(id: number): Promise<any | null> {
  const rows = await igdbQuery("games", `${GAME_FIELDS} where id = ${id};`);
  return withTimeToBeat(rows[0] ?? null);
}

export async function searchIgdbGames(title: string, limit = 10): Promise<any[]> {
  const safe = title.replace(/["\\]/g, " ");
  return igdbQuery("games", `search "${safe}"; ${GAME_FIELDS} limit ${limit};`);
}

// Upcoming games whose first release falls in a unix-second window, most
// anticipated first. `hypes` is IGDB's pre-release follow count — the strongest
// "how excited are people" signal for unreleased titles (better than RAWG's
// popularity for upcoming). Excludes ports/remasters/editions (parent/version)
// so the canonical base game surfaces. No-ops when IGDB isn't configured.
export async function discoverIgdbUpcoming(gte: number, lte: number, limit = 40, offset = 0): Promise<any[]> {
  if (!igdbConfigured()) return [];
  try {
    return await igdbQuery(
      "games",
      `${GAME_FIELDS} ` +
        `where first_release_date >= ${gte} & first_release_date <= ${lte} ` +
        `& version_parent = null & parent_game = null; ` +
        `sort hypes desc; limit ${limit}; offset ${offset};`
    );
  } catch { return []; }
}

// IGDB images are referenced by image_id → build a sized CDN URL.
export function igdbImageUrl(imageId: string | undefined | null, size = "t_cover_big"): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

// first_release_date is a unix timestamp (seconds) → YYYY-MM-DD.
export function igdbReleaseDate(game: any): string | null {
  if (typeof game?.first_release_date === "number") {
    return new Date(game.first_release_date * 1000).toISOString().split("T")[0];
  }
  return null;
}
