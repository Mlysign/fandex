// Books (Open Library) and board games (BoardGameGeek): search, what is popular,
// and a facet page's titles, as the app's provider cards (2026-10-17).
//
//   GET /v1/search/books?q            Open Library search
//   GET /v1/search/boardgames?q       BGG search (with statistics)
//   GET /v1/browse/books              Open Library's weekly trending
//   GET /v1/browse/boardgames         BGG's hot list
//   GET /v1/facet/books?kind&q        a subject's, an author's, a publisher's or a series' books
//   GET /v1/features                  which optional types are switched on
//
// Nothing here writes to D1 or reads it: an answer is a provider call, cached at
// the edge, the way /v1/search/games is. An empty answer is never cached (a
// hiccup must not pin "nothing" for the TTL). Board games answer 503
// `not-configured` while the Worker has no BGG token: BGG's terms require a
// registered application (src/lib/sources/bgg.ts).

import {
  authorOpenLibrary, publisherOpenLibrary, searchOpenLibrary, seriesOpenLibrary, subjectOpenLibrary, trendingOpenLibrary,
} from "@/lib/sources/openlibrary";
import { bggConfigured, BggNotConfigured, hotBgg, searchBgg, setBggToken } from "@/lib/sources/bgg";
import type { Env } from "./env";
import { allow, clientIp, error, json } from "./http";

interface ShelfCtx {
  env: Env;
  request: Request;
  url: URL;
  defer: (p: Promise<unknown>) => void;
}

/** Point the BGG module at this Worker's secret. Cheap; called on any path that may reach BGG. */
export function useBggToken(env: Env): void {
  setBggToken(() => env.BGG_TOKEN);
}

const HOUR = 3600;

/** Answer from the edge cache, or run `load`, cache a non-empty answer for `ttl` seconds and answer. */
async function cached(c: ShelfCtx, key: string, ttl: number, limiter: string, load: () => Promise<unknown[]>): Promise<Response> {
  const cacheKey = new Request(`https://cache.fandex.internal/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(hit.body, hit);
  if (!(await allow(c.env.RL_RESOLVE, `${limiter}:${clientIp(c.request)}`))) return error(429, "rate-limited");
  let results: unknown[];
  try {
    results = await load();
  } catch (e) {
    if (e instanceof BggNotConfigured) return error(503, "not-configured", "Board games are not switched on yet.");
    console.warn("shelf_failed", { key, error: e instanceof Error ? e.message : String(e) });
    return error(502, "provider-unavailable");
  }
  const response = json({ results }, 200, { "Cache-Control": `public, max-age=${Math.min(ttl, HOUR)}` });
  if (results.length) {
    c.defer(caches.default.put(cacheKey, new Response(response.clone().body, {
      headers: { ...Object.fromEntries(response.headers), "Cache-Control": `public, max-age=${ttl}` },
    })));
  }
  return response;
}

const query = (c: ShelfCtx) => (c.url.searchParams.get("q") ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Routes under /v1 this file answers, or null for any other path. */
export async function shelves(c: ShelfCtx, method: string, a: string, b?: string, d?: string): Promise<Response | null> {
  if (method !== "GET" || d) return null;
  useBggToken(c.env);

  if (a === "features" && !b) {
    return json({ boardgames: bggConfigured(), books: true }, 200, { "Cache-Control": "public, max-age=300" });
  }

  if (a === "search" && (b === "books" || b === "boardgames")) {
    const q = query(c);
    if (q.length < 2) return error(400, "bad-request", "q must be at least two characters");
    const key = `search/${b}?q=${encodeURIComponent(q.toLowerCase())}`;
    return cached(c, key, HOUR, "search", () => (b === "books" ? searchOpenLibrary(q, 20) : searchBgg(q, 20)));
  }

  if (a === "browse" && (b === "books" || b === "boardgames")) {
    // Keyed by the day: what is popular moves daily.
    const day = new Date().toISOString().slice(0, 10);
    return cached(c, `browse/${b}?day=${day}`, 6 * HOUR, "browse", () => (b === "books" ? trendingOpenLibrary("weekly", 40) : hotBgg(30)));
  }

  if (a === "facet" && b === "books") {
    const kind = c.url.searchParams.get("kind");
    const q = query(c);
    if (!kind || !["tag", "person", "studio", "franchise"].includes(kind) || q.length < 2) {
      return error(400, "bad-request", "kind must be tag, person, studio or franchise, q at least two characters");
    }
    const load = kind === "tag" ? () => subjectOpenLibrary(q, 40)
      : kind === "person" ? () => authorOpenLibrary(q, 40)
      : kind === "studio" ? () => publisherOpenLibrary(q, 40)
      : () => seriesOpenLibrary(q, 40);
    // A week, as the games' facet answers: what a subject holds barely moves.
    return cached(c, `facet/books?kind=${kind}&q=${encodeURIComponent(q.toLowerCase())}`, 7 * 24 * HOUR, "facet", load);
  }

  return null;
}
