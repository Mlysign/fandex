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

// ── The IGDB kill switch (2026-08-28) ────────────────────────────────────────
//
// `IGDB_ENABLED=0` (or `false`) turns IGDB off completely: no calls, no new
// stored rows, everywhere. **Default is ON** — set it only to switch IGDB off.
//
// ⚠️ WHY IT EXISTS, because "we might not be allowed to keep this data" is not a
// reason a future session would guess. The Twitch Developer Services Agreement,
// which IGDB's own docs name as its licence, permits storing copies of their
// content only with prior written authorization or a TWENTY-FOUR HOUR cache
// (read 2026-08-28, legal.twitch.com/legal/developer-agreement). Fandex holds
// IGDB links indefinitely, so on a literal reading it is already outside that.
//
// It is not clear-cut, which is the whole reason for a switch rather than a
// removal: IGDB's own API ships webhooks whose only purpose is keeping YOUR copy
// of their data current, and its docs open on the accessibility of their data. A
// product built for local mirrors does not square with a 24-hour cache limit.
// Nils asked partner@igdb.com; until that is answered, IGDB runs and this switch
// is what makes the answer cheap to act on.
//
// ⚠️ If the answer is NO, flipping this stops the flow but does NOT remove what
// is already stored. Removing that is a separate, explicit step: the old site's
// `scripts/purge-igdb.mjs` (tag `old-site-final`) did it on SQLite, and nothing
// does it on D1 yet. → docs/archive/old-site/catalog-growth.md §17
//
// ⚠️ Default ON is the deliberate choice for a KILL switch: a typo in the env
// var leaves the site working rather than silently dropping a third of the
// catalog's games. The failure direction that matters is the loud one.
function igdbKilled(): boolean {
  const v = (process.env.IGDB_ENABLED ?? "").trim().toLowerCase();
  return v === "0" || v === "false";
}

// IGDB is optional — when Twitch credentials aren't configured, or the kill
// switch above is thrown, the provider no-ops so the rest of the app
// (detail/merge) keeps working unaffected.
export function igdbConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET) && !igdbKilled();
}

// Cached app access token (Twitch tokens last ~60 days — never mint per request).
let cachedToken: { token: string; expiresAt: number } | null = null;

// ── A shared home for the token (2026-10-04) ────────────────────────────────
//
// The module-level cache above is enough for ONE long-lived process, which is
// what Railway runs. A Cloudflare Worker is many short-lived isolates, each
// starting with `cachedToken = null`, so without somewhere shared every cold
// isolate would mint its own token. Twitch caps how many live app tokens a
// client id may hold and invalidates the oldest past it, so that is not just
// waste: it would log the other isolates out mid-request.
//
// The Worker registers a store backed by a D1 row. Nothing registers one on
// Railway, so behaviour there is unchanged. Both halves are best-effort: a
// store that throws falls through to minting, which is the pre-existing path.
export interface IgdbTokenStore {
  get(): Promise<{ token: string; expiresAt: number } | null>;
  set(t: { token: string; expiresAt: number }): Promise<void>;
}
let tokenStore: IgdbTokenStore | null = null;
export function setIgdbTokenStore(store: IgdbTokenStore | null): void {
  tokenStore = store;
}

// The last token IGDB answered 401 to. A token Twitch revoked early (a secret
// rotated, the per-client cap passed) still reads as unexpired, so without
// this the cache and the shared store would hand it back until its 60 days
// ran out. Minting a new one overwrites the shared copy through `set`.
let rejectedToken: string | null = null;

/** Forget a token IGDB refused, so the next call mints (or picks up a newer shared one). */
function dropToken(token: string): void {
  rejectedToken = token;
  if (cachedToken?.token === token) cachedToken = null;
}

async function getToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("IGDB not configured");
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  if (tokenStore) {
    try {
      const shared = await tokenStore.get();
      if (shared && shared.expiresAt > now + 60_000 && shared.token !== rejectedToken) {
        cachedToken = shared;
        return shared.token;
      }
    } catch { /* fall through to minting */ }
  }
  const p = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" });
  const res = await httpFetch(`${TWITCH_TOKEN_URL}?${p}`, { method: "POST", appScopedAuth: true });
  if (!res.ok) throw new Error(`Twitch token failed: ${res.status}`);
  const data = await res.json();
  const minted = { token: data.access_token as string, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  cachedToken = minted;
  if (tokenStore) {
    try { await tokenStore.set(minted); } catch { /* the in-memory copy still serves this isolate */ }
  }
  return minted.token;
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
//
// A 401 means the token, not the query: it is dropped and the query asked once
// more with a fresh one. Once only, so a client id Twitch no longer accepts
// costs one extra mint per call, not a loop.
async function igdbQuery(endpoint: string, body: string, budgetMs?: number): Promise<any[]> {
  const ask = async (token: string) => httpFetch(`${IGDB_BASE}/${endpoint}`, {
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
  const token = await getToken();
  let res = await ask(token);
  if (res.status === 401) {
    dropToken(token);
    res = await ask(await getToken());
  }
  if (!res.ok) throw new Error(`IGDB ${endpoint}: ${res.status}`);
  return res.json();
}

const GAME_FIELDS =
  "fields name,slug,summary,storyline,first_release_date,url,status,hypes," +
  "game_type,parent_game,version_parent," + // disambiguate base game vs port/remaster/edition
  "rating,rating_count,aggregated_rating,aggregated_rating_count,total_rating,total_rating_count," +
  "cover.image_id,screenshots.image_id,artworks.image_id,videos.name,videos.video_id," +
  "genres.name,themes.name,keywords.name,game_modes.name,player_perspectives.name,franchises.name,collections.name,game_engines.name," +
  "platforms.name,release_dates.human,release_dates.date,release_dates.platform.name,release_dates.release_region," +
  "age_ratings.organization,age_ratings.rating_category,alternative_names.name," +
  "dlcs.name,expansions.name,websites.url,websites.type," +
  "involved_companies.developer,involved_companies.publisher,involved_companies.company.name;";

// IGDB's collections are its series inside a franchise: the Harry Potter
// film tie-ins are the collection "Harry Potter", the LEGO ones "Lego Harry
// Potter", and Hogwarts Legacy is in neither (2026-10-18). IGDB leaves an empty
// field out, so a payload asked with GAME_FIELDS is given `collections: []`
// when it has none: absent then means "asked before collections were", which
// the facet reads as unknown (facets.ts, Facet.series).
function withKnownCollections<T>(rows: T[]): T[] {
  for (const g of rows as any[]) if (g && typeof g === "object" && !Array.isArray(g.collections)) g.collections = [];
  return rows;
}

/**
 * The collections of these games, and nothing else: what the Worker's
 * backfill merges into a stored game (worker/src/cron.ts). Every id asked
 * comes back with `collections`, [] for a game in none. A game IGDB no longer
 * has is left out.
 */
export async function getIgdbCollections(ids: number[]): Promise<{ id: number; collections: { name: string }[] }[]> {
  if (!igdbConfigured()) return [];
  const safe = ids.slice(0, 500).map((i) => safeInt(i, 0)).filter((i) => i > 0);
  if (!safe.length) return [];
  const rows = await igdbQuery("games", `fields collections.name; where id = (${safe.join(",")}); limit 500;`);
  return withKnownCollections(rows as any[]).map((g) => ({ id: g.id, collections: g.collections }));
}

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
  // Self-gated like its siblings: without this, an ungated caller (the /r/
  // resolver page) turns the kill switch into a throw instead of a no-op.
  if (!igdbConfigured()) return null;
  const rows = withKnownCollections(await igdbQuery("games", `${GAME_FIELDS} where id = ${safeInt(id, 0)};`));
  return withTimeToBeat(rows[0] ?? null);
}

/**
 * The IGDB game a Steam app is, from IGDB's own `external_games` map, or null
 * when IGDB lists none (software, a soundtrack, a store item IGDB never added).
 * Exact where a name search is not: IGDB's search does not surface THE FINALS
 * at all, its Steam app id finds it (2026-10-23). Throws when IGDB fails, so a
 * caller can tell "IGDB does not know this app" from "IGDB did not answer".
 */
export async function igdbGameIdForSteamApp(appId: number): Promise<number | null> {
  if (!igdbConfigured()) return null;
  const id = safeInt(appId, 0);
  if (!id) return null;
  const rows = await igdbQuery("external_games", `fields game; where uid = "${id}" & (category = 1 | external_game_source = 1); limit 5;`);
  const game = rows.find((r: any) => Number.isInteger(r?.game) && r.game > 0)?.game;
  return game ?? null;
}

/**
 * IGDB `game_type`s that are part of another game rather than one of their
 * own: DLC (1), bundle (3), mod (5), episode (6), season (7), fork (12), pack
 * (13), update (14). An expansion (2), a standalone expansion (4), a remake (8)
 * and a remaster (9) are works people track, so they are not add-ons.
 */
const IGDB_ADDON_TYPES = new Set([1, 3, 5, 6, 7, 12, 13, 14]);

/** True for a DLC, bundle, mod, season pass or pack (Nils, 2026-10-23: ranked last in search, kept out of rails). */
export function isIgdbAddon(g: { game_type?: unknown } | null | undefined): boolean {
  return typeof g?.game_type === "number" && IGDB_ADDON_TYPES.has(g.game_type);
}

/**
 * A search term IGDB can match: accents folded. IGDB matches "pokemon" to
 * "Pokémon" but returns nothing at all for "pokémon" (2026-10-23).
 */
export function foldSearchTerm(term: string): string {
  return term.normalize("NFKD").replace(/[̀-ͯ]/g, "").normalize("NFC");
}

// An apostrophe is dropped, not spaced: "baldurs gate" is how Baldur's Gate is typed.
const titleKey = (s: string) => foldSearchTerm(String(s ?? "")).toLowerCase().replace(/['‘’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * IGDB's search answers in text-relevance order, which ignores how known a
 * game is: a 0-vote bundle came first for "baldurs gate", a ROM hack ahead of
 * Ocarina of Time for "zelda" (2026-10-23). Re-ranked: the exact title first
 * (decided 2026-09-02), then games people know by votes and hype, then
 * add-ons, then everything nobody has rated. IGDB's own order breaks ties.
 */
export function rankIgdbSearch<T extends { name?: unknown; game_type?: unknown; total_rating_count?: unknown; hypes?: unknown }>(rows: T[], term: string): T[] {
  const want = titleKey(term);
  const reach = (g: T) => (typeof g.total_rating_count === "number" ? g.total_rating_count : 0) + (typeof g.hypes === "number" ? g.hypes : 0);
  const tier = (g: T) => {
    const addon = isIgdbAddon(g);
    if (!addon && titleKey(String(g.name ?? "")) === want) return 0;
    if (reach(g) === 0) return addon ? 4 : 3;
    return addon ? 2 : 1;
  };
  return rows
    .map((g, i) => ({ g, i, t: tier(g), r: reach(g) }))
    .sort((a, b) => a.t - b.t || b.r - a.r || a.i - b.i)
    .map((x) => x.g);
}

export async function searchIgdbGames(title: string, limit = 10): Promise<any[]> {
  if (!igdbConfigured()) return [];
  const safe = sanitizeApicalypseSearch(foldSearchTerm(title));
  if (!safe) return []; // nothing meaningful to search → don't run a malformed query
  // No ports (game_type 11) and no editions (version_parent): IGDB keeps each
  // console port and each "Gold Edition" as a game of its own, often with the
  // same name and year, and opening one from search made it a second title
  // (69 pool rows on 2026-10-15). ⚠️ NOT `parent_game = null`, which the browse
  // queries use: that also drops every DLC, expansion, remaster and remake
  // (Oblivion Remastered, Metal Gear Solid Delta), which are works of their own.
  // Asks for 50 and keeps the best `limit` after re-ranking: Breath of the Wild
  // is not in IGDB's first 20 for "zelda". Still one IGDB call.
  const n = safeInt(limit, 10);
  const rows = await igdbQuery("games", `search "${safe}"; ${GAME_FIELDS} where version_parent = null & game_type != 11; limit ${Math.max(50, n)};`);
  return withKnownCollections(rankIgdbSearch(rows, safe).slice(0, n));
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

// What a CARD needs and nothing else (2026-10-04). GAME_FIELDS is the full
// detail shape, ~5 KB a game, and the site asks for it here because it stores
// every browsed game as a thin link. The Cloudflare Worker stores only the
// card, and parsing forty full payloads is most of the 10 ms of CPU a Worker
// request is allowed. Same query, same ranking, a tenth of the bytes.
//
// A closed set like `sort`, never a caller-supplied field list: it is
// interpolated into the Apicalypse query.
const GAME_CARD_FIELDS =
  "fields name,first_release_date,hypes,total_rating,total_rating_count," +
  "cover.image_id,artworks.image_id,screenshots.image_id,genres.name,themes.name,platforms.name;";
export type IgdbDiscoverShape = "full" | "card";

/**
 * A tag's or a studio's games as cards, most rated first: the facet pages'
 * games on the new stack (worker/src/browse.ts). A tag is matched the way
 * discoverIgdbByTags matches one (a theme, keyword or genre containing it), a
 * studio by a company name containing it.
 *
 * Unlike its siblings it does NOT swallow a failure: the Worker caches the
 * answer for a week, and caching a failed call as "no games" would hide a
 * studio's games for that long. An unconfigured IGDB still answers [].
 */
export async function discoverIgdbFacetCards(kind: "tag" | "studio" | "franchise", label: string, limit = 40): Promise<any[]> {
  if (!igdbConfigured()) return [];
  const safe = sanitizeApicalypseSearch(label);
  if (!safe) return [];
  // A franchise is matched by its whole name, not a part of it: "Alien" must not
  // bring in every franchise with "alien" somewhere in its name. IGDB keeps a
  // series in two places, a franchise and a collection, so either counts.
  const where = kind === "tag"
    ? `(themes.name ~ *"${safe}"* | keywords.name ~ *"${safe}"* | genres.name ~ *"${safe}"*)`
    : kind === "franchise"
      ? `(franchises.name ~ "${safe}" | collections.name ~ "${safe}")`
      : `involved_companies.company.name ~ *"${safe}"*`;
  return igdbQuery(
    "games",
    `${GAME_CARD_FIELDS} where ${where} & version_parent = null & parent_game = null; ` +
      `sort total_rating_count desc; limit ${safeInt(limit, 40)};`,
    BROWSE_BUDGET_MS,
  );
}

export async function discoverIgdbUpcoming(
  gte: number, lte: number, limit = 40, offset = 0, sort: IgdbDiscoverSort = "hypes",
  shape: IgdbDiscoverShape = "full"
): Promise<any[]> {
  if (!igdbConfigured()) return [];
  const sortField = sort === "total_rating_count" ? "total_rating_count" : "hypes";
  try {
    const rows = await igdbQuery(
      "games",
      `${shape === "card" ? GAME_CARD_FIELDS : GAME_FIELDS} ` +
        `where first_release_date >= ${safeInt(gte, 0)} & first_release_date <= ${safeInt(lte, 0)} ` +
        `& version_parent = null & parent_game = null; ` +
        `sort ${sortField} desc; limit ${safeInt(limit, 40)}; offset ${safeInt(offset, 0)};`,
      // G3: this is the browse-feed query — bound it. Every caller is a
      // discover/home/calendar surface that already degrades to "IGDB
      // contributed nothing this round".
      BROWSE_BUDGET_MS
    );
    // A card never asked for collections, so it must not claim to know there are none.
    return shape === "card" ? rows : withKnownCollections(rows);
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
    return withKnownCollections(await igdbQuery(
      "games",
      `${GAME_FIELDS} ` +
        `where ${clauses} & version_parent = null & parent_game = null; ` +
        `sort total_rating_count desc; limit ${safeInt(limit, 40)};`,
      // Browse path (advanced search + the public facet pages), same as
      // discoverIgdbUpcoming above: degrade rather than pay the retry ladder.
      BROWSE_BUDGET_MS
    ));
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
