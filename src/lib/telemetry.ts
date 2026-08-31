import { getDb } from "@/lib/db";

// Self-hosted traffic telemetry (2026-08-19). No Google Analytics, no Plausible,
// no third-party script, no cookie, no IP stored. Everything here is a counter
// in our own SQLite, written by our own beacon.
//
// ── What it exists to answer ────────────────────────────────────────────────
//
// Exactly two questions, both from H3.8's thresholds:
//   1. "Are we at 10,000 pageviews/month yet?"  → the ads gate.
//   2. "Are we at 3,500 sustained weekly actives?" → the freemium gate.
// Plus the split that decides which of those is even worth pursuing: ads
// monetize anonymous SEO visitors, a subscription monetizes signed-in ones, and
// nothing in the schema could previously tell those two populations apart.
//
// ── Why counters and not events ─────────────────────────────────────────────
//
// See migration 17's comment. One row per pageview is the shape that grew the
// database to 2,487 MB on 2026-07-22; one row per (day, dimension) is bounded by
// the dimension set instead of by traffic.
//
// ── What it deliberately cannot tell you ────────────────────────────────────
//
// **Unique anonymous visitors.** Counting those without a cookie means storing a
// daily-salted hash of IP+UA per visitor per day, which is both a per-visitor row
// (the growth shape above) and a much harder privacy argument than "we increment
// an integer". Neither gate needs it: the ads threshold is denominated in
// PAGEVIEWS, and the freemium threshold in signed-in actives, which we count
// exactly from users.last_seen_at. If a future ad network asks for uniques, take
// the number from their own tag rather than building an estimator here.

export type RefClass = "search" | "social" | "internal" | "direct" | "other";

const REF_CLASSES: RefClass[] = ["search", "social", "internal", "direct", "other"];

/** UTC calendar day, 'YYYY-MM-DD'. The only time resolution stored anywhere here. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function dayNDaysAgo(days: number, now: Date = new Date()): string {
  return utcDay(new Date(now.getTime() - days * 86_400_000));
}

// ── Path templating ─────────────────────────────────────────────────────────

/** Root-level dynamic segments that are real media types (see AGENTS.md's repo map). */
const MEDIA_TYPES = new Set(["game", "movie", "show"]);

/** Routes counted under their own name, with no dynamic part to collapse. */
const STATIC_PATHS = new Set([
  "/", "/calendar", "/dashboard", "/discover", "/insights", "/insights/facet",
  "/library", "/wishlist", "/profile", "/settings", "/login", "/item/debug",
]);

/**
 * Collapse a raw pathname to a bounded, non-identifying route template.
 *
 * This is the whole reason `page_view_daily` can't grow without bound: a raw
 * path would mint a new row per tag slug per day (and per crafted 404 path, which
 * would hand any visitor a write amplifier). Anything unrecognized collapses to
 * "other", so the key set is fixed by this function rather than by the internet.
 *
 * Returns null for paths that must never be counted at all.
 */
export function normalizePathKey(rawPath: string): string | null {
  let path = rawPath.split("?")[0].split("#")[0].toLowerCase();
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";

  // Never counted: our own APIs, framework internals, files. The beacon only
  // ever reports page routes, but it is a public endpoint and the body is a
  // client-supplied string, so this is a filter and not an assumption.
  if (/^\/(api|_next|\.well-known)(\/|$)/.test(path)) return null;
  if (/\.[a-z0-9]{2,5}$/.test(path)) return null;
  // The admin surface is not traffic; counting it would let this dashboard
  // inflate the very numbers it reports.
  if (path === "/dev" || path.startsWith("/dev/")) return null;

  if (STATIC_PATHS.has(path)) return path;

  const seg = path.slice(1).split("/");

  if (seg.length === 2) {
    if (seg[0] === "person") return "/person/[slug]";
    if (seg[0] === "tag") return "/tag/[slug]";
    if (seg[0] === "studio") return "/studio/[slug]";
    if (seg[0] === "calendar") return "/calendar/[month]";
    // THE canonical item url since 2026-08-21: /{type}/{slug}. (A bare
    // /{type}/{uuid} also lands here and redirects.) The key string still says
    // `[id]` on purpose — renaming it would split every item page's history
    // across two keys in the dashboard for no gain.
    if (MEDIA_TYPES.has(seg[0])) return "/[type]/[id]";
  }
  if (seg.length === 3) {
    if (seg[0] === "legal") return "/legal/[locale]/[doc]";
    // The LEGACY item url, /{type}/{uuid}/{slug}, which now only redirects. It
    // was the real one until 2026-08-21 and is still what every shared link and
    // every indexed url points at, so it keeps counting under the same key.
    //
    // This arm was missing until 2026-08-20, when it was the canonical shape, so
    // every one of the 2,022 item pages counted as "other" and the top-pages
    // panel could not show a single item view. Lesson, and it is the reason both
    // arms are still here: template a route against the SITEMAP, not against the
    // route folder's name.
    if (MEDIA_TYPES.has(seg[0])) return "/[type]/[id]";
  }

  return "other";
}

// ── Crawler filtering ───────────────────────────────────────────────────────

/**
 * Known-crawler user agents, matched case-insensitively.
 *
 * ⚠️ The comment that used to sit on the beacon route claimed a client beacon
 * "excludes crawlers for free". That is only true of crawlers that fetch HTML
 * and stop. Googlebot, AhrefsBot, Semrush and most modern SEO tools RENDER the
 * page, so they execute the bundle and POST here exactly like a browser.
 * Measured on prod 2026-08-20: 4,314 of 5,365 pageviews in 30 days were
 * /person, /tag and /studio views against 14 homepage views, which is a crawl
 * of the facet long tail and not a person. The ads gate was reading ~80% bot.
 *
 * Precision matters more than recall here. A false positive silently drops a
 * real visitor from the only number that gates the ads decision, so every
 * generic token below is anchored: `bot` must be followed by a delimiter or end
 * of string, or "CUBOT" (a real phone brand that appears in real Android user
 * agents) would classify every one of its owners as a crawler.
 */
const CRAWLER_PATTERNS: RegExp[] = [
  // A crawler names a version: "Googlebot/2.1", "PetalBot;", "SeoBot)". The
  // delimiter set deliberately excludes whitespace, because "CUBOT NOTE 20" is
  // a real Android phone and "BOT " with a trailing space is all it takes to
  // classify every one of its owners as a crawler. A test asserts that.
  /\bbot\b|bot[/;)+]|^bot/i,
  // "Scrapy" is the one big scraping framework whose name contains neither
  // "scraper" nor "bot", so the stem here is deliberately not `scrap`: that
  // would also match "scrapbook".
  /crawl|spider|slurp|scraper|scrapy|heritrix|nutch|ia_archiver/i,
  // Headless engines: Lighthouse, most rendering scrapers, and anything driving
  // Chrome or Firefox without a display. ⚠️ Chrome's new headless mode no longer
  // says "HeadlessChrome", and nothing here can catch that one.
  /headlesschrome|phantomjs|puppeteer|playwright|selenium|chrome-lighthouse|pagespeed|gtmetrix/i,
  // Scripted clients. These do not run JS, so they can only reach this endpoint
  // by POSTing to it directly.
  /python-requests|python-urllib|aiohttp|go-http-client|java\/|okhttp|apache-httpclient|libwww-perl|^curl|^wget|axios\/|node-fetch|undici|got \(|guzzle|postmanruntime|insomnia|httpie|restsharp|^deno|^bun\//i,
  // Uptime and availability monitors. They hit the same few pages forever, so
  // left uncounted they read as a small, extremely loyal audience.
  /uptimerobot|pingdom|statuscake|betteruptime|site24x7|newrelic|datadog|checkly/i,
  // Internet-wide scanners, which mostly hit "/" and paths that do not exist.
  /censys|shodan|zgrab|masscan|internet-?measurement|expanse|paloaltonetworks|netcraft/i,
  // Link unfurlers and social preview fetchers.
  // "whatsapp" carries a slash because the unfurler is "WhatsApp/2.x" while the
  // in-app browser is a normal mobile UA that must keep counting.
  /facebookexternalhit|meta-external|twitterbot|slackbot|discordbot|telegrambot|whatsapp\/|embedly|quora link preview|skypeuripreview|vkshare|redditbot/i,
  // AI training and answer-engine fetchers, which mostly do not identify as "bot".
  /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|claude-searchbot|anthropic-ai|ccbot|perplexity|bytespider|amazonbot|applebot|google-extended|cohere-ai|diffbot|omgili|timpi|imagesift|firecrawl/i,
  // Named SEO suites worth listing explicitly: several use a UA that would not
  // otherwise match, and they are the heaviest facet-page crawlers.
  /ahrefs|semrush|mj12|dotbot|blexbot|dataforseo|screaming frog|sitebulb|serpstat|petal|barkrowler|zoominfo|seekport|megaindex|seokicks|linkdex|majestic|sistrix|oncrawl|oncrawler/i,
  // Search-engine fetchers whose UA omits "bot" entirely. `bingpreview` and
  // `mediapartners` (AdSense) are the two that reach a rendered page.
  //
  // ⚠️ The bare engine names are deliberately absent. "yandex", "sogou",
  // "coccoc", "naver" and "daum" each appear in a REAL browser or in-app browser
  // used by real people (YandexSearch, Sogou Explorer, Cốc Cốc, the NAVER and
  // Daum apps), so matching the engine name would silently delete a region's
  // worth of visitors from the only number gating the ads decision.
  //
  // Their CRAWLERS are named instead, one at a time. YandexBot and Sogou's
  // spider fall out of the `bot` and `spider` arms above; Daumoa and Yeti (Naver)
  // match neither, and were only caught here because the test asserting "the
  // crawler is still blocked" failed on them. Assert both halves of a precision
  // decision, or the half you assumed will be the wrong one. `qwantify` is
  // Qwant's crawler specifically, which is why it is safe where a bare "qwant"
  // would not be; `yeti` carries a slash for the same reason.
  /bingpreview|mediapartners|google-read-aloud|google-inspectiontool|google-site-verification|googleother|feedfetcher|qwantify|daumoa|yeti\//i,
];

/**
 * True when a user agent is a crawler, a headless engine, or a scripted client.
 *
 * A missing or empty user agent counts as a crawler: every real browser sends
 * one, and an empty string is the cheapest possible forged request against a
 * public write endpoint.
 */
export function isCrawlerUserAgent(ua: string | null | undefined): boolean {
  const s = ua?.trim();
  if (!s) return true;
  return CRAWLER_PATTERNS.some((re) => re.test(s));
}

/**
 * First UTC day whose pageview counts exclude crawlers.
 *
 * `isCrawlerUserAgent` landed on prod at 2026-08-20T18:14Z, so 2026-08-20 is a
 * MIXED day (unfiltered until the evening), and 2026-08-21 is the first clean
 * one. Everything before it is the ~80%-bot era measured in the pv route's
 * comment: 4,314 of 5,365 pageviews in the 30 days to 2026-08-20 were facet-page
 * crawls, against fourteen homepage views.
 *
 * ⚠️ EVERY read in this file starts here or later, via `trustedFrom`. That was
 * not true until 2026-08-31, and the gap was not academic: prod held 5,792
 * pre-filter pageviews (5,769 of them on the single crawl day 2026-08-20)
 * against 416 real ones, so the ads gate on /dev/analytics read **62% when the
 * honest figure was 4%**. The KPI route had excluded them since 2026-08-29 and
 * the dashboard had not, which is the asymmetry this constant now closes.
 *
 * The counters are never pruned (dbPrune.ts touches media_items and its cascades
 * only, and nothing else deletes from these tables), so the split is a
 * deliberate exclusion and not a retention window. The excluded total is still
 * reported, by `excludedPreFilter` and by the KPI contract's `simRuns`: this
 * drops the numbers from the totals, never the evidence from the page.
 */
export const CRAWLER_FILTER_FROM_DAY = "2026-08-21";

/**
 * Clamp a read's start day to the first day whose counts can be trusted.
 *
 * ISO days sort lexicographically, so this is a plain string max. Inert for any
 * window that begins after the filter shipped, which is every window from
 * 2026-09-20 onward — at which point this becomes dead weight that still costs
 * nothing, and removing it would silently re-admit the dirty days to a 90-day
 * or 365-day range.
 */
function trustedFrom(fromDay: string): string {
  return fromDay > CRAWLER_FILTER_FROM_DAY ? fromDay : CRAWLER_FILTER_FROM_DAY;
}

// ── Referrer classification ─────────────────────────────────────────────────

const SEARCH_HOSTS = [
  "google.", "bing.", "duckduckgo.", "ecosia.", "yahoo.", "startpage.",
  "search.brave.", "qwant.", "yandex.", "baidu.", "mojeek.", "search.marginalia.",
];
const SOCIAL_HOSTS = [
  "reddit.", "twitter.", "x.com", "t.co", "facebook.", "instagram.",
  "mastodon.", "bsky.", "bluesky.", "youtube.", "tiktok.", "linkedin.",
  "discord.", "pinterest.", "tumblr.", "threads.",
];

/**
 * Bucket a referrer into one of five classes. Only the class is ever stored,
 * never the referring URL, which can carry a search query or a private forum path.
 *
 * `selfHost` collapses in-app navigation to "internal" so it can't be mistaken for
 * acquisition. That matters more here than on a normal site: the beacon fires on
 * every client-side route change, and App Router transitions carry the previous
 * Fandex page as document.referrer.
 */
export function classifyReferrer(referrer: string | null | undefined, selfHost?: string | null): RefClass {
  const ref = referrer?.trim();
  if (!ref) return "direct";

  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (!host) return "other";

  const self = selfHost?.toLowerCase().replace(/^www\./, "");
  if (self && (host === self || host.endsWith(`.${self}`))) return "internal";
  if (SEARCH_HOSTS.some((h) => host.startsWith(h) || host.includes(`.${h}`))) return "search";
  if (SOCIAL_HOSTS.some((h) => host === h.replace(/\.$/, "") || host.startsWith(h) || host.includes(`.${h}`))) return "social";
  return "other";
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Increment the two counters for one pageview. Both statements are UPSERTs, so a
 * day's first view creates its row and every later one costs a single integer
 * update: no read-modify-write, no lock held across a round trip.
 *
 * Best-effort by construction at the call site: a telemetry failure must never
 * surface to a visitor, and the caller swallows errors. Nothing here throws on
 * ordinary input; a bad path is filtered by normalizePathKey upstream.
 */
export function recordPageView(opts: {
  pathKey: string;
  authed: boolean;
  refClass: RefClass;
  now?: Date;
}): void {
  const db = getDb();
  const day = utcDay(opts.now);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO page_view_daily (day, path_key, authed, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, path_key, authed) DO UPDATE SET count = count + 1`,
    ).run(day, opts.pathKey, opts.authed ? 1 : 0);
    db.prepare(
      `INSERT INTO referrer_daily (day, ref_class, count) VALUES (?, ?, 1)
       ON CONFLICT(day, ref_class) DO UPDATE SET count = count + 1`,
    ).run(day, opts.refClass);
  });
  tx();
}

/**
 * Increment the count of beacons rejected as crawler traffic for today.
 *
 * One row per day, one integer, no user agent stored (migration 26 explains
 * why). Called from the pv route's rejection arm, which runs before the request
 * body is read, so a crawl still costs a single UPSERT and nothing else.
 *
 * This exists to make the filter falsifiable. Without it, "the filter is
 * working" and "the filter is eating real visitors" produce the same dashboard,
 * and so do "crawlers stopped coming" and "the filter silently broke".
 */
export function recordCrawlerView(now?: Date): void {
  getDb()
    .prepare(
      `INSERT INTO crawler_view_daily (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1`,
    )
    .run(utcDay(now));
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface DailyPoint {
  day: string;
  anon: number;
  authed: number;
  total: number;
}

/**
 * Daily pageviews for the last `days` days, zero-filled. Zero-filling matters:
 * a gap in the data and a day with no traffic are the same fact to a reader, but
 * a chart that silently omits empty days draws a flat line through an outage.
 *
 * ⚠️ The window is CLAMPED to `CRAWLER_FILTER_FROM_DAY`, so a 90-day range can
 * return fewer than 90 points. That is deliberate and it is not zero-filling's
 * job to hide it: those days hold real counts we know to be ~80% crawler, and
 * drawing them as zero would be as wrong as drawing them as traffic. The caller
 * reads `series.length` for the window actually covered, and
 * `excludedPreFilter()` for what was left out.
 */
export function pageViewSeries(days = 30, now: Date = new Date()): DailyPoint[] {
  const from = trustedFrom(dayNDaysAgo(days - 1, now));
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(CASE WHEN authed = 1 THEN count ELSE 0 END) AS authed,
                   SUM(CASE WHEN authed = 0 THEN count ELSE 0 END) AS anon
       FROM page_view_daily WHERE day >= ? GROUP BY day`,
    )
    .all(from) as { day: string; authed: number; anon: number }[];

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayNDaysAgo(i, now);
    if (day < from) continue;
    const r = byDay.get(day);
    const anon = r?.anon ?? 0;
    const authed = r?.authed ?? 0;
    out.push({ day, anon, authed, total: anon + authed });
  }
  return out;
}

/**
 * Signed-in pageviews per day, zero-filled, over the FULL window asked for.
 *
 * Deliberately not clamped to `CRAWLER_FILTER_FROM_DAY`, and the reason is that
 * a crawler is always anonymous: it carries no session cookie, so
 * `withOptionalUser` hands the beacon a null session and the row lands under
 * `authed = 0`. The pre-filter era's contamination is therefore entirely in the
 * anonymous half. Measured on prod for 2026-08-20, the heaviest crawl day on
 * record: anon 5,761, authed 8.
 *
 * So this series was never dirty, and clamping it would throw away real
 * signed-in history to protect against a problem it cannot have. It exists as
 * its own named function rather than a flag on `pageViewSeries` because "which
 * of these two reads is safe unclamped" is exactly the question a boolean
 * argument hides at the call site.
 *
 * ⚠️ Do not use this to total traffic. It is the authed half only.
 */
export function signedInPageViewSeries(days = 30, now: Date = new Date()): { day: string; count: number }[] {
  const from = dayNDaysAgo(days - 1, now);
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(count) AS count FROM page_view_daily
       WHERE day >= ? AND authed = 1 GROUP BY day`,
    )
    .all(from) as { day: string; count: number }[];

  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayNDaysAgo(i, now);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

export function topPages(days = 30, limit = 15, now: Date = new Date()): { pathKey: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT path_key AS pathKey, SUM(count) AS count FROM page_view_daily
       WHERE day >= ? GROUP BY path_key ORDER BY count DESC LIMIT ?`,
    )
    .all(trustedFrom(dayNDaysAgo(days - 1, now)), limit) as { pathKey: string; count: number }[];
}

export function referrerBreakdown(days = 30, now: Date = new Date()): { refClass: RefClass; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT ref_class AS refClass, SUM(count) AS count FROM referrer_daily
       WHERE day >= ? GROUP BY ref_class`,
    )
    .all(trustedFrom(dayNDaysAgo(days - 1, now))) as { refClass: RefClass; count: number }[];
  const byClass = new Map(rows.map((r) => [r.refClass, r.count]));
  return REF_CLASSES.map((refClass) => ({ refClass, count: byClass.get(refClass) ?? 0 }));
}

export interface CrawlerBlocked {
  /** Beacons rejected as crawler traffic inside the selected range. */
  blockedInRange: number;
  /** Share of all beacons in range that were rejected, 0-100, or null if none. */
  sharePct: number | null;
  /** The heaviest single day in range, which is what a crawl looks like. */
  busiestDay: { day: string; count: number } | null;
  /** First day this counter existed. Anything earlier is absent, not zero. */
  since: string | null;
}

/**
 * What the crawler filter rejected, for the same window the pageviews cover.
 *
 * ⚠️ `sharePct` is out of BEACONS (blocked + counted), not out of requests. A
 * crawler that never runs JS never reaches the beacon at all and is invisible
 * here; that traffic belongs in Search Console. This number answers "of the
 * things that POSTed to the beacon, how many were rejected", which is the only
 * question the schema can honestly answer, and the one that separates a working
 * filter from a broken one.
 */
export function crawlerBlocked(days = 30, now: Date = new Date()): CrawlerBlocked {
  const db = getDb();
  const from = trustedFrom(dayNDaysAgo(days - 1, now));

  const rows = db
    .prepare(`SELECT day, count FROM crawler_view_daily WHERE day >= ? ORDER BY count DESC`)
    .all(from) as { day: string; count: number }[];

  const blockedInRange = rows.reduce((a, r) => a + r.count, 0);
  const counted = pageViewSeries(days, now).reduce((a, p) => a + p.total, 0);
  const beacons = blockedInRange + counted;

  // The earliest row ever, not the earliest in range: it is what tells a reader
  // that a flat zero on an old range means "not measured yet" rather than "no
  // crawlers". Cheap, since `day` is the PK.
  const since = (db.prepare(`SELECT MIN(day) AS d FROM crawler_view_daily`).get() as { d: string | null }).d;

  return {
    blockedInRange,
    sharePct: beacons > 0 ? (blockedInRange / beacons) * 100 : null,
    busiestDay: rows[0] ?? null,
    since,
  };
}

export interface ExcludedPreFilter {
  /** Pageviews held in the counters but not trusted, and so not reported. */
  pageviews: number;
  /** Last day on the excluded side. The filter shipped partway through it. */
  throughDay: string;
  /** Whether the selected range would otherwise have reached into that era. */
  inRange: boolean;
}

/**
 * The pre-filter counts every read above deliberately skips.
 *
 * Reported rather than dropped. A number quietly missing from a total is the
 * failure this whole file keeps re-learning: on 2026-08-31 prod held 5,792 of
 * these against 416 real pageviews, and the dashboard's ads gate read 62%
 * because nothing separated them. Showing the excluded figure beside the honest
 * one is what makes the honest one believable.
 */
export function excludedPreFilter(days = 30, now: Date = new Date()): ExcludedPreFilter {
  const pageviews = pageviewsBefore(CRAWLER_FILTER_FROM_DAY);
  return {
    pageviews,
    throughDay: dayNDaysAgo(1, new Date(`${CRAWLER_FILTER_FROM_DAY}T00:00:00Z`)),
    inRange: dayNDaysAgo(days - 1, now) < CRAWLER_FILTER_FROM_DAY,
  };
}

export interface UserMetrics {
  total: number;
  dau: number;
  wau: number;
  mau: number;
  /**
   * Distinct signed-in users seen at least once inside the SELECTED range, as
   * opposed to dau/wau/mau which are fixed 1/7/30-day windows. The dashboard's
   * range tabs move this one; they deliberately do not move the gates, whose
   * windows are part of the threshold definition rather than a view setting.
   */
  activeInRange: number;
  signups: { day: string; count: number }[];
}

/**
 * Signed-in user counts, exact. These come from real rows, not from the beacon.
 *
 * ⚠️ `last_seen_at` only became meaningful on 2026-08-03, when getSession() began
 * stamping it once per user per UTC day. Before that it was written only on a RAWG
 * login or a Steam OAuth callback, so any window reaching further back undercounts
 * badly. It is also, by definition, blind to anonymous visitors. That is what the
 * pageview counters are for.
 */
export function userMetrics(days = 30, now: Date = new Date()): UserMetrics {
  const db = getDb();
  const nowSec = Math.floor(now.getTime() / 1000);
  const since = (d: number) => nowSec - d * 86_400;

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const active = (d: number) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?`).get(since(d)) as { n: number }).n;

  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS count
       FROM users WHERE created_at >= ? GROUP BY day`,
    )
    .all(since(days)) as { day: string; count: number }[];
  const byDay = new Map(rows.map((r) => [r.day, r.count]));

  const signups: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayNDaysAgo(i, now);
    signups.push({ day, count: byDay.get(day) ?? 0 });
  }

  return { total, dau: active(1), wau: active(7), mau: active(30), activeInRange: active(days), signups };
}

// ── The two gates ───────────────────────────────────────────────────────────

/** H3.8's approved thresholds (locked 2026-08-17). Not knobs, decisions. */
export const ADS_PAGEVIEW_GATE = 10_000;
export const FREEMIUM_WAU_GATE = 3_500;

export interface GateProgress {
  pageviews30d: number;
  adsGate: number;
  adsPct: number;
  wau: number;
  freemiumGate: number;
  freemiumPct: number;
}

export function gateProgress(now: Date = new Date()): GateProgress {
  const pageviews30d = pageViewSeries(30, now).reduce((a, p) => a + p.total, 0);
  const { wau } = userMetrics(1, now);
  return {
    pageviews30d,
    adsGate: ADS_PAGEVIEW_GATE,
    adsPct: Math.min(100, (pageviews30d / ADS_PAGEVIEW_GATE) * 100),
    wau,
    freemiumGate: FREEMIUM_WAU_GATE,
    freemiumPct: Math.min(100, (wau / FREEMIUM_WAU_GATE) * 100),
  };
}

export interface AnalyticsSnapshot {
  gates: GateProgress;
  /**
   * ⚠️ May be SHORTER than `days`: the window is clamped to the first day whose
   * counts exclude crawlers. Read `series.length` for the window actually
   * covered, and `excluded` for what that left out.
   */
  series: DailyPoint[];
  topPages: { pathKey: string; count: number }[];
  referrers: { refClass: RefClass; count: number }[];
  users: UserMetrics;
  crawler: CrawlerBlocked;
  excluded: ExcludedPreFilter;
  /** The window ASKED for. `series.length` is the window answered. */
  days: number;
  generatedAt: string;
}

/** Everything the dashboard renders, in one call. */
export function analyticsSnapshot(days = 30, now: Date = new Date()): AnalyticsSnapshot {
  return {
    gates: gateProgress(now),
    series: pageViewSeries(days, now),
    topPages: topPages(days, 15, now),
    referrers: referrerBreakdown(days, now),
    users: userMetrics(days, now),
    crawler: crawlerBlocked(days, now),
    excluded: excludedPreFilter(days, now),
    days,
    generatedAt: now.toISOString(),
  };
}

// ── The portfolio KPI contract ──────────────────────────────────────────────
//
// One JSON shape shared by every project on https://nilsmlynarek.eu/analytics/,
// served by GET /api/telemetry/kpi behind KPI_READ_KEY. The hub renders three
// numbers per project and does not care which project it is reading, so the
// field names below are the CONTRACT's and not this codebase's.
//
// Everything here is an aggregate. No user ids, no paths, no referrers: the
// response is read by a page that a stranger may end up looking at, so the bar
// is "printable on a dashboard in front of someone" rather than "not obviously
// identifying".

// `CRAWLER_FILTER_FROM_DAY` is declared with the crawler filter itself, above.
// The KPI response counts `runsTotal` from that day and reports the earlier
// total as `simRuns`, the contract's field for records excluded as not a person.
// Publishing the raw all-time sum would put roughly four times the real number
// on the hub, which is the exact failure the contract exists to prevent.

/** Windows the contract fixes. Not view settings: the hub echoes them back. */
export const KPI_ACTIVE_WINDOW_DAYS = 7;
export const KPI_NEW_WINDOW_DAYS = 30;

export interface KpiSnapshot {
  ok: true;
  /** Lower-case and plural: the hub prints it as "{unit} this week". */
  unit: "pageviews";
  /**
   * Distinct signed-in accounts seen in the last 7 days, exact, from
   * users.last_seen_at.
   *
   * ⚠️ This is a FLOOR on human activity, not a total, and the reason is
   * structural rather than a gap to close later: pageviews carry no identity by
   * design (migration 17 stores no user_id, no IP, no session id), so an
   * anonymous SEO visitor is active and uncountable. "Weekly active USERS" where
   * a user means an account is exactly what this number is, which is why it is
   * safe to publish under that name. Do not swap in a pageview-derived estimate.
   */
  weeklyActive: number;
  runsWeek: number;
  newThisMonth: number;
  usersTotal: number;
  runsTotal: number;
  /** Pageviews excluded as not a person: the pre-crawler-filter era. */
  simRuns: number;
  windowDays: { active: number; new: number };
  /** ISO 8601 UTC, so the hub can spot a stale cache. */
  server: string;
}

function pageviewsFrom(fromDay: string): number {
  return (
    getDb()
      .prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM page_view_daily WHERE day >= ?`)
      .get(fromDay) as { n: number }
  ).n;
}

function pageviewsBefore(day: string): number {
  return (
    getDb()
      .prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM page_view_daily WHERE day < ?`)
      .get(day) as { n: number }
  ).n;
}

/**
 * The whole KPI response, in one call.
 *
 * Reads the same two tables `analyticsSnapshot` does, over the same day
 * arithmetic, so the two routes cannot disagree about a week: `runsWeek` uses
 * `dayNDaysAgo(6)`, which is exactly `pageViewSeries(7)`'s first day. That is
 * worth keeping deliberate. Two routes over the same tables reporting different
 * totals is the failure most worth catching here, and it is free to prevent.
 *
 * `newThisMonth` counts accounts CREATED in the window, which is the contract's
 * "first ever record" rather than "any record": a returning user of two years is
 * not new. users.created_at has always been written correctly, unlike
 * last_seen_at, which only became meaningful on 2026-08-03 (see userMetrics) and
 * is nowhere near the 7-day window this uses it for.
 */
export function kpiSnapshot(now: Date = new Date()): KpiSnapshot {
  const db = getDb();
  const nowSec = Math.floor(now.getTime() / 1000);
  const since = (d: number) => nowSec - d * 86_400;

  // Same clamp every dashboard read uses, so runsWeek can never count a
  // pre-filter day and exceed runsTotal.
  const weekFrom = trustedFrom(dayNDaysAgo(KPI_ACTIVE_WINDOW_DAYS - 1, now));

  const count = (sql: string, param: number) => (db.prepare(sql).get(param) as { n: number }).n;

  return {
    ok: true,
    unit: "pageviews",
    weeklyActive: count(
      `SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?`,
      since(KPI_ACTIVE_WINDOW_DAYS),
    ),
    runsWeek: pageviewsFrom(weekFrom),
    newThisMonth: count(
      `SELECT COUNT(*) AS n FROM users WHERE created_at >= ?`,
      since(KPI_NEW_WINDOW_DAYS),
    ),
    usersTotal: (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n,
    runsTotal: pageviewsFrom(CRAWLER_FILTER_FROM_DAY),
    simRuns: pageviewsBefore(CRAWLER_FILTER_FROM_DAY),
    windowDays: { active: KPI_ACTIVE_WINDOW_DAYS, new: KPI_NEW_WINDOW_DAYS },
    server: now.toISOString(),
  };
}
