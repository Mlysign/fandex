import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, pageRateLimit, proxy } from "./proxy";

function page(path: string, ip?: string) {
  return new NextRequest(`https://fandex.org${path}`, {
    headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {},
  });
}

afterEach(() => {
  delete process.env.PAGE_RATE_LIMIT_PER_MIN;
});

describe("page rate limit", () => {
  it("lets a client through up to the limit, then answers 429 with Retry-After", () => {
    process.env.PAGE_RATE_LIMIT_PER_MIN = "5";
    for (let i = 0; i < 5; i++) expect(proxy(page(`/movie/a-${i}`, "203.0.113.7")).status).toBe(200);
    const blocked = proxy(page("/movie/a-6", "203.0.113.7"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("counts each address separately", () => {
    process.env.PAGE_RATE_LIMIT_PER_MIN = "1";
    expect(proxy(page("/tag/horror", "203.0.113.8")).status).toBe(200);
    expect(proxy(page("/tag/horror", "203.0.113.8")).status).toBe(429);
    expect(proxy(page("/tag/horror", "203.0.113.9")).status).toBe(200);
  });

  it("never limits a local request, which Next reports as a loopback address", () => {
    process.env.PAGE_RATE_LIMIT_PER_MIN = "1";
    for (let i = 0; i < 10; i++) expect(proxy(page("/")).status).toBe(200);
    for (const local of ["::1", "127.0.0.1", "::ffff:127.0.0.1"]) {
      const req = new NextRequest("http://localhost:3100/", { headers: { "x-forwarded-for": local } });
      for (let i = 0; i < 10; i++) expect(proxy(req).status).toBe(200);
    }
  });

  it("is switched off by 0, and falls back to the default on a typo", () => {
    process.env.PAGE_RATE_LIMIT_PER_MIN = "0";
    for (let i = 0; i < 300; i++) expect(proxy(page("/", "203.0.113.10")).status).toBe(200);
    process.env.PAGE_RATE_LIMIT_PER_MIN = "lots";
    expect(pageRateLimit()).toBe(120);
  });

  it("matches pages and leaves /api/, /_next/ and public files alone", () => {
    const re = new RegExp(`^${config.matcher[0].source}$`);
    for (const p of ["/", "/movie/dune", "/tag/horror", "/calendar/2026-10", "/r/igdb/game/12"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ["/api/health", "/_next/static/x.js", "/robots.txt", "/sitemap.xml", "/icon.png"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});
