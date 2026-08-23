// IGDB (Internet Game Database) — a Twitch-owned games metadata catalog.
// Auth is Twitch OAuth client-credentials (an APP token, no per-user data — IGDB
// exposes only metadata via its public API). Used by the MetadataProvider layer.

import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";
// See RAWG_HOST in sources/rawg.ts — the breaker is keyed by host, so it's
// derived from the base URL rather than restated.
export const IGDB_HOST = new URL(IGDB_BASE).host;
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
  const res = await httpFetch(`${TWITCH_TOKEN_URL}?${p}`, { method: "POST", appScopedAuth: true });
  if (!res.ok) throw new Error(`Twitch token failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

// POST an Apicalypse query body to an IGDB endpoint.
//
// `budgetMs` (G3, 2026-08-02) is opt-in per caller, not applied here: the
// browse-feed query (`discoverIgdbUpcoming`) passes BROWSE_BUDGET_MS so an IGDB
// outage costs a discover/home request seconds rather than the full retry
// ladder, while `fetchById`/`getGameTimeToBeat`/`searchIgdbGames` — which run
// during enrichment — keep the unbounded default. Enrichment would rather wait
// than lose an item's metadata.
//
// NOTE the budget does NOT cover getToken() below: a token mint is a separate
// request with its own timeout, and starving it would break the query outright
// rather than bound it. Worst case is one token timeout plus the budget.
async function igdbQuery(endpoint: string, body: string, budgetMs?: number): Promise<any[]> {
  const token = await getToken();
  const res = await httpFetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body,
    appScopedAuth: true,
    ...(budgetMs != null ? { budgetMs } : {}),
  });
  if (!res.ok) throw new Error(`IGDB ${endpoint}: ${res.status}`);
  return res.json();
}

const GAME_FIELDS =
  "fields name,slug,summary,storyline,first_release_date,url,status,hypes," +
  "game_type,parent_game,version_parent," + // disambiguate base game vs port/remaster/edition
  "rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating,total_rating_count," +
  "cover.image_id,screenshots.image_id,artworks.image_id,videos.name,videos.video_id," +
  "genres.name,themes.name,keywords.name,game_modes.name,player_perspectives.name,franchises.name,game_engines.name," +
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

// Coerce an interpolated numeric field to a safe non-negative integer. IGDB
// queries are built by string interpolation (Apicalypse, not SQL — no bound
// params), so a non-numeric value reaching an `id`/`limit`/`offset` slot could
// inject clauses. TS types these as `number`, but runtime values can arrive from
// JSON; this is the runtime backstop.
function safeInt(n: number, fallback: number): number {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// Apicalypse `search` terms are interpolated into a quoted string. Strip every
// character that could break out of the quotes or inject a clause (quotes,
// backslashes, statement/brace/paren/glob chars) plus control chars, collapse
// whitespace, and cap length. Defense-in-depth even though the value is quoted.
export function sanitizeApicalypseSearch(raw: string): string {
  return String(raw ?? "")
    .replace(/["\\;{}()*[\]]/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export async function getIgdbGame(id: number): Promise<any | null> {
  const rows = await igdbQuery("games", `${GAME_FIELDS} where id = ${safeInt(id, 0)};`);
  return withTimeToBeat(rows[0] ?? null);
}

export async function searchIgdbGames(title: string, limit = 10): Promise<any[]> {
  const safe = sanitizeApicalypseSearch(title);
  if (!safe) return []; // nothing meaningful to search → don't run a malformed query
  return igdbQuery("games", `search "${safe}"; ${GAME_FIELDS} limit ${safeInt(limit, 10)};`);
}

// Upcoming games whose first release falls in a unix-second window, most
// anticipated first. `hypes` is IGDB's pre-release follow count — the strongest
// "how excited are people" signal for unreleased titles (better than RAWG's
// popularity for upcoming). Excludes ports/remasters/editions (parent/version)
// so the canonical base game surfaces. No-ops when IGDB isn't configured.
// `sort` is constrained to a closed set rather than interpolated freely — it
// lands in an Apicalypse query string, and the rest of this file is careful to
// only ever inject through safeInt/sanitizeApicalypseSearch. `hypes` is the
// right ranking for a window that's still ahead of us; for a window already in
// the past nobody is hyped any more, so rank by how many people ended up rating
// it (the same signal discoverIgdbByTag uses).
export type IgdbDiscoverSort = "hypes" | "total_rating_count";

export async function discoverIgdbUpcoming(
  gte: number, lte: number, limit = 40, offset = 0, sort: IgdbDiscoverSort = "hypes"
): Promise<any[]> {
  if (!igdbConfigured()) return [];
  const sortField = sort === "total_rating_count" ? "total_rating_count" : "hypes";
  try {
    return await igdbQuery(
      "games",
      `${GAME_FIELDS} ` +
        `where first_release_date >= ${safeInt(gte, 0)} & first_release_date <= ${safeInt(lte, 0)} ` +
        `& version_parent = null & parent_game = null; ` +
        `sort ${sortField} desc; limit ${safeInt(limit, 40)}; offset ${safeInt(offset, 0)};`,
      // G3: this is the browse-feed query — bound it. Every caller is a
      // discover/home/calendar surface that already degrades to "IGDB
      // contributed nothing this round".
      BROWSE_BUDGET_MS
    );
  } catch { return []; }
}

// MB11 (2026-08-14) — IGDB's own "similar games" for a game, used ONLY to top
// up the item page's "More like this" rail when the local catalog can't field
// three neighbours. IGDB curates this list itself, so it beats anything we
// could infer from a catalog that may hold only a handful of comparable titles.
//
// Two deliberate choices:
//   • `similar_games.*` is expanded IN THIS QUERY rather than added to
//     GAME_FIELDS. Putting it on the main field list would fatten every game
//     payload we store, for a field only one surface reads — and stored
//     payloads are what a PROJECTION_VERSION bump has to re-project.
//   • BROWSE_BUDGET_MS, because the caller is a page render that already
//     degrades to "no rail" rather than an enrichment path that would rather
//     wait.
export async function getIgdbSimilarGames(igdbId: number, limit = 12): Promise<any[]> {
  if (!igdbConfigured()) return [];
  try {
    const rows = await igdbQuery(
      "games",
      `fields similar_games.name,similar_games.slug,similar_games.first_release_date,` +
        `similar_games.cover.image_id,similar_games.artworks.image_id,similar_games.screenshots.image_id,` +
        `similar_games.genres.name,similar_games.themes.name,similar_games.platforms.name,` +
        `similar_games.total_rating,similar_games.total_rating_count,similar_games.url; ` +
        `where id = ${safeInt(igdbId, 0)};`,
      BROWSE_BUDGET_MS
    );
    return (rows[0]?.similar_games ?? []).slice(0, safeInt(limit, 12));
  } catch { return []; }
}

// Q27 (2026-07-19) — games matching a tag/keyword facet (genre, theme, or
// keyword name, case-insensitive contains) for the /discover "more from the
// databases" supplement — previously TMDB+RAWG only, so a tag with no games
// (or games IGDB just knows better, like most anime titles) undersold
// "discover new games/anime". `sanitizeApicalypseSearch` already strips the
// characters (incl. `*`) that would matter here — reused rather than adding a
// second sanitizer, since the `*` wildcard delimiters below are ours, not the
// caller's.
export async function discoverIgdbByTag(query: string, limit = 40): Promise<any[]> {
  return discoverIgdbByTags([query], limit);
}

/**
 * The same pull for SEVERAL tags at once, ANDed — a game must carry every one.
 *
 * 2026-08-13: advanced search used to fetch each tag separately and intersect
 * the results afterwards. That cannot work here: each pull is a `limit 40`
 * SAMPLE of a tag that may have thousands of games, so intersecting two samples
 * is empty almost by construction even when games carrying both tags plainly
 * exist (measured: `deckbuilding` 29 hits, `tower defense` 40 hits, intersection
 * **0**). Pushing the AND into the query samples FROM the intersection instead,
 * which is what the `&` operator is there for.
 */
export async function discoverIgdbByTags(queries: string[], limit = 40): Promise<any[]> {
  if (!igdbConfigured()) return [];
  const safe = queries.map((q) => sanitizeApicalypseSearch(q)).filter(Boolean);
  // An unusable term would silently widen an AND into a narrower-looking OR.
  if (!safe.length || safe.length !== queries.length) return [];
  const clauses = safe
    .map((s) => `(themes.name ~ *"${s}"* | keywords.name ~ *"${s}"* | genres.name ~ *"${s}"*)`)
    .join(" & ");
  try {
    return await igdbQuery(
      "games",
      `${GAME_FIELDS} ` +
        `where ${clauses} & version_parent = null & parent_game = null; ` +
        `sort total_rating_count desc; limit ${safeInt(limit, 40)};`,
      // Browse path (advanced search + the public facet pages), same as
      // discoverIgdbUpcoming above: degrade rather than pay the retry ladder.
      BROWSE_BUDGET_MS
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

// ── Franchise membership (2026-08-23) ────────────────────────────────────────
//
// Every game IGDB files under a franchise, whether or not we hold it. The
// franchise rail could previously only list catalog rows, so it silently
// understated most franchises.
//
// ⚠️ THESE LISTS ARE LARGE AND THAT IS THE WHOLE POINT OF MEASURING FIRST.
// Sampled across 15 of our franchises that day: **average 78 games, largest
// 394** (franchise 1, "Star Wars"), against 4.8 for a TMDB collection. So this
// is deliberately capped, and the caller stores ~200-byte rows rather than
// catalog entries — ingesting all of them would have grown the catalog 6.4x.
//
// `limit 500` is IGDB's own per-request maximum. Anything past it is truncated
// rather than paginated, on purpose: a rail shows at most a few dozen, and a
// franchise with more than 500 entries is one where the tail is ports and
// bundles nobody is looking for.
const FRANCHISE_MEMBER_CAP = 500;

export async function getIgdbFranchiseGames(franchiseId: number): Promise<any[]> {
  if (!igdbConfigured()) return [];
  // NOT try/caught, unlike the browse helpers above. This one is driven by the
  // sweep, which must be able to tell "this franchise has no games" from "the
  // call failed" — swallowing the error here would write an empty membership
  // and make an outage look like an authoritative answer. Same shape as the
  // prune invariant, one layer out.
  return igdbQuery(
    "games",
    `fields name,first_release_date,cover.image_id,total_rating_count,category;` +
      ` where franchises = (${safeInt(franchiseId, 0)}) & version_parent = null;` +
      ` sort total_rating_count desc; limit ${FRANCHISE_MEMBER_CAP};`
  );
}
