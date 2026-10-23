// Books (Open Library, plus Hardcover) and board games (BoardGameGeek): search,
// what is popular, and a facet page's titles, as the app's provider cards (2026-10-17).
//
//   GET /v1/search/books?q            Open Library search, plus Hardcover's for what it lacks
//   GET /v1/search/boardgames?q       BGG search (with statistics)
//   GET /v1/browse/books              Open Library's weekly trending
//   GET /v1/browse/boardgames         BGG's hot list
//   GET /v1/facet/books?kind&q        a subject's, an author's, a publisher's or a series' books
//   GET /v1/features                  which optional types and sources are switched on
//
// Nothing here writes to D1 or reads it, bar the Hardcover budget: an answer is
// a provider call, cached at the edge, the way /v1/search/games is. An empty
// answer is never cached (a hiccup must not pin "nothing" for the TTL). Board
// games answer 503 `not-configured` while the Worker has no BGG token: BGG's
// terms require a registered application (src/lib/sources/bgg.ts).
//
// Hardcover (src/lib/sources/hardcover.ts, since 2026-10-17) is a SECOND
// source for two of these, never the first: search and a series' books. Its
// cards are merged behind Open Library's by ISBN or by title and author
// (bookPure.ts, mergeBookCards), so a book both know is Open Library's, and a
// book only Hardcover knows (one announced and not yet out) still appears.
// Without `HARDCOVER_TOKEN` the answers are exactly what they were before.

import {
  authorOpenLibrary, publisherOpenLibrary, searchOpenLibrary, seriesOpenLibrary, subjectOpenLibrary, trendingOpenLibrary,
} from "@/lib/sources/openlibrary";
import { mergeBookCards, stripIsbns, type BookCard } from "@/lib/sources/bookPure";
import { hardcoverConfigured, searchHardcover, seriesHardcover } from "@/lib/sources/hardcover";
import { bggConfigured, BggNotConfigured, hotBgg, searchBgg, setBggToken } from "@/lib/sources/bgg";
import type { Env } from "./env";
import { hardcoverHalf, useHardcover } from "./hardcover";
import { allow, cachedAnswer, clientIp, error, json } from "./http";

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
/** Bumped when what a shelf answers changes (a filter, a field), so a day-old cached answer is not served under the new rules. */
const CACHE_VERSION = 4; // 3: Hardcover's cards behind Open Library's in search and series; authors on every card. 4: one card per book, no summaries (2026-10-23)

/** Answer from the edge cache, or run `load`, cache a non-empty answer for `ttl` seconds and answer. */
async function cached(c: ShelfCtx, key: string, ttl: number, limiter: string, load: () => Promise<unknown[]>): Promise<Response> {
  const cacheKey = new Request(`https://cache.fandex.internal/v${CACHE_VERSION}/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return cachedAnswer(hit, `public, max-age=${Math.min(ttl, HOUR)}`);
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

/**
 * Open Library's answer with Hardcover's behind it. Open Library is asked
 * first and in full; an Open Library failure still answers when Hardcover
 * has something, and is the route's failure when it does not.
 */
async function bothBookSources(env: Env, kind: string, units: number, ol: () => Promise<BookCard[]>, hc: () => Promise<BookCard[]>): Promise<BookCard[]> {
  let olError: unknown = null;
  const [primary, secondary] = await Promise.all([
    ol().catch((e) => { olError = e; return [] as BookCard[]; }),
    hardcoverHalf(env, kind, units, hc),
  ]);
  const merged = mergeBookCards(primary, secondary);
  if (olError && !merged.length) throw olError;
  return stripIsbns(merged);
}

const query = (c: ShelfCtx) => (c.url.searchParams.get("q") ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Routes under /v1 this file answers, or null for any other path. */
export async function shelves(c: ShelfCtx, method: string, a: string, b?: string, d?: string): Promise<Response | null> {
  if (method !== "GET" || d) return null;
  useBggToken(c.env);
  useHardcover(c.env);

  if (a === "features" && !b) {
    return json({ boardgames: bggConfigured(), books: true, hardcover: hardcoverConfigured() }, 200, { "Cache-Control": "public, max-age=300" });
  }

  if (a === "search" && (b === "books" || b === "boardgames")) {
    const q = query(c);
    if (q.length < 2) return error(400, "bad-request", "q must be at least two characters");
    const key = `search/${b}?q=${encodeURIComponent(q.toLowerCase())}`;
    return cached(c, key, HOUR, "search", () => (b === "books"
      ? bothBookSources(c.env, "search", 1, () => searchOpenLibrary(q, 20), () => searchHardcover(q, 15)).then((cards) => cards.slice(0, 25))
      : searchBgg(q, 20)));
  }

  if (a === "browse" && (b === "books" || b === "boardgames")) {
    // Keyed by the day: what is popular moves daily.
    const day = new Date().toISOString().slice(0, 10);
    return cached(c, `browse/${b}?day=${day}`, 6 * HOUR, "browse", () => (b === "books" ? trendingOpenLibrary("weekly", 40).then(stripIsbns) : hotBgg(30)));
  }

  if (a === "facet" && b === "books") {
    const kind = c.url.searchParams.get("kind");
    const q = query(c);
    if (!kind || !["tag", "person", "studio", "franchise"].includes(kind) || q.length < 2) {
      return error(400, "bad-request", "kind must be tag, person, studio or franchise, q at least two characters");
    }
    const load = kind === "tag" ? () => subjectOpenLibrary(q, 40).then(stripIsbns)
      : kind === "person" ? () => authorOpenLibrary(q, 40).then(stripIsbns)
      : kind === "studio" ? () => publisherOpenLibrary(q, 40).then(stripIsbns)
      // A series: Hardcover holds every member in order, including the ones not
      // out yet, which is the one place Open Library's index is thinnest. Two
      // Hardcover requests (find the series, then its books). Oldest first; a
      // book with no date yet (announced, not scheduled) goes last.
      : () => bothBookSources(c.env, "facet", 2, () => seriesOpenLibrary(q, 40), () => seriesHardcover(q, 40))
        .then((cards) => cards.sort((x, y) => (x.releaseDate ?? "9999").localeCompare(y.releaseDate ?? "9999")).slice(0, 40));
    // A week, as the games' facet answers: what a subject holds barely moves.
    return cached(c, `facet/books?kind=${kind}&q=${encodeURIComponent(q.toLowerCase())}`, 7 * 24 * HOUR, "facet", load);
  }

  return null;
}
