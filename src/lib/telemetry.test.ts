import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import {
  classifyReferrer,
  isCrawlerUserAgent,
  normalizePathKey,
  recordPageView,
  pageViewSeries,
  topPages,
  referrerBreakdown,
  utcDay,
  kpiSnapshot,
  CRAWLER_FILTER_FROM_DAY,
  crawlerBlocked,
  excludedPreFilter,
  recordCrawlerView,
} from "@/lib/telemetry";

describe("normalizePathKey", () => {
  it("keeps known static routes verbatim", () => {
    expect(normalizePathKey("/")).toBe("/");
    expect(normalizePathKey("/calendar")).toBe("/calendar");
    expect(normalizePathKey("/insights/facet")).toBe("/insights/facet");
  });

  it("templates dynamic segments so cardinality stays bounded", () => {
    expect(normalizePathKey("/tag/roguelike")).toBe("/tag/[slug]");
    expect(normalizePathKey("/tag/tower-defense")).toBe("/tag/[slug]");
    expect(normalizePathKey("/person/hideo-kojima")).toBe("/person/[slug]");
    expect(normalizePathKey("/studio/kojima-productions")).toBe("/studio/[slug]");
    expect(normalizePathKey("/game/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/movie/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/show/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/legal/de/imprint")).toBe("/legal/[locale]/[doc]");
  });

  // The URLs the sitemap actually ships. Until 2026-08-20 the item arm only
  // matched two segments, so every real item view landed in "other" and the
  // dashboard could not show one. Assert against the sitemap's shape, not the
  // route folder's.
  it("templates the three-segment item URL the sitemap ships", () => {
    expect(normalizePathKey("/movie/0029c55c-b0ed-4e30-9223-6f0cfd541e36/the-fellowship-of-the-ring")).toBe("/[type]/[id]");
    expect(normalizePathKey("/show/00198515-1af6-4cf5-89e3-c375f4eb1f67/erased")).toBe("/[type]/[id]");
    expect(normalizePathKey("/game/abc/hollow-knight")).toBe("/[type]/[id]");
    // Not a media type, so it stays in the bucket that bounds cardinality.
    expect(normalizePathKey("/tag/a/b")).toBe("other");
  });

  it("templates the public calendar month pages", () => {
    expect(normalizePathKey("/calendar/2026-09")).toBe("/calendar/[month]");
    expect(normalizePathKey("/calendar/1999-01")).toBe("/calendar/[month]");
    // The client-rendered app page is a different route and keeps its own key.
    expect(normalizePathKey("/calendar")).toBe("/calendar");
  });

  it("normalizes case, trailing slashes and query strings", () => {
    expect(normalizePathKey("/Calendar/")).toBe("/calendar");
    expect(normalizePathKey("/tag/Horror?x=1#y")).toBe("/tag/[slug]");
    expect(normalizePathKey("library")).toBe("/library");
  });

  // The whole point of the "other" bucket: an arbitrary path must not be able to
  // mint an arbitrary row. Without this, POSTing 10k random paths would write 10k
  // rows a day, the unbounded-growth shape migration 17 exists to avoid.
  it("collapses unknown paths to a single bucket", () => {
    expect(normalizePathKey("/nope")).toBe("other");
    expect(normalizePathKey("/a/b/c/d/e")).toBe("other");
    expect(normalizePathKey("/tag/a/b")).toBe("other");
  });

  it("refuses paths that must never be counted", () => {
    expect(normalizePathKey("/api/detail")).toBeNull();
    expect(normalizePathKey("/_next/static/chunk.js")).toBeNull();
    expect(normalizePathKey("/.well-known/assetlinks.json")).toBeNull();
    expect(normalizePathKey("/favicon.ico")).toBeNull();
    // The admin surface is not traffic. Counting it would let the dashboard
    // inflate the very numbers it reports.
    expect(normalizePathKey("/dev/analytics")).toBeNull();
    expect(normalizePathKey("/dev/scoring")).toBeNull();
  });
});

describe("isCrawlerUserAgent", () => {
  // Every one of these renders JavaScript, so "a client beacon excludes crawlers"
  // was never true. These are the agents that produced 80% of the ads gate.
  it("catches rendering crawlers", () => {
    const uas = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
      "Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)",
      "Mozilla/5.0 (compatible; DataForSeoBot/1.0)",
      "Screaming Frog SEO Spider/19.2",
      "Mozilla/5.0 (compatible; Baiduspider/2.0)",
      "Mozilla/5.0 (compatible; Yahoo! Slurp)",
    ];
    for (const ua of uas) expect(isCrawlerUserAgent(ua), ua).toBe(true);
  });

  it("catches headless engines and scripted clients", () => {
    const uas = [
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) Chrome-Lighthouse",
      "python-requests/2.31.0",
      "Go-http-client/2.0",
      "curl/8.4.0",
      "okhttp/4.12.0",
    ];
    for (const ua of uas) expect(isCrawlerUserAgent(ua), ua).toBe(true);
  });

  it("catches AI and answer-engine fetchers that never say 'bot'", () => {
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 AppleWebKit (KHTML, like Gecko; compatible; ClaudeBot/1.0)")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; Bytespider)")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 ... ChatGPT-User/1.0; +https://openai.com/bot")).toBe(true);
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; meta-externalagent/1.1)")).toBe(true);
  });

  // Added 2026-08-31. Each of these reaches a rendered page (or POSTs directly)
  // and matched none of the original arms, so each was counting as a visitor.
  it("catches the agents added in the 2026-08-31 widening", () => {
    const uas = [
      // Search fetchers whose UA omits "bot" entirely.
      "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ BingPreview/1.0b",
      "Mediapartners-Google",
      "Mozilla/5.0 (compatible; GoogleOther)",
      "Google-InspectionTool/1.0",
      "Feedfetcher-Google; (+http://www.google.com/feedfetcher.html)",
      // Scraping frameworks and HTTP clients that name neither bot nor scraper.
      "Scrapy/2.11.0 (+https://scrapy.org)",
      "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
      "Apache-HttpClient/4.5.13 (Java/1.8.0_292)",
      "PostmanRuntime/7.36.0",
      "GuzzleHttp/7",
      "Mozilla/5.0 (compatible; Firecrawl/1.0)",
      // Uptime monitors, which otherwise read as a tiny, very loyal audience.
      "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://uptimerobot.com/)",
      "Pingdom.com_bot_version_1.4",
      // Internet-wide scanners.
      "Mozilla/5.0 (compatible; CensysInspect/1.1)",
      "Mozilla/5.0 (compatible; InternetMeasurement/1.0)",
    ];
    for (const ua of uas) expect(isCrawlerUserAgent(ua), ua).toBe(true);
  });

  // ⚠️ The bare engine names are deliberately NOT in the pattern list, because
  // each is also a real browser or in-app browser used by real people. Matching
  // the engine name would delete a region's worth of visitors from the only
  // number gating the ads decision. This is the guard on that decision, and it
  // asserts BOTH halves: the browser survives, and the engine's crawler does not.
  // The second half is not decoration. It failed on first run for Daumoa and
  // Yeti, which had been assumed caught by the `bot`/`spider` arms and were not.
  it("keeps regional browsers whose name matches their search engine", () => {
    const browsers = [
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 YandexSearch/24.5 Mobile/15E148",
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/120.0.0 Chrome/114.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 NAVER(inapp; search; 2000; 12.9.2)",
      "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 DaumApps/5.6.0",
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.221 Safari/537.36 SE 2.X MetaSr 1.0",
    ];
    for (const ua of browsers) expect(isCrawlerUserAgent(ua), ua).toBe(false);

    // …while the crawlers those same engines run are still caught.
    for (const ua of ["Mozilla/5.0 (compatible; YandexBot/3.0)", "Mozilla/5.0 (compatible; Daumoa-web-search)", "Sogou web spider/4.0", "Yeti/1.1 (NHN Corp.; http://help.naver.com/robots/)"]) {
      expect(isCrawlerUserAgent(ua), ua).toBe(true);
    }
  });

  it("treats a missing user agent as a crawler", () => {
    expect(isCrawlerUserAgent(null)).toBe(true);
    expect(isCrawlerUserAgent("")).toBe(true);
    expect(isCrawlerUserAgent("   ")).toBe(true);
  });

  // A false positive drops a real person from the only number gating the ads
  // decision, so the generic `bot` token is anchored. CUBOT and Abbott are real
  // strings that appear in real user agents.
  it("does not misclassify real browsers", () => {
    const uas = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      // A real Android phone whose model name contains "bot".
      "Mozilla/5.0 (Linux; Android 12; CUBOT NOTE 20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    ];
    for (const ua of uas) expect(isCrawlerUserAgent(ua), ua).toBe(false);
  });
});

describe("classifyReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(classifyReferrer(null)).toBe("direct");
    expect(classifyReferrer("")).toBe("direct");
    expect(classifyReferrer(undefined)).toBe("direct");
  });

  it("recognizes search engines", () => {
    expect(classifyReferrer("https://www.google.com/search?q=x")).toBe("search");
    expect(classifyReferrer("https://duckduckgo.com/")).toBe("search");
    expect(classifyReferrer("https://www.google.de/")).toBe("search");
  });

  it("recognizes social sources", () => {
    expect(classifyReferrer("https://www.reddit.com/r/games")).toBe("social");
    expect(classifyReferrer("https://x.com/someone")).toBe("social");
  });

  it("classifies our own host as internal, including subdomains", () => {
    expect(classifyReferrer("https://fandex.org/calendar", "fandex.org")).toBe("internal");
    expect(classifyReferrer("https://www.fandex.org/calendar", "www.fandex.org")).toBe("internal");
  });

  it("does not confuse a lookalike host for our own", () => {
    expect(classifyReferrer("https://fandex.org.evil.test/x", "fandex.org")).not.toBe("internal");
  });

  it("falls back to other for anything unparseable or unknown", () => {
    expect(classifyReferrer("not a url")).toBe("other");
    expect(classifyReferrer("https://example.test/x")).toBe("other");
  });
});

describe("recordPageView", () => {
  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily;");
  });

  it("upserts rather than inserting a row per view", () => {
    const db = getDb();
    for (let i = 0; i < 5; i++) {
      recordPageView({ pathKey: "/calendar", authed: false, refClass: "search" });
    }
    const rows = db.prepare("SELECT * FROM page_view_daily").all() as { count: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("counts anonymous and signed-in views as separate dimensions", () => {
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });
    recordPageView({ pathKey: "/", authed: true, refClass: "internal" });
    recordPageView({ pathKey: "/", authed: true, refClass: "internal" });

    const series = pageViewSeries(1);
    expect(series).toHaveLength(1);
    expect(series[0].anon).toBe(1);
    expect(series[0].authed).toBe(2);
    expect(series[0].total).toBe(3);
  });

  it("stores no identity: the table has no user_id column", () => {
    // Load-bearing, not cosmetic: account erasure finds its targets by looking
    // for a column literally named `user_id` (AGENTS.md). These counters must
    // stay outside that set, or deleting an account would retroactively rewrite
    // last month's traffic totals.
    const cols = (getDb().prepare("PRAGMA table_info(page_view_daily)").all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).not.toContain("user_id");
    expect(cols).toEqual(["day", "path_key", "authed", "count"]);
  });

  it("aggregates top pages and referrer classes over the window", () => {
    recordPageView({ pathKey: "/tag/[slug]", authed: false, refClass: "search" });
    recordPageView({ pathKey: "/tag/[slug]", authed: false, refClass: "search" });
    recordPageView({ pathKey: "/calendar", authed: true, refClass: "internal" });

    expect(topPages(7)[0]).toEqual({ pathKey: "/tag/[slug]", count: 2 });

    const refs = referrerBreakdown(7);
    expect(refs.find((r) => r.refClass === "search")?.count).toBe(2);
    expect(refs.find((r) => r.refClass === "internal")?.count).toBe(1);
    // Every class is present even at zero, so a chart can't silently omit one.
    expect(refs).toHaveLength(5);
    expect(refs.find((r) => r.refClass === "social")?.count).toBe(0);
  });
});

describe("pageViewSeries", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily;");
  });

  it("zero-fills days with no traffic", () => {
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });
    const series = pageViewSeries(7);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].day).toBe(utcDay());
    expect(series[series.length - 1].total).toBe(1);
    expect(series.slice(0, 6).every((d) => d.total === 0)).toBe(true);
  });

  it("returns days in ascending order, ending today", () => {
    const series = pageViewSeries(30);
    const days = series.map((d) => d.day);
    expect([...days].sort()).toEqual(days);
    expect(days[days.length - 1]).toBe(utcDay());
  });

  it("never returns a day the crawler filter was not running on", () => {
    // The clamp, and the reason /dev/analytics disagreed with the KPI route
    // until 2026-08-31: prod held 5,792 pre-filter pageviews against 416 real
    // ones, so the unclamped 30-day window put the ads gate at 62% when the
    // honest figure was 4%. A 3,650-day range must still start at the filter.
    const series = pageViewSeries(3_650);
    expect(series[0].day).toBe(CRAWLER_FILTER_FROM_DAY);
    expect(series.every((d) => d.day >= CRAWLER_FILTER_FROM_DAY)).toBe(true);
  });

  it("drops pre-filter counts from the totals rather than drawing them as zero", () => {
    // Both wrong answers are worth pinning against. Reporting 5_000 would be
    // the old bug; reporting a zero-filled point for 2026-08-19 would claim we
    // measured no traffic that day, which is a different lie about the same row.
    getDb()
      .prepare(`INSERT INTO page_view_daily (day, path_key, authed, count) VALUES (?, '/', 0, ?)`)
      .run("2026-08-19", 5_000);
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });

    const series = pageViewSeries(3_650);
    expect(series.reduce((a, p) => a + p.total, 0)).toBe(1);
    expect(series.find((d) => d.day === "2026-08-19")).toBeUndefined();

    // …and the count is still reported, as the excluded figure.
    expect(excludedPreFilter(3_650).pageviews).toBe(5_000);
    expect(excludedPreFilter(3_650).inRange).toBe(true);
    expect(excludedPreFilter(1).inRange).toBe(false);
  });

  it("clamps topPages and referrerBreakdown to the same window", () => {
    // One read left unclamped is the whole bug back: the top-pages panel is
    // what gave away the original 80%-bot era, so it must not be the panel
    // still showing it.
    getDb()
      .prepare(`INSERT INTO page_view_daily (day, path_key, authed, count) VALUES (?, ?, 0, ?)`)
      .run("2026-08-19", "/person/[slug]", 3_091);
    getDb()
      .prepare(`INSERT INTO referrer_daily (day, ref_class, count) VALUES (?, 'direct', ?)`)
      .run("2026-08-19", 3_091);
    recordPageView({ pathKey: "/", authed: false, refClass: "search" });

    expect(topPages(3_650)).toEqual([{ pathKey: "/", count: 1 }]);
    expect(referrerBreakdown(3_650).find((r) => r.refClass === "direct")?.count).toBe(0);
    expect(referrerBreakdown(3_650).find((r) => r.refClass === "search")?.count).toBe(1);
  });
});

describe("crawlerBlocked: making the filter falsifiable", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily; DELETE FROM crawler_view_daily;");
  });

  it("stores one bounded counter row per day and no identifying column", () => {
    // Same discipline as page_view_daily: no user_id (account erasure finds its
    // targets by that literal column name), no user agent, no path, no IP.
    const cols = (getDb().prepare("PRAGMA table_info(crawler_view_daily)").all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toEqual(["day", "count"]);

    recordCrawlerView();
    recordCrawlerView();
    recordCrawlerView();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM crawler_view_daily").get()).toEqual({ n: 1 });
    expect(crawlerBlocked(7).blockedInRange).toBe(3);
  });

  it("reports the blocked share out of beacons, so both failure modes are visible", () => {
    // A share near 0 on a public site means the filter stopped matching; a
    // share near 100 means it is eating real visitors. Neither is readable
    // from the pageview count alone, which is why they render as a pair.
    recordCrawlerView();
    recordCrawlerView();
    recordCrawlerView();
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });

    const c = crawlerBlocked(7);
    expect(c.blockedInRange).toBe(3);
    expect(c.sharePct).toBe(75); // 3 of 4 beacons
    expect(c.busiestDay).toEqual({ day: utcDay(), count: 3 });
  });

  it("says when it has never measured, rather than reporting a confident zero", () => {
    // "No crawlers came" and "this counter did not exist yet" are the same
    // zero. `since` is what separates them for a reader.
    const empty = crawlerBlocked(7);
    expect(empty.blockedInRange).toBe(0);
    expect(empty.sharePct).toBe(null);
    expect(empty.busiestDay).toBe(null);
    expect(empty.since).toBe(null);

    recordCrawlerView();
    expect(crawlerBlocked(7).since).toBe(utcDay());
  });
});

describe("kpiSnapshot: the portfolio KPI contract", () => {
  const db = () => getDb();

  // A day the crawler filter was definitely running on, and one it definitely
  // was not. Both are written directly rather than through recordPageView,
  // which can only ever stamp today.
  const CLEAN_DAY = "2026-09-01";
  const DIRTY_DAY = "2026-08-19";

  function seedPageviews(day: string, count: number, pathKey = "/tag/[slug]") {
    db()
      .prepare(
        `INSERT INTO page_view_daily (day, path_key, authed, count) VALUES (?, ?, 0, ?)
         ON CONFLICT(day, path_key, authed) DO UPDATE SET count = count + excluded.count`,
      )
      .run(day, pathKey, count);
  }

  function seedUser(id: string, createdDaysAgo: number, lastSeenDaysAgo: number) {
    const now = Math.floor(Date.now() / 1000);
    db()
      .prepare(`INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)`)
      .run(id, now - createdDaysAgo * 86_400, now - lastSeenDaysAgo * 86_400);
  }

  beforeEach(() => {
    db().exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily; DELETE FROM users;");
  });

  it("answers the contract's field set, with the windows it used", () => {
    const snap = kpiSnapshot();
    expect(snap.ok).toBe(true);
    expect(snap.unit).toBe("pageviews");
    expect(snap.windowDays).toEqual({ active: 7, new: 30 });
    expect(Object.keys(snap).sort()).toEqual(
      [
        "newThisMonth", "ok", "runsTotal", "runsWeek", "server",
        "simRuns", "unit", "usersTotal", "weeklyActive", "windowDays",
      ].sort(),
    );
    // ISO 8601 UTC, so a stale cache is spottable from the hub.
    expect(snap.server).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("counts pre-crawler-filter pageviews as simRuns, never as runsTotal", () => {
    // The whole reason this route can be published: the pre-2026-08-21 counters
    // are ~80% bot (4,314 of 5,365 measured), so reporting them as traffic would
    // put roughly four times the real number on a public dashboard.
    seedPageviews(DIRTY_DAY, 5_365);
    seedPageviews(CLEAN_DAY, 100);

    const snap = kpiSnapshot();
    expect(snap.runsTotal).toBe(100);
    expect(snap.simRuns).toBe(5_365);
  });

  it("puts the mixed cutover day on the excluded side", () => {
    // isCrawlerUserAgent shipped at 18:14Z on 2026-08-20, so that UTC day is
    // part filtered and part not. Only whole clean days count as traffic.
    seedPageviews("2026-08-20", 10);
    expect(CRAWLER_FILTER_FROM_DAY).toBe("2026-08-21");

    const snap = kpiSnapshot();
    expect(snap.simRuns).toBe(10);
    expect(snap.runsTotal).toBe(0);
  });

  it("agrees with the dashboard's own week: runsWeek === sum of pageViewSeries(7)", () => {
    // Two routes over the same tables disagreeing about a week is the failure
    // most worth catching here, so the arithmetic is pinned rather than trusted.
    seedPageviews(utcDay(), 12);
    seedPageviews(utcDay(new Date(Date.now() - 6 * 86_400_000)), 3);
    seedPageviews(utcDay(new Date(Date.now() - 9 * 86_400_000)), 99);

    const fromSeries = pageViewSeries(7).reduce((a, p) => a + p.total, 0);
    expect(kpiSnapshot().runsWeek).toBe(fromSeries);
    expect(kpiSnapshot().runsWeek).toBe(15);
  });

  it("keeps runsWeek at or under runsTotal even when the week reaches back past the filter", () => {
    // The floor on the week window is what makes this hold by construction
    // rather than by luck of the calendar.
    const now = new Date("2026-08-23T12:00:00Z"); // week start 2026-08-17, before the filter
    seedPageviews("2026-08-19", 500);
    seedPageviews("2026-08-22", 7);

    const snap = kpiSnapshot(now);
    expect(snap.runsWeek).toBe(7);
    expect(snap.runsWeek).toBeLessThanOrEqual(snap.runsTotal);
  });

  it("counts weekly actives as distinct accounts, and new users by first ever record", () => {
    seedUser("u-active", 200, 1); // old account, seen yesterday
    seedUser("u-new", 3, 2); // signed up this month, seen two days ago
    seedUser("u-dormant", 400, 90); // old account, long gone

    const snap = kpiSnapshot();
    expect(snap.usersTotal).toBe(3);
    expect(snap.weeklyActive).toBe(2);
    // "Any record in 30 days" would be 2 here. First-ever is 1, and that is the
    // contract: a returning user of two years is not new.
    expect(snap.newThisMonth).toBe(1);
  });

  it("holds the sanity checks the hub relies on", () => {
    seedUser("u-1", 3, 0);
    seedUser("u-2", 500, 0);
    seedPageviews(utcDay(), 20);
    seedPageviews(CLEAN_DAY, 5);
    seedPageviews(DIRTY_DAY, 900);

    const s = kpiSnapshot();
    expect(s.runsWeek).toBeLessThanOrEqual(s.runsTotal);
    expect(s.newThisMonth).toBeLessThanOrEqual(s.usersTotal);
    expect(s.weeklyActive).toBeLessThanOrEqual(s.usersTotal);
  });

  it("returns zeros rather than nulls on an empty database", () => {
    const s = kpiSnapshot();
    // COALESCE, not a NULL leaking into JSON: the hub reads null as "unmeasured"
    // and prints "?", which would be wrong for a table that is genuinely empty.
    expect(s).toMatchObject({
      weeklyActive: 0, runsWeek: 0, newThisMonth: 0,
      usersTotal: 0, runsTotal: 0, simRuns: 0,
    });
  });

  it("exposes no per-user or per-path data", () => {
    seedUser("u-secret", 1, 0);
    seedPageviews(utcDay(), 1, "/person/[slug]");
    const body = JSON.stringify(kpiSnapshot());
    expect(body).not.toContain("u-secret");
    expect(body).not.toContain("person");
    expect(body).not.toContain("path");
  });
});
