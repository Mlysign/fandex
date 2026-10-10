/**
 * Pageview counting and the Traffic page's numbers. A port of the site's
 * src/lib/telemetry.ts over D1's three counter tables.
 *
 * Counters, not events, and no user id, on purpose. A row is "this kind of
 * page, on this day, signed in or not, seen N times". Nothing here can be
 * joined to an account, and the privacy policy says exactly that.
 *
 * ⚠️ The gate is a request SHAPE, not a user-agent name: a browser sending the
 * beacon from our own page sets Origin or Sec-Fetch-Site, and no scripted
 * client does whatever it calls itself. The user-agent list only catches the
 * polite ones. A headless Chromium passes both; nothing here can tell.
 *
 * ⚠️ A counted view is three row writes (the page, the referrer, the day's cap),
 * and a row write is the budget. The cap is what keeps one script with a real
 * browser from stopping D1 for the day.
 */

import { capFrom, spend } from "./budget";
import { all, first } from "./d1";
import type { Env } from "./env";

export type RefClass = "search" | "social" | "internal" | "direct" | "other";
const REF_CLASSES: RefClass[] = ["search", "social", "internal", "direct", "other"];

/** Counted views allowed per UTC day. 5,000 is 15,000 of the day's 100,000 row writes. */
const DEFAULT_DAILY_PAGEVIEW_CAP = 5_000;

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
const dayNDaysAgo = (days: number, now: Date = new Date()) => utcDay(new Date(now.getTime() - days * 86_400_000));

const MEDIA_TYPES = new Set(["game", "movie", "show"]);
const STATIC_PATHS = new Set(["/", "/calendar", "/discover", "/insights", "/library", "/wishlist", "/profile", "/settings"]);

/**
 * The KIND of page an address is, or null for one that is not a page. A slug or
 * an id never reaches a counter: thousands of titles are one row, "/[type]/[id]".
 */
export function normalizePathKey(rawPath: string): string | null {
  let path = rawPath.split("?")[0].split("#")[0].toLowerCase();
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";
  if (/^\/(v1|api|_expo|assets|\.well-known)(\/|$)/.test(path)) return null;
  if (/\.[a-z0-9]{2,5}$/.test(path)) return null;
  // The admin pages are one person looking at these numbers. Counting them would be counting that.
  if (path === "/dev" || path.startsWith("/dev/")) return null;
  if (STATIC_PATHS.has(path)) return path;

  const seg = path.slice(1).split("/");
  if (seg.length === 2) {
    if (seg[0] === "person") return "/person/[slug]";
    if (seg[0] === "tag") return "/tag/[slug]";
    if (seg[0] === "studio") return "/studio/[slug]";
    if (seg[0] === "calendar") return "/calendar/[month]";
    // The app's own address for a title is the same page as the public one.
    if (MEDIA_TYPES.has(seg[0]) || seg[0] === "item") return "/[type]/[id]";
  }
  if (seg.length === 3) {
    if (seg[0] === "legal") return "/legal/[locale]/[doc]";
    if (MEDIA_TYPES.has(seg[0])) return "/[type]/[id]";
  }
  return "other";
}

const CRAWLER_PATTERNS: RegExp[] = [
  /\bbot\b|bot[/;)+]|^bot/i,
  /crawl|spider|slurp|scraper|scrapy|heritrix|nutch|ia_archiver/i,
  /headlesschrome|phantomjs|puppeteer|playwright|selenium|chrome-lighthouse|pagespeed|gtmetrix/i,
  /python-requests|python-urllib|aiohttp|go-http-client|java\/|okhttp|apache-httpclient|libwww-perl|^curl|^wget|axios\/|node-fetch|undici|got \(|guzzle|postmanruntime|insomnia|httpie|restsharp|^deno|^bun\//i,
  /uptimerobot|pingdom|statuscake|betteruptime|site24x7|newrelic|datadog|checkly/i,
  /censys|shodan|zgrab|masscan|internet-?measurement|expanse|paloaltonetworks|netcraft/i,
  /facebookexternalhit|meta-external|twitterbot|slackbot|discordbot|telegrambot|whatsapp\/|embedly|quora link preview|skypeuripreview|vkshare|redditbot/i,
  /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|claude-searchbot|anthropic-ai|ccbot|perplexity|bytespider|amazonbot|applebot|google-extended|cohere-ai|diffbot|omgili|timpi|imagesift|firecrawl/i,
  /ahrefs|semrush|mj12|dotbot|blexbot|dataforseo|screaming frog|sitebulb|serpstat|petal|barkrowler|zoominfo|seekport|megaindex|seokicks|linkdex|majestic|sistrix|oncrawl|oncrawler/i,
  /bingpreview|mediapartners|google-read-aloud|google-inspectiontool|google-site-verification|googleother|feedfetcher|qwantify|daumoa|yeti\//i,
];

/** A user agent that names itself as automated, or names nothing. */
export function isCrawlerUserAgent(ua: string | null | undefined): boolean {
  const s = ua?.trim();
  if (!s) return true;
  return CRAWLER_PATTERNS.some((re) => re.test(s));
}

/**
 * Did a browser send this from our own page? One marker is enough (Safari
 * before 16.4 sends no Sec-Fetch-Site), and hosts are compared, not schemes.
 */
export function isSameOriginBeacon(headers: { origin: string | null; secFetchSite: string | null; host: string | null }): boolean {
  const { origin, secFetchSite, host } = headers;
  if (secFetchSite && secFetchSite !== "same-origin") return false;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false; // a malformed Origin is not a browser
    }
  }
  return secFetchSite === "same-origin";
}

/** Before this day the site had no crawler gate, and its numbers are mostly crawlers. */
export const CRAWLER_FILTER_FROM_DAY = "2026-08-21";
const trustedFrom = (fromDay: string) => (fromDay > CRAWLER_FILTER_FROM_DAY ? fromDay : CRAWLER_FILTER_FROM_DAY);

/** Nothing counted a view between the move off the old server and the day the Worker started. */
export const COUNTING_GAP = { from: "2026-10-05", through: "2026-10-10" };

const SEARCH_HOSTS = [
  "google.", "bing.", "duckduckgo.", "ecosia.", "yahoo.", "startpage.",
  "search.brave.", "qwant.", "yandex.", "baidu.", "mojeek.", "search.marginalia.",
];
const SOCIAL_HOSTS = [
  "reddit.", "twitter.", "x.com", "t.co", "facebook.", "instagram.",
  "mastodon.", "bsky.", "bluesky.", "youtube.", "tiktok.", "linkedin.",
  "discord.", "pinterest.", "tumblr.", "threads.",
];

/** Where a visit came from, as one of five words. The address itself is never stored. */
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

export type PageViewOutcome = "counted" | "crawler" | "not-a-page" | "capped" | "bad-request";

/**
 * Count one pageview, or decide not to. `body` is what the page sent:
 * `{path, ref}`. Never throws: a counter that failed is not worth a page error.
 */
export async function countPageView(
  env: Env,
  request: Request,
  body: unknown,
  authed: boolean,
  now: Date = new Date(),
): Promise<PageViewOutcome> {
  const db = env.DB;
  const day = utcDay(now);
  const url = new URL(request.url);
  const notABrowser = isCrawlerUserAgent(request.headers.get("user-agent"))
    || !isSameOriginBeacon({ origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site"), host: url.host });

  const cap = capFrom(env.DAILY_PAGEVIEW_CAP, DEFAULT_DAILY_PAGEVIEW_CAP);
  try {
    if (notABrowser) {
      // Kept as a number so the Traffic page can say how much was turned away. Capped with the rest.
      if (await spend(db, "pageviews", cap)) {
        await db.prepare(
          "INSERT INTO crawler_view_daily (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1",
        ).bind(day).run();
      }
      return "crawler";
    }
    const b = body as { path?: unknown; ref?: unknown } | null;
    if (!b || typeof b.path !== "string" || b.path.length > 512) return "bad-request";
    const pathKey = normalizePathKey(b.path);
    if (!pathKey) return "not-a-page";
    const ref = typeof b.ref === "string" && b.ref.length <= 2048 ? b.ref : null;
    if (!(await spend(db, "pageviews", cap))) return "capped";
    await db.batch([
      db.prepare(
        `INSERT INTO page_view_daily (day, path_key, authed, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(day, path_key, authed) DO UPDATE SET count = count + 1`,
      ).bind(day, pathKey, authed ? 1 : 0),
      db.prepare(
        "INSERT INTO referrer_daily (day, ref_class, count) VALUES (?, ?, 1) ON CONFLICT(day, ref_class) DO UPDATE SET count = count + 1",
      ).bind(day, classifyReferrer(ref, url.hostname)),
    ]);
    return "counted";
  } catch (e) {
    console.warn("pageview_write_failed", e instanceof Error ? e.message : String(e));
    return "capped";
  }
}

// ── The Traffic page ─────────────────────────────────────────────────────────

export const ADS_PAGEVIEW_GATE = 10_000;
export const FREEMIUM_WAU_GATE = 3_500;

export interface AnalyticsSnapshot {
  gates: { pageviews30d: number; adsGate: number; adsPct: number; wau: number; freemiumGate: number; freemiumPct: number };
  series: { day: string; anon: number; authed: number; total: number }[];
  topPages: { pathKey: string; count: number }[];
  referrers: { refClass: RefClass; count: number }[];
  users: { total: number; dau: number; wau: number; mau: number; activeInRange: number; signups: { day: string; count: number }[] };
  crawler: { blockedInRange: number; sharePct: number | null; busiestDay: { day: string; count: number } | null; since: string | null };
  excluded: { pageviews: number; throughDay: string; inRange: boolean };
  /** The days on which nothing was counting, when the range touches them. */
  gap: { from: string; through: string } | null;
  days: number;
  generatedAt: string;
}

export async function analyticsSnapshot(db: D1Database, days = 30, now: Date = new Date()): Promise<AnalyticsSnapshot> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const since = (d: number) => nowSec - d * 86_400;
  const from = trustedFrom(dayNDaysAgo(days - 1, now));
  const from30 = trustedFrom(dayNDaysAgo(29, now));

  const [views, views30, pages, refs, crawlers, crawlerSince, before, users, signupRows] = await Promise.all([
    all<{ day: string; authed: number; anon: number }>(
      db,
      `SELECT day, SUM(CASE WHEN authed = 1 THEN count ELSE 0 END) AS authed,
              SUM(CASE WHEN authed = 0 THEN count ELSE 0 END) AS anon
         FROM page_view_daily WHERE day >= ? GROUP BY day`,
      [from],
    ),
    first<{ n: number | null }>(db, "SELECT SUM(count) AS n FROM page_view_daily WHERE day >= ?", [from30]),
    all<{ pathKey: string; count: number }>(
      db, "SELECT path_key AS pathKey, SUM(count) AS count FROM page_view_daily WHERE day >= ? GROUP BY path_key ORDER BY count DESC LIMIT 15", [from],
    ),
    all<{ refClass: RefClass; count: number }>(db, "SELECT ref_class AS refClass, SUM(count) AS count FROM referrer_daily WHERE day >= ? GROUP BY ref_class", [from]),
    all<{ day: string; count: number }>(db, "SELECT day, count FROM crawler_view_daily WHERE day >= ? ORDER BY count DESC", [from]),
    first<{ d: string | null }>(db, "SELECT MIN(day) AS d FROM crawler_view_daily"),
    first<{ n: number | null }>(db, "SELECT SUM(count) AS n FROM page_view_daily WHERE day < ?", [CRAWLER_FILTER_FROM_DAY]),
    all<{ last_seen_at: number | null }>(db, "SELECT last_seen_at FROM users"),
    all<{ day: string; count: number }>(
      db, "SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day", [since(days)],
    ),
  ]);

  const byDay = new Map(views.map((r) => [r.day, r]));
  const series: AnalyticsSnapshot["series"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayNDaysAgo(i, now);
    if (day < from) continue;
    const r = byDay.get(day);
    const anon = r?.anon ?? 0;
    const authed = r?.authed ?? 0;
    series.push({ day, anon, authed, total: anon + authed });
  }

  const active = (d: number) => users.filter((u) => (u.last_seen_at ?? 0) >= since(d)).length;
  const signupsByDay = new Map(signupRows.map((r) => [r.day, r.count]));
  const signups: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayNDaysAgo(i, now);
    signups.push({ day, count: signupsByDay.get(day) ?? 0 });
  }

  const refByClass = new Map(refs.map((r) => [r.refClass, r.count]));
  const blockedInRange = crawlers.reduce((a, r) => a + r.count, 0);
  const counted = series.reduce((a, p) => a + p.total, 0);
  const pageviews30d = views30?.n ?? 0;
  const wau = active(7);
  const firstDay = dayNDaysAgo(days - 1, now);

  return {
    gates: {
      pageviews30d, adsGate: ADS_PAGEVIEW_GATE, adsPct: Math.min(100, (pageviews30d / ADS_PAGEVIEW_GATE) * 100),
      wau, freemiumGate: FREEMIUM_WAU_GATE, freemiumPct: Math.min(100, (wau / FREEMIUM_WAU_GATE) * 100),
    },
    series,
    topPages: pages,
    referrers: REF_CLASSES.map((refClass) => ({ refClass, count: refByClass.get(refClass) ?? 0 })),
    users: { total: users.length, dau: active(1), wau, mau: active(30), activeInRange: active(days), signups },
    crawler: {
      blockedInRange,
      sharePct: blockedInRange + counted > 0 ? (blockedInRange / (blockedInRange + counted)) * 100 : null,
      busiestDay: crawlers[0] ?? null,
      since: crawlerSince?.d ?? null,
    },
    excluded: {
      pageviews: before?.n ?? 0,
      throughDay: dayNDaysAgo(1, new Date(`${CRAWLER_FILTER_FROM_DAY}T00:00:00Z`)),
      inRange: firstDay < CRAWLER_FILTER_FROM_DAY,
    },
    gap: firstDay <= COUNTING_GAP.through && utcDay(now) >= COUNTING_GAP.from ? COUNTING_GAP : null,
    days,
    generatedAt: now.toISOString(),
  };
}
