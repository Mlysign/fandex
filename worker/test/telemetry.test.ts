import { beforeEach, describe, expect, it } from "vitest";
import {
  analyticsSnapshot, classifyReferrer, countPageView, isCrawlerUserAgent, isSameOriginBeacon, normalizePathKey,
} from "../src/telemetry";
import { count, db, env, wipe } from "./helpers";

beforeEach(wipe);

const NOW = new Date("2026-10-11T09:00:00Z");
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

/** A beacon as a browser on fandex.org sends it. */
const beacon = (headers: Record<string, string> = {}) =>
  new Request("https://fandex.org/v1/t/pv", {
    method: "POST",
    headers: { "user-agent": CHROME, origin: "https://fandex.org", "sec-fetch-site": "same-origin", ...headers },
  });

describe("what kind of page an address is", () => {
  it("never keeps a slug or an id", () => {
    expect(normalizePathKey("/movie/the-matrix")).toBe("/[type]/[id]");
    expect(normalizePathKey("/item/11111111-2222-4333-8444-555555555555")).toBe("/[type]/[id]");
    expect(normalizePathKey("/person/keanu-reeves?x=1#top")).toBe("/person/[slug]");
    expect(normalizePathKey("/legal/de/privacy")).toBe("/legal/[locale]/[doc]");
    expect(normalizePathKey("/Wishlist/")).toBe("/wishlist");
    expect(normalizePathKey("")).toBe("/");
    expect(normalizePathKey("/some/odd/long/path")).toBe("other");
  });

  it("is not a page for the API, a file, or the admin pages", () => {
    expect(normalizePathKey("/v1/health")).toBeNull();
    expect(normalizePathKey("/favicon.ico")).toBeNull();
    expect(normalizePathKey("/dev/analytics")).toBeNull();
  });
});

describe("who sent the beacon", () => {
  it("takes a browser on our own page, by either marker", () => {
    expect(isSameOriginBeacon({ origin: "https://fandex.org", secFetchSite: "same-origin", host: "fandex.org" })).toBe(true);
    // Safari before 16.4 sends no Sec-Fetch-Site.
    expect(isSameOriginBeacon({ origin: "https://fandex.org", secFetchSite: null, host: "fandex.org" })).toBe(true);
    expect(isSameOriginBeacon({ origin: null, secFetchSite: "same-origin", host: "fandex.org" })).toBe(true);
  });

  it("refuses another site, a script with no markers, and a malformed origin", () => {
    expect(isSameOriginBeacon({ origin: "https://evil.example", secFetchSite: null, host: "fandex.org" })).toBe(false);
    expect(isSameOriginBeacon({ origin: "https://fandex.org", secFetchSite: "cross-site", host: "fandex.org" })).toBe(false);
    expect(isSameOriginBeacon({ origin: null, secFetchSite: null, host: "fandex.org" })).toBe(false);
    expect(isSameOriginBeacon({ origin: "not a url", secFetchSite: null, host: "fandex.org" })).toBe(false);
  });

  it("knows the agents that name themselves, and treats no name as one", () => {
    expect(isCrawlerUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isCrawlerUserAgent("curl/8.4.0")).toBe(true);
    expect(isCrawlerUserAgent("")).toBe(true);
    expect(isCrawlerUserAgent(CHROME)).toBe(false);
  });
});

describe("where a visit came from", () => {
  it("is one of five words", () => {
    expect(classifyReferrer("")).toBe("direct");
    expect(classifyReferrer("https://www.google.de/search?q=fandex")).toBe("search");
    expect(classifyReferrer("https://old.reddit.com/r/movies")).toBe("social");
    expect(classifyReferrer("https://fandex.org/discover", "fandex.org")).toBe("internal");
    expect(classifyReferrer("https://example.org/a")).toBe("other");
    expect(classifyReferrer("nonsense")).toBe("other");
  });
});

describe("counting a pageview", () => {
  it("counts a browser's view once, by kind of page and signed in or not", async () => {
    expect(await countPageView(env, beacon(), { path: "/movie/the-matrix", ref: "https://www.google.com/" }, false, NOW)).toBe("counted");
    expect(await countPageView(env, beacon(), { path: "/movie/alien", ref: "" }, false, NOW)).toBe("counted");
    expect(await countPageView(env, beacon(), { path: "/wishlist" }, true, NOW)).toBe("counted");
    const rows = await db.prepare("SELECT path_key, authed, count FROM page_view_daily ORDER BY path_key, authed").all();
    expect(rows.results).toEqual([
      { path_key: "/[type]/[id]", authed: 0, count: 2 },
      { path_key: "/wishlist", authed: 1, count: 1 },
    ]);
    const refs = await db.prepare("SELECT ref_class, count FROM referrer_daily ORDER BY ref_class").all();
    expect(refs.results).toEqual([{ ref_class: "direct", count: 2 }, { ref_class: "search", count: 1 }]);
    expect(await count("crawler_view_daily")).toBe(0);
  });

  it("turns a script away and keeps only how many", async () => {
    expect(await countPageView(env, beacon({ "user-agent": "python-requests/2.31" }), { path: "/" }, false, NOW)).toBe("crawler");
    const noMarkers = new Request("https://fandex.org/v1/t/pv", { method: "POST", headers: { "user-agent": CHROME } });
    expect(await countPageView(env, noMarkers, { path: "/" }, false, NOW)).toBe("crawler");
    expect(await count("page_view_daily")).toBe(0);
    expect((await db.prepare("SELECT count FROM crawler_view_daily").first<{ count: number }>())?.count).toBe(2);
  });

  it("counts nothing for an address that is not a page, or a body that is not a beacon", async () => {
    expect(await countPageView(env, beacon(), { path: "/dev/users" }, true, NOW)).toBe("not-a-page");
    expect(await countPageView(env, beacon(), { path: 42 }, false, NOW)).toBe("bad-request");
    expect(await countPageView(env, beacon(), null, false, NOW)).toBe("bad-request");
    expect(await count("page_view_daily")).toBe(0);
  });

  it("stops at the day's cap and says so", async () => {
    const capped = { ...env, DAILY_PAGEVIEW_CAP: "2" };
    expect(await countPageView(capped, beacon(), { path: "/" }, false, NOW)).toBe("counted");
    expect(await countPageView(capped, beacon(), { path: "/" }, false, NOW)).toBe("counted");
    expect(await countPageView(capped, beacon(), { path: "/" }, false, NOW)).toBe("capped");
    expect((await db.prepare("SELECT count FROM page_view_daily").first<{ count: number }>())?.count).toBe(2);
  });
});

describe("the traffic snapshot", () => {
  it("adds the range up, zero-fills the days, and names the gap it crosses", async () => {
    await db.batch([
      db.prepare("INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ('2026-10-04', '/', 0, 40)"),
      db.prepare("INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ('2026-10-04', '/[type]/[id]', 1, 5)"),
      db.prepare("INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ('2026-10-11', '/[type]/[id]', 0, 7)"),
      // Before the crawler gate existed: never in a chart, only in the note about it.
      db.prepare("INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ('2026-08-01', '/', 0, 9000)"),
      db.prepare("INSERT INTO referrer_daily (day, ref_class, count) VALUES ('2026-10-11', 'search', 4)"),
      db.prepare("INSERT INTO crawler_view_daily (day, count) VALUES ('2026-10-11', 13)"),
      db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES ('u1', ?, ?)").bind(Math.floor(NOW.getTime() / 1000) - 3600, Math.floor(NOW.getTime() / 1000) - 60),
    ]);
    const s = await analyticsSnapshot(db, 30, NOW);
    expect(s.series).toHaveLength(30);
    expect(s.series.at(-1)).toEqual({ day: "2026-10-11", anon: 7, authed: 0, total: 7 });
    expect(s.series.find((p) => p.day === "2026-10-04")).toEqual({ day: "2026-10-04", anon: 40, authed: 5, total: 45 });
    expect(s.gates).toMatchObject({ pageviews30d: 52, wau: 1 });
    expect(s.topPages).toEqual([{ pathKey: "/", count: 40 }, { pathKey: "/[type]/[id]", count: 12 }]);
    expect(s.referrers.find((r) => r.refClass === "search")?.count).toBe(4);
    expect(s.referrers).toHaveLength(5);
    expect(s.crawler).toMatchObject({ blockedInRange: 13, busiestDay: { day: "2026-10-11", count: 13 }, since: "2026-10-11" });
    expect(s.crawler.sharePct).toBeCloseTo((13 / 65) * 100);
    expect(s.excluded).toEqual({ pageviews: 9000, throughDay: "2026-08-20", inRange: false });
    expect(s.gap).toEqual({ from: "2026-10-05", through: "2026-10-10" });
    expect(s.users).toMatchObject({ total: 1, dau: 1, wau: 1, mau: 1 });
    expect(s.users.signups.at(-1)).toEqual({ day: "2026-10-11", count: 1 });
  });

  it("answers for an empty database", async () => {
    const s = await analyticsSnapshot(db, 7, NOW);
    expect(s.gates.pageviews30d).toBe(0);
    expect(s.crawler.sharePct).toBeNull();
    expect(s.topPages).toEqual([]);
  });
});
