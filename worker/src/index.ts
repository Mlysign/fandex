// The Fandex API. One Worker: the shared catalog, the account layer, the IGDB
// proxy, and a ten-minute cron. docs/app-plan.md is the why; this file is the
// route table.
//
//   Public (no session)
//     GET  /v1/health
//     GET  /v1/catalog/delta?since&after&limit&count   the scoring pool, as a delta
//     GET  /v1/taxonomy                                tag categories, aliases, scoring config
//     GET  /v1/items/{id}?region                       one item's detail
//     GET  /v1/items/{type}/{slug}?region
//     GET  /v1/resolve/{source}/{type}/{id}            find or fetch a provider title
//     POST /v1/lookup  {refs:[{source,type,id}]}       which of these are held (no fetch)
//     GET  /v1/shows/{id}/episodes
//     GET  /v1/search/games?q                          IGDB search (the secret stays here)
//     GET  /v1/calendar/{YYYY-MM}?region               the month's popular releases
//     POST /v1/catalog/release-dates {region, ids}     films whose date in that country differs
//
//   Sign-in
//     POST /v1/auth/google   {idToken, nonce}
//     POST /v1/auth/discord  {accessToken}         Discord's implicit grant, checked with Discord
//     POST /v1/auth/trakt    {accessToken}
//     POST /v1/auth/merge    {mergeToken, resolution}
//     POST /v1/auth/logout
//
//   Your rows (session required)
//     GET    /v1/me
//     PUT    /v1/me/prefs
//     GET    /v1/me/state/{items|episodes|hidden|counts}
//     PUT    /v1/me/state
//     GET    /v1/me/export
//     DELETE /v1/me

import { providerBreakerSnapshot } from "@/lib/http";
import { discoverIgdbFacetCards, discoverIgdbUpcoming, igdbImageUrl, igdbReleaseDate, searchIgdbGames } from "@/lib/sources/igdb";
import { buildAccountExportJson, deleteAccount, disconnectIdentity, type MergeResolution } from "./account";
import { isAdmin, parseDays, usersSnapshot } from "./admin";
import { analyticsSnapshot, countPageView } from "./telemetry";
import {
  clearIpOverride, clearLabel, clearTagOverride, deleteAlias, deleteBundle, deleteCategory, parseAliases, parseCategory, parseCategoryWeights,
  parseIpOverride, parseLabel, parseScoringConfig, setIpOverride, parseTagOverrides, saveCategory, saveCategoryWeights, saveScoringConfig, setAlias, setLabel,
  setTagOverrides, dismissSuggestion, dismissedJson, parseDismissal, undismissSuggestion, type AliasTable,
} from "./adminScoring";
import { clearedSessionCookie, createSession, readSession, bumpSessionEpoch, sessionCookie, type Session } from "./auth/session";
import { completeMerge, signIn, type SignInOutcome } from "./auth/signin";
import { IdentityRejected, verifyDiscordToken, verifyGoogleIdToken, verifyTraktToken, type VerifiedIdentity } from "./auth/verify";
import { capFrom, spend, spent } from "./budget";
import { calendarMonth } from "./calendar";
import {
  catalogDeltaJson, catalogPlatformsJson, itemDetailJson, parseCursor, parseItemIds, regionalReleaseDatesJson, RELEASE_DATES_MAX,
  keepTaxonomy, keptTaxonomy, keptTaxonomyEtag, showEpisodesJson,
} from "./catalog/read";
import { LOOKUP_MAX, lookupRefsJson, parseRefs, resolveItem, useSharedIgdbToken } from "./catalog/resolve";
import { runScheduled } from "./cron";
import { shelves } from "./shelves";
import { coverRoute } from "./covers";
import { nowSeconds } from "./d1";
import { DEV_ACCOUNTS, devConnect, devLogin, devLoginAllowed } from "./devLogin";
import type { Env } from "./env";
import { allow, BodyError, clientIp, csrfOk, error, json, preflight, readJson, trustedOrigin, withCors } from "./http";
import {
  applyStateWrite, BadRequest, DEFAULT_DAILY_USER_WRITE_CAP, episodeStateJson, hiddenJson, itemStateJson, parsePrefs,
  parseStateWrite, profileJson, writePrefs,
} from "./me";
import { stateCounts } from "./keptCounts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
const TYPES = new Set(["movie", "show", "game", "book", "boardgame"]);

const AUTH_BODY_MAX = 16 * 1024;
const LOOKUP_BODY_MAX = 256 * 1024;
const DATES_BODY_MAX = 16 * 1024;
const STATE_BODY_MAX = 2 * 1024 * 1024;

/** A short client-side cache for catalog reads. The data changes on the scale of days. */
const CATALOG_CACHE = { "Cache-Control": "public, max-age=300" };
const PRIVATE = { "Cache-Control": "private, no-store" };

type Ctx = { env: Env; request: Request; url: URL; defer: (p: Promise<unknown>) => void };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return preflight(env, request);
    const c: Ctx = { env, request, url: new URL(request.url), defer: (p) => ctx.waitUntil(p) };
    let response: Response;
    try {
      response = await route(c);
    } catch (e) {
      if (e instanceof BodyError) response = error(e.status, "bad-request", e.message);
      else if (e instanceof BadRequest) response = error(400, "bad-request", e.message);
      else {
        console.error("unhandled", { path: c.url.pathname, error: e instanceof Error ? e.stack ?? e.message : String(e) });
        response = error(500, "internal");
      }
    }
    return withCors(env, request, response);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;

async function route(c: Ctx): Promise<Response> {
  const { request, url } = c;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "v1") return error(404, "not-found");
  const method = request.method;
  const [, a, b, d, e] = parts;

  // HEAD too: it is what an uptime check sends.
  if (a === "health" && !b && (method === "GET" || method === "HEAD")) {
    const res = await health(c);
    return method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
  }

  if (a === "catalog" && b === "delta" && method === "GET") {
    const body = await catalogDeltaJson(
      c.env.DB,
      parseCursor(url.searchParams.get("since"), url.searchParams.get("after")),
      Number(url.searchParams.get("limit") ?? 0),
      url.searchParams.get("count") === "1",
    );
    // Not cacheable: the answer for a given cursor changes as items change.
    return json(body, 200, { "Cache-Control": "no-store" });
  }

  if (a === "catalog" && b === "platforms" && method === "GET") {
    // A build is the only costly path, so only a build meets the limiter and
    // the day's cap. Thirty-one countries exist; a normal day builds a handful.
    const body = await catalogPlatformsJson(c.env.DB, url.searchParams.get("region"), async () =>
      (await allow(c.env.RL_RESOLVE, `platforms:${clientIp(request)}`)) && (await spend(c.env.DB, "platform_builds", 40)));
    if (!body) return error(503, "budget-exhausted", "This country's line-up is not built yet. Try again later.");
    return json(body, 200, { "Cache-Control": "public, max-age=3600" });
  }

  if (a === "catalog" && b === "release-dates" && method === "POST" && !d) {
    const body = (await readJson(request, DATES_BODY_MAX)) as { region?: unknown } | null;
    const ids = parseItemIds(body);
    if (!ids) return error(400, "bad-request", `Expected {region, ids: [item id]}, at most ${RELEASE_DATES_MAX}`);
    // Every film asked about is a blob read, so this one meets the limiter on every call.
    if (!(await allow(c.env.RL_RESOLVE, `dates:${clientIp(request)}`))) return error(429, "rate-limited");
    const region = typeof body?.region === "string" ? body.region : null;
    return json(await regionalReleaseDatesJson(c.env.DB, ids, region), 200, { "Cache-Control": "no-store" });
  }

  if (a === "taxonomy" && method === "GET") {
    // Devices ask on every start and every return to the app, so the usual
    // answer is a 304 off one kept row. no-cache: a browser must ask too, or a
    // change waits out its HTTP cache.
    const asked = request.headers.get("If-None-Match");
    const notModified = (etag: string) => new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
    if (asked && asked === (await keptTaxonomyEtag(c.env.DB))) return notModified(asked);
    const { body, etag } = await keptTaxonomy(c.env.DB);
    if (asked === etag) return notModified(etag);
    return json(body, 200, { ETag: etag, "Cache-Control": "no-cache" });
  }

  if (a === "items" && method === "GET") {
    const region = url.searchParams.get("region");
    let body: string | null = null;
    if (b && !d && UUID.test(b)) body = await itemDetailJson(c.env.DB, { id: b.toLowerCase() }, region);
    else if (b && d && !e && TYPES.has(b) && SLUG.test(d)) body = await itemDetailJson(c.env.DB, { type: b, slug: d }, region);
    else return error(400, "bad-request");
    return body ? json(body, 200, CATALOG_CACHE) : error(404, "not-found");
  }

  if (a === "resolve" && method === "GET" && b && d && e) return resolve(c, b, d, e);

  if (a === "lookup" && method === "POST" && !b) {
    const refs = parseRefs(await readJson(request, LOOKUP_BODY_MAX));
    if (!refs) return error(400, "bad-request", `Expected {refs: [{source, type, id}]}, at most ${LOOKUP_MAX}`);
    return json(await lookupRefsJson(c.env.DB, refs), 200, { "Cache-Control": "no-store" });
  }

  if (a === "shows" && d === "episodes" && method === "GET" && b && UUID.test(b)) {
    const body = await showEpisodesJson(c.env.DB, b.toLowerCase());
    return body ? json(body, 200, CATALOG_CACHE) : error(404, "not-found");
  }

  // Books and board games: worker/src/shelves.ts.
  const shelf = await shelves(c, method, a, b, d);
  if (shelf) return shelf;

  // A book cover copied from Hardcover: worker/src/covers.ts.
  const cover = await coverRoute(c, method, parts);
  if (cover) return cover;

  if (a === "search" && b === "games" && method === "GET") return searchGames(c);
  if (a === "browse" && b === "games" && !d && method === "GET") return browseGames(c);
  if (a === "facet" && b === "games" && !d && method === "GET") return facetGames(c);

  if (a === "calendar" && b && !d && method === "GET") {
    const out = await calendarMonth(c.env, b, url.searchParams.get("region"),
      () => allow(c.env.RL_RESOLVE, `calendar:${clientIp(request)}`));
    if (out.ok) return json(out.body, 200, { "Cache-Control": "public, max-age=900" });
    switch (out.reason) {
      case "bad-request": return error(400, "bad-request", "Expected /v1/calendar/YYYY-MM within two years of today");
      case "rate-limited": return error(429, "rate-limited");
      case "budget": return error(503, "budget-exhausted");
      case "provider": return error(502, "provider-unavailable");
    }
  }

  if (a === "auth" && method === "POST") {
    if (b === "google" || b === "trakt" || b === "discord") return authenticate(c, b);
    if (b === "merge") return merge(c);
    if (b === "logout") return logout(c);
  }

  // The pageview beacon. It answers 200 whatever it decided: a page has no use
  // for the outcome, and a script probing the gate learns nothing from it.
  if (a === "t" && b === "pv" && method === "POST" && !d) {
    if (!(await allow(c.env.RL_WRITE, `pv:${clientIp(request)}`))) return json({ ok: true }, 200, PRIVATE);
    const session = await readSession(c.env, request, c.defer);
    let body: unknown = null;
    try { body = await readJson(request, AUTH_BODY_MAX); } catch { /* an unreadable body is a bad request, decided below */ }
    await countPageView(c.env, request, body, !!session);
    return json({ ok: true }, 200, PRIVATE);
  }

  if (a === "me") return me(c, method, b, d);

  if (a === "admin") return admin(c, method, b, d);

  // A test account, on a developer's machine only (src/devLogin.ts). Anywhere
  // else this is a path that does not exist.
  if (a === "dev" && b === "login" && method === "POST" && !d && devLoginAllowed(c.env, url)) {
    const body = (await readJson(request, AUTH_BODY_MAX).catch(() => null)) as { account?: unknown; connect?: unknown } | null;
    const name = typeof body?.account === "string" ? body.account : "smoketest";
    // Connect: add that test account's way in to the signed-in one, through
    // the real signIn(), which is how joining two accounts is tested locally.
    if (body?.connect === true) {
      const session = await readSession(c.env, c.request, c.defer);
      if (!session) return error(401, "unauthorized");
      const joined = await devConnect(c.env, name, session.user);
      if (!joined) return error(400, "bad-request", `account must be one of: ${Object.keys(DEV_ACCOUNTS).join(", ")}`);
      return signInResponse(c, joined);
    }
    const out = await devLogin(c.env, name);
    if (!out) return error(400, "bad-request", `account must be one of: ${Object.keys(DEV_ACCOUNTS).join(", ")}`);
    return signInResponse(c, { kind: "signed-in", ...out });
  }

  // A real route asked with the wrong verb: say which verbs it takes.
  const allowed = methodsFor(parts.slice(1).join("/"));
  if (allowed) return json({ error: "method-not-allowed" }, 405, { Allow: allowed, "Cache-Control": "no-store" });

  return error(404, "not-found");
}

/**
 * The public routes and the verbs each takes, for the 405 above. `/v1/me` and
 * `/v1/admin` answer for themselves, and must: an admin route says 404 to
 * anybody who is not an admin, whatever the verb.
 */
const PUBLIC_ROUTES: [RegExp, string][] = [
  [/^health$/, "GET, HEAD"],
  [/^catalog\/(delta|platforms)$/, "GET"],
  [/^catalog\/release-dates$/, "POST"],
  [/^taxonomy$/, "GET"],
  [/^items\/[^/]+(\/[^/]+)?$/, "GET"],
  [/^resolve\/[^/]+\/[^/]+\/[^/]+$/, "GET"],
  [/^lookup$/, "POST"],
  [/^shows\/[^/]+\/episodes$/, "GET"],
  [/^search\/(games|books|boardgames)$/, "GET"],
  [/^browse\/(games|books|boardgames)$/, "GET"],
  [/^facet\/(games|books)$/, "GET"],
  [/^features$/, "GET"],
  [/^cover\/hardcover\/.+$/, "GET, HEAD"],
  [/^calendar\/[^/]+$/, "GET"],
  [/^auth\/(google|trakt|discord|merge|logout)$/, "POST"],
  [/^t\/pv$/, "POST"],
];

function methodsFor(path: string): string | null {
  return PUBLIC_ROUTES.find(([shape]) => shape.test(path))?.[1] ?? null;
}

// ── Public ───────────────────────────────────────────────────────────────────

async function health(c: Ctx): Promise<Response> {
  // Is D1 answering, and how much of today's budgets is gone. `hardcover` is
  // requests against Hardcover's 5,000 a day (capped at 4,000 here), `covers`
  // the covers copied from it today.
  const fetches = await spent(c.env.DB, "fetch");
  const userWrites = await spent(c.env.DB, "user_writes");
  const hardcover = await spent(c.env.DB, "hardcover");
  const covers = await spent(c.env.DB, "cover");
  // Providers this isolate has stopped calling, as the old site's health had.
  // ⚠️ One isolate's view: `{}` here says this isolate has seen no trouble, not
  // that TMDB and IGDB are up. A host listed here IS being refused, though.
  const openProviderCircuits = providerBreakerSnapshot();
  return json({ ok: true, time: nowSeconds(), today: { fetches, userWrites, hardcover, covers }, openProviderCircuits }, 200, { "Cache-Control": "no-store" });
}

async function resolve(c: Ctx, source: string, type: string, id: string): Promise<Response> {
  // The limiter is consulted only if the title has to be FETCHED.
  const out = await resolveItem(c.env, source, type, id, () => allow(c.env.RL_RESOLVE, `resolve:${clientIp(c.request)}`));
  if (out.ok) return json({ id: out.id, created: out.created }, 200, { "Cache-Control": "no-store" });
  switch (out.reason) {
    case "bad-request": return error(400, "bad-request");
    case "rate-limited": return error(429, "rate-limited");
    case "not-found": return error(404, "not-found");
    // The day's provider budget is spent. Not the caller's fault and not
    // retryable today, so 503 with the reason rather than a 429.
    case "budget": return error(503, "budget-exhausted", "The catalog cannot fetch new titles until tomorrow (UTC).");
    case "provider": return error(502, "provider-unavailable");
  }
}

async function searchGames(c: Ctx): Promise<Response> {
  // Angle brackets are dropped before anything else sees the term. No title
  // needs one, and IGDB's edge refuses a request carrying a tag: "<script>"
  // came back as an error from the provider, which reads as IGDB being down
  // and counts towards shutting it off for everybody (SM66, 2026-10-11).
  const q = (c.url.searchParams.get("q") ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 2) return error(400, "bad-request", "q must be at least two characters");

  // The edge cache answers a repeat of the same search without spending an IGDB
  // call. Keyed on the normalised term, not the raw url.
  const cacheKey = new Request(`https://cache.fandex.internal/search/games?q=${encodeURIComponent(q.toLowerCase())}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, hit);

  if (!(await allow(c.env.RL_RESOLVE, `search:${clientIp(c.request)}`))) return error(429, "rate-limited");

  useSharedIgdbToken(c.env);
  let rows: any[];
  try {
    rows = await searchIgdbGames(q, 20);
  } catch (e) {
    console.warn("igdb_search_failed", { error: e instanceof Error ? e.message : String(e) });
    return error(502, "provider-unavailable");
  }
  const results = rows
    .filter((g) => g?.id && g?.name)
    .map((g) => ({
      source: "igdb",
      sourceId: String(g.id),
      type: "game",
      title: String(g.name),
      releaseDate: igdbReleaseDate(g),
      posterUrl: igdbImageUrl(g.cover?.image_id),
      votes: typeof g.total_rating_count === "number" ? g.total_rating_count : 0,
      rating: typeof g.total_rating === "number" ? Math.round(g.total_rating) : null,
    }));
  const response = json({ results }, 200, { "Cache-Control": "public, max-age=3600" });
  // Never cache an empty answer for long: an empty result during an IGDB hiccup
  // would pin "no such game" in place for the whole TTL.
  if (results.length) c.defer(cache.put(cacheKey, response.clone()));
  return response;
}

/** An IGDB game as the app's provider card, the shape /v1/search/games answers with. */
function gameCard(g: any) {
  return {
    source: "igdb",
    sourceId: String(g.id),
    type: "game",
    title: String(g.name),
    releaseDate: igdbReleaseDate(g),
    posterUrl: igdbImageUrl(g.cover?.image_id) ?? igdbImageUrl(g.artworks?.[0]?.image_id, "t_720p") ?? igdbImageUrl(g.screenshots?.[0]?.image_id, "t_720p"),
    votes: typeof g.total_rating_count === "number" ? g.total_rating_count : 0,
    rating: typeof g.total_rating === "number" ? Math.round(g.total_rating) : null,
  };
}

/** Pages of upcoming games a browse asks for. The old site's feed went ten pages deep at most. */
const BROWSE_GAME_PAGES = 10;
/** The old site's browse window: about eighteen months ahead (src/lib/discoverFeed.ts, DAYS_WINDOW). */
const BROWSE_WINDOW_DAYS = 550;

/** "Recent" is the old site's trending games: out in the last sixty days (discoverFeed.ts, fetchTrendingGames). */
const RECENT_GAME_DAYS = 60;

/**
 * Upcoming games, most anticipated first, forty a page: the Search screen's
 * feed when nothing is typed, beyond what the catalog holds. With
 * `window=recent`, the games out in the last sixty days, most rated first:
 * Home's "Popular right now". The old site's
 * IGDB page (discoverFeed.ts, igdbGamePage), card fields only. Films and shows
 * the device asks TMDB for itself. Nothing is stored and no D1 row is read:
 * the edge cache answers a repeat for six hours, which is what makes a
 * crawler or a busy day cost one IGDB call per page.
 */
async function browseGames(c: Ctx): Promise<Response> {
  const page = Number(c.url.searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > BROWSE_GAME_PAGES) return error(400, "bad-request", `page must be 1 to ${BROWSE_GAME_PAGES}`);
  // Keyed by the day, so the window moves with it.
  const day = new Date().toISOString().slice(0, 10);
  const recent = c.url.searchParams.get("window") === "recent";
  const cacheKey = new Request(`https://cache.fandex.internal/browse/games?day=${day}&page=${page}&recent=${recent ? 1 : 0}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(hit.body, hit);
  if (!(await allow(c.env.RL_RESOLVE, `browse:${clientIp(c.request)}`))) return error(429, "rate-limited");

  useSharedIgdbToken(c.env);
  const now = Math.floor(Date.now() / 1000);
  const rows = recent
    ? await discoverIgdbUpcoming(now - RECENT_GAME_DAYS * 86_400, now, 40, (page - 1) * 40, "total_rating_count", "card")
    : await discoverIgdbUpcoming(now, now + BROWSE_WINDOW_DAYS * 86_400, 40, (page - 1) * 40, "hypes", "card");
  const results = rows.filter((g) => g?.id && g?.name).map(gameCard);
  const response = json({ results, page, more: results.length === 40 && page < BROWSE_GAME_PAGES }, 200, { "Cache-Control": "public, max-age=3600" });
  // discoverIgdbUpcoming answers [] for a failure too: never keep an empty page.
  if (results.length) c.defer(caches.default.put(cacheKey, new Response(response.clone().body, { headers: { ...Object.fromEntries(response.headers), "Cache-Control": "public, max-age=21600" } })));
  return response;
}

/**
 * A tag's or a studio's games, most rated first: what a facet page adds from
 * IGDB beyond the catalog. The old site did this for tags and cached it for a
 * week, because IGDB's contains-match over themes, keywords and genres took
 * 4.3 to 4.7 s (src/lib/detail/publicFacetDetail.ts). Same week here, at the
 * edge. A failed call is answered 502 and not cached; a tag IGDB knows no games
 * for is cached as empty, so it is not asked again on every visit.
 */
async function facetGames(c: Ctx): Promise<Response> {
  const kind = c.url.searchParams.get("kind");
  const label = (c.url.searchParams.get("q") ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if ((kind !== "tag" && kind !== "studio" && kind !== "franchise") || label.length < 2) return error(400, "bad-request", "kind must be tag, studio or franchise, q at least two characters");
  const cacheKey = new Request(`https://cache.fandex.internal/facet/games?kind=${kind}&q=${encodeURIComponent(label.toLowerCase())}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(hit.body, hit);
  if (!(await allow(c.env.RL_RESOLVE, `facet:${clientIp(c.request)}`))) return error(429, "rate-limited");

  useSharedIgdbToken(c.env);
  let rows: any[];
  try {
    rows = await discoverIgdbFacetCards(kind, label, 40);
  } catch (e) {
    console.warn("igdb_facet_failed", { error: e instanceof Error ? e.message : String(e) });
    return error(502, "provider-unavailable");
  }
  const results = rows.filter((g) => g?.id && g?.name).map(gameCard);
  const response = json({ results }, 200, { "Cache-Control": "public, max-age=3600" });
  c.defer(caches.default.put(cacheKey, new Response(response.clone().body, { headers: { ...Object.fromEntries(response.headers), "Cache-Control": "public, max-age=604800" } })));
  return response;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

function signInResponse(c: Ctx, out: SignInOutcome | { kind: "merged"; token: string; user: Session["user"] }): Response {
  switch (out.kind) {
    case "provider-taken":
      return error(409, "provider-taken", undefined, { provider: out.provider, conflict: out.conflict });
    case "merge-required":
      return error(409, "merge-required", undefined, { mergeToken: out.mergeToken, conflicts: out.conflicts, mine: out.mine, theirs: out.theirs, provider: out.provider });
    default: {
      const headers: Record<string, string> = { ...PRIVATE };
      // A browser client on an origin we serve also gets the cookie. The app has
      // no cookie jar worth trusting and uses the token in the body.
      if (trustedOrigin(c.env, c.request)) headers["Set-Cookie"] = sessionCookie(out.token);
      return json({ outcome: out.kind, token: out.token, user: out.user }, 200, headers);
    }
  }
}

async function authenticate(c: Ctx, provider: "google" | "trakt" | "discord"): Promise<Response> {
  if (!(await allow(c.env.RL_AUTH, `auth:${clientIp(c.request)}`))) return error(429, "rate-limited");
  const body = (await readJson(c.request, AUTH_BODY_MAX)) as Record<string, unknown> | null;
  const credential = provider === "google" ? body?.idToken : body?.accessToken;
  if (typeof credential !== "string" || !credential) return error(400, "bad-request", "Missing credential");
  // The secret behind the token's nonce (auth/verify.ts). Required: a Google
  // token on its own is never enough.
  const nonce = provider === "google" ? body?.nonce : "";
  if (typeof nonce !== "string" || (provider === "google" && !nonce)) return error(400, "bad-request", "Missing nonce");

  let identity: VerifiedIdentity;
  try {
    identity = provider === "google"
      ? await verifyGoogleIdToken(c.env, credential, nonce)
      : provider === "discord"
        ? await verifyDiscordToken(c.env, credential)
        : await verifyTraktToken(c.env, credential);
  } catch (e) {
    if (e instanceof IdentityRejected) return error(401, "identity-rejected", e.message);
    console.warn("identity_check_failed", { provider, error: e instanceof Error ? e.message : String(e) });
    return error(502, "provider-unavailable");
  }

  // The link target is whoever this request is ALREADY signed in as. Never a
  // user id from the body.
  const session = await readSession(c.env, c.request, c.defer);
  if (session && !csrfOk(c.env, c.request, session)) return error(403, "forbidden");
  return signInResponse(c, await signIn(c.env, identity, session?.user ?? null));
}

async function merge(c: Ctx): Promise<Response> {
  const session = await readSession(c.env, c.request, c.defer);
  if (!session) return error(401, "unauthorized");
  if (!csrfOk(c.env, c.request, session)) return error(403, "forbidden");
  const body = (await readJson(c.request, AUTH_BODY_MAX)) as Record<string, unknown> | null;
  const resolution = body?.resolution;
  // No default. Which side wins is the person's decision, stated explicitly.
  if (resolution !== "keep-mine" && resolution !== "keep-theirs") return error(400, "bad-request", "resolution is required");
  if (typeof body?.mergeToken !== "string") return error(400, "bad-request", "mergeToken is required");

  const out = await completeMerge(c.env, session.user, body.mergeToken, resolution as MergeResolution);
  if (out.kind === "invalid") return error(400, "merge-invalid", "The merge request expired. Sign in again to restart it.");
  return signInResponse(c, out);
}

async function logout(c: Ctx): Promise<Response> {
  const session = await readSession(c.env, c.request, c.defer);
  if (session) {
    if (!csrfOk(c.env, c.request, session)) return error(403, "forbidden");
    // Bumping the epoch signs out EVERY device, which is what "log out" has to
    // mean while a token cannot be individually revoked.
    await bumpSessionEpoch(c.env.DB, session.user.userId);
  }
  return json({ ok: true }, 200, { ...PRIVATE, "Set-Cookie": clearedSessionCookie() });
}

// ── Your rows ────────────────────────────────────────────────────────────────

/** The profile, with `admin: true` for an admin and nothing added for anybody else. */
function withAdminFlag(env: Env, userId: string, profile: string): string {
  return isAdmin(env, userId) ? `${profile.slice(0, -1)},"admin":true}` : profile;
}

/**
 * The admin pages' routes. A caller who is not an admin gets the same 404 as a
 * path that does not exist, signed in or not.
 */
async function admin(c: Ctx, method: string, b?: string, d?: string): Promise<Response> {
  const session = await readSession(c.env, c.request, c.defer);
  if (!session || !isAdmin(c.env, session.user.userId)) return error(404, "not-found");
  if (!csrfOk(c.env, c.request, session)) return error(403, "forbidden");
  if (b === "analytics" && method === "GET") {
    return json(await analyticsSnapshot(c.env.DB, parseDays(c.url.searchParams.get("days"))), 200, PRIVATE);
  }
  if (b === "users" && method === "GET") {
    return json(await usersSnapshot(c.env.DB, parseDays(c.url.searchParams.get("days"))), 200, PRIVATE);
  }

  // The Scoring page's writes. Each answers with the taxonomy as it now is, so
  // the page redraws from what was stored and not from what it sent.
  const db = c.env.DB;
  // Builds and keeps it again, so every device's next check sees the write.
  const saved = async () => json((await keepTaxonomy(db)).body, 200, PRIVATE);
  if (b === "scoring" && method === "PUT" && !d) {
    await saveScoringConfig(db, parseScoringConfig(await readJson(c.request, AUTH_BODY_MAX)));
    return saved();
  }
  if (b === "categories") {
    if (method === "PUT" && !d) {
      await saveCategoryWeights(db, parseCategoryWeights(await readJson(c.request, AUTH_BODY_MAX)));
      return saved();
    }
    if (method === "POST" && !d) {
      await saveCategory(db, parseCategory(await readJson(c.request, AUTH_BODY_MAX)));
      return saved();
    }
    if (method === "DELETE" && d) {
      await deleteCategory(db, d);
      return saved();
    }
  }
  const q = c.url.searchParams;
  if (b === "tag-overrides" && !d) {
    if (method === "POST") {
      const { tagKeys, categoryId } = parseTagOverrides(await readJson(c.request, LOOKUP_BODY_MAX));
      await setTagOverrides(db, tagKeys, categoryId);
      return saved();
    }
    if (method === "DELETE") {
      await clearTagOverride(db, q.get("tagKey") ?? "");
      return saved();
    }
  }
  // One pair of routes for both alias tables: tags that are one tag, franchises that are one franchise.
  if ((b === "tag-aliases" || b === "ip-aliases") && !d) {
    const table: AliasTable = b === "tag-aliases" ? "tag_alias" : "ip_alias";
    if (method === "POST") {
      const { canonical, members, displayLabel } = parseAliases(await readJson(c.request, AUTH_BODY_MAX));
      for (const m of members) if (m !== canonical) await setAlias(db, table, m, canonical);
      if (displayLabel) await setLabel(db, table === "tag_alias" ? "tag" : "ip", canonical, displayLabel);
      return saved();
    }
    if (method === "DELETE") {
      const alias = q.get("alias");
      const canonical = q.get("canonical");
      if (alias) await deleteAlias(db, table, alias);
      else if (canonical) await deleteBundle(db, table, canonical);
      else return error(400, "bad-request", "alias or canonical required");
      return saved();
    }
  }
  if (b === "ip-overrides" && !d) {
    if (method === "POST") {
      await setIpOverride(db, parseIpOverride(await readJson(c.request, AUTH_BODY_MAX)));
      return saved();
    }
    if (method === "DELETE") {
      await clearIpOverride(db, q.get("mediaItemId"), q.get("ipKey"));
      return saved();
    }
  }
  if (b === "labels" && !d) {
    if (method === "POST") {
      const l = parseLabel(await readJson(c.request, AUTH_BODY_MAX));
      await setLabel(db, l.kind, l.key, l.label);
      return saved();
    }
    if (method === "DELETE") {
      await clearLabel(db, q.get("kind"), q.get("key"));
      return saved();
    }
  }
  // The Review section's own route: the proposals somebody said no to. The
  // proposals are worked out on the device; accepting one uses the routes above.
  // Each call answers with the whole list, which is short.
  if (b === "suggestions" && d === "dismissed") {
    if (method === "POST") {
      const body = (await readJson(c.request, AUTH_BODY_MAX)) as { kind?: unknown; ref?: unknown } | null;
      const no = parseDismissal(body?.kind, body?.ref);
      await dismissSuggestion(db, no.kind, no.ref);
    } else if (method === "DELETE") {
      const no = parseDismissal(q.get("kind"), q.get("ref"));
      await undismissSuggestion(db, no.kind, no.ref);
    } else if (method !== "GET") {
      return error(404, "not-found");
    }
    return json(await dismissedJson(db), 200, PRIVATE);
  }
  return error(404, "not-found");
}

async function me(c: Ctx, method: string, b?: string, d?: string): Promise<Response> {
  const session = await readSession(c.env, c.request, c.defer);
  // An auth gate must ASK, never disappear: 401 with a code the client turns
  // into a sign-in prompt, never an empty 200 that reads as "you have nothing".
  if (!session) return error(401, "unauthorized");
  if (!csrfOk(c.env, c.request, session)) return error(403, "forbidden");
  const { userId } = session.user;
  const db = c.env.DB;

  if (!b) {
    if (method === "GET") {
      const body = await profileJson(db, userId);
      return body ? json(withAdminFlag(c.env, userId, body), 200, PRIVATE) : error(401, "unauthorized");
    }
    if (method === "DELETE") {
      const result = await deleteAccount(db, userId);
      return json({ deleted: true, ...result }, 200, { ...PRIVATE, "Set-Cookie": clearedSessionCookie() });
    }
  }

  if (b === "prefs" && method === "PUT") {
    await writePrefs(db, userId, parsePrefs(await readJson(c.request, AUTH_BODY_MAX)));
    const body = await profileJson(db, userId);
    return json(body ? withAdminFlag(c.env, userId, body) : body, 200, PRIVATE);
  }

  if (b === "state") {
    if (method === "GET") {
      if (d === "items") return json(await itemStateJson(db, userId, c.url.searchParams), 200, PRIVATE);
      if (d === "episodes") return json(await episodeStateJson(db, userId, c.url.searchParams), 200, PRIVATE);
      if (d === "hidden") return json(await hiddenJson(db, userId), 200, PRIVATE);
      if (d === "counts") return json(await stateCounts(db, userId), 200, PRIVATE);
    }
    if (method === "PUT" && !d) {
      if (!(await allow(c.env.RL_WRITE, `write:${userId}`))) return error(429, "rate-limited");
      const write = parseStateWrite(await readJson(c.request, STATE_BODY_MAX));
      const result = await applyStateWrite(c.env, userId, write);
      if (!result.ok) return error(503, "budget-exhausted", "Fandex cannot save more changes until tomorrow (UTC).");
      return json(result, 200, PRIVATE);
    }
  }

  if (b === "identities" && d && method === "DELETE") {
    if (!(await allow(c.env.RL_WRITE, `write:${userId}`))) return error(429, "rate-limited");
    const out = await disconnectIdentity(db, userId, d.toLowerCase(),
      (rows) => spend(db, "user_writes", capFrom(c.env.DAILY_USER_WRITE_CAP, DEFAULT_DAILY_USER_WRITE_CAP), rows));
    if (!out.ok) {
      if (out.reason === "not-connected") return error(404, "not-connected");
      if (out.reason === "only-login") return error(409, "only-login", "Cannot disconnect your only login method");
      return error(503, "budget-exhausted", "Fandex cannot save more changes until tomorrow (UTC).");
    }
    // Every token minted before this is dead, the caller's included: one of
    // them may have come from the identity that just went. The answer carries
    // the replacement, signed in through an identity that is still there.
    await bumpSessionEpoch(db, userId);
    const user = { userId, provider: out.remaining.provider, displayName: out.remaining.displayName };
    const token = await createSession(c.env, user);
    const headers: Record<string, string> = { ...PRIVATE };
    if (trustedOrigin(c.env, c.request)) headers["Set-Cookie"] = sessionCookie(token);
    return json({ ok: true, removedRows: out.removedRows, token, user }, 200, headers);
  }
  if (b === "export" && method === "GET") {
    const body = await buildAccountExportJson(db, userId);
    if (!body) return error(401, "unauthorized");
    return json(body, 200, {
      ...PRIVATE,
      "Content-Disposition": `attachment; filename="fandex-export-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  }

  return error(404, "not-found");
}
