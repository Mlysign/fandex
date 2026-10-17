import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearBrowsePageCache } from "@/lib/discoverFeed";
import { __resetBreakers } from "@/lib/http";
import { calendarMonth } from "../src/calendar";
import { validResolveTarget } from "../src/catalog/resolve";
import type { Env } from "../src/env";
import worker from "../src/index";
import { count, db, env, wipe } from "./helpers";

// Hardcover as the second book source (2026-10-17): the merged search and
// series answers, the cover copied into R2, a Hardcover id resolved to its Open
// Library work first, the calendar's merged books, and the "off" state, which
// has to be exactly what the routes answered before Hardcover existed.
//
// The suite runs with HARDCOVER_TOKEN set (vitest.config.ts); `OFF` is the
// same Worker without it. Provider calls are faked at `fetch`; the Hardcover
// fake answers by what the GraphQL query asks for.

const OFF = { ...env, HARDCOVER_TOKEN: undefined } as Env;

async function call(path: string, init: RequestInit = {}, e: Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://api.test${path}`, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const HC_ROW = (over: Record<string, unknown> = {}) => ({
  id: 426728, title: "The Doors of Stone", slug: "the-doors-of-stone", description: "Day three.", release_date: null, release_year: null,
  pages: null, editions_count: 2, compilation: false, is_partial_book: false, canonical_id: null, book_status_id: 1,
  image: { url: "https://assets.hardcover.app/editions/31843562/8162436135689143.jpg" },
  cached_tags: { Genre: [{ tag: "Fantasy" }] },
  contributions: [{ contribution: "Author", author: { name: "Patrick Rothfuss" } }],
  featured_book_series: { position: 3, series: { id: 24, name: "The Kingkiller Chronicle" } }, book_series: [],
  // No ISBN: the book is announced, not printed. A test that wants one passes it.
  editions: [],
  rating: 4.4, ratings_count: 100, users_count: 9000,
  ...over,
});
const OL_DOC = (over: Record<string, unknown> = {}) => ({
  key: "/works/OL8479867W", title: "The Name of the Wind", first_publish_year: 2007, cover_i: 8259447, ratings_average: 4.4, ratings_count: 900,
  author_name: ["Patrick Rothfuss"], publish_date: ["March 27, 2007"], isbn: ["0756404746", "9780756404079"], want_to_read_count: 20, already_read_count: 30,
  subject: ["Fantasy"], language: ["eng"], ...over,
});
const COVER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

interface Fake {
  hardcover?: (query: string, variables: Record<string, unknown>) => unknown;
  openlibrary?: (url: string) => unknown;
  assets?: (url: string) => Response;
}

/** Fake every provider. Anything unhandled fails the test loudly. */
function providers(f: Fake) {
  const calls: { url: string; query?: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.hardcover.app/")) {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      calls.push({ url, query: body.query });
      if (!f.hardcover) throw new Error("unexpected Hardcover call");
      return Response.json({ data: f.hardcover(body.query, body.variables) });
    }
    calls.push({ url });
    if (url.startsWith("https://openlibrary.org/") && f.openlibrary) return Response.json(f.openlibrary(url));
    if (url.startsWith("https://assets.hardcover.app/") && f.assets) return f.assets(url);
    if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
    if (url.includes("api.themoviedb.org") || url.includes("api.igdb.com")) return new Response("down", { status: 500 });
    throw new Error(`unexpected provider call: ${url}`);
  });
  return calls;
}
const hardcoverCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("https://api.hardcover.app/"));

/** Hardcover's search for "name of the wind": the Open Library book again (same ISBN), and the one only it knows. */
const searchAnswer = (query: string) => (query.includes("search(")
  ? { search: { results: { hits: [
      { document: { id: "1", title: "The Name of the Wind", author_names: ["Patrick Rothfuss"], isbns: ["9780756404079"], release_year: 2007, image: { url: "https://assets.hardcover.app/editions/1/aaa.jpg" } } },
      { document: { id: "426728", title: "The Doors of Stone", author_names: ["Patrick Rothfuss"], isbns: [], release_year: null, image: { url: "https://assets.hardcover.app/editions/31843562/8162436135689143.jpg" } } },
    ] } } }
  : {});

beforeEach(async () => {
  await wipe();
  clearBrowsePageCache();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("search", () => {
  it("answers Open Library's books first, then the book only Hardcover knows, without ISBNs on the wire", async () => {
    const calls = providers({ hardcover: searchAnswer, openlibrary: () => ({ docs: [OL_DOC()] }) });
    const res = await call("/v1/search/books?q=name%20of%20the%20wind");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: any[] };
    expect(results.map((r) => `${r.source}:${r.sourceId}`)).toEqual(["openlibrary:OL8479867W", "hardcover:426728"]);
    expect(results[1]).toMatchObject({
      title: "The Doors of Stone", authors: ["Patrick Rothfuss"], votes: 0, rating: null,
      posterUrl: "https://fandex.org/v1/cover/hardcover/editions/31843562/8162436135689143.jpg",
    });
    expect(results.some((r) => "isbns" in r)).toBe(false);
    expect(results[0].authors).toEqual(["Patrick Rothfuss"]);
    expect(hardcoverCalls(calls)).toHaveLength(1);
    // One request against Hardcover's day, counted.
    expect(await count("daily_budget", "kind = 'hardcover' AND n = 1")).toBe(1);
  });

  it("is Open Library alone without the token, with no Hardcover call and no budget row", async () => {
    const calls = providers({ openlibrary: () => ({ docs: [OL_DOC()] }) });
    expect(await (await call("/v1/features", {}, OFF)).json()).toMatchObject({ books: true, hardcover: false });
    expect(await (await call("/v1/features")).json()).toMatchObject({ books: true, hardcover: true });
    const res = await call("/v1/search/books?q=the%20name%20of%20the%20wind", {}, OFF);
    expect(((await res.json()) as any).results.map((r: any) => r.source)).toEqual(["openlibrary"]);
    expect(hardcoverCalls(calls)).toHaveLength(0);
    expect(await count("daily_budget", "kind = 'hardcover'")).toBe(0);
  });

  it("stops asking Hardcover once the day's cap is spent, and the answer still comes", async () => {
    const calls = providers({ openlibrary: () => ({ docs: [OL_DOC()] }) });
    const res = await call("/v1/search/books?q=wind%20rothfuss", {}, { ...env, HARDCOVER_DAILY_CAP: "0" } as Env);
    expect(res.status).toBe(200);
    expect(hardcoverCalls(calls)).toHaveLength(0);
  });

  it("answers Open Library's books when Hardcover fails, and Hardcover's when Open Library does", async () => {
    providers({ hardcover: () => { throw new Error("boom"); }, openlibrary: () => ({ docs: [OL_DOC()] }) });
    expect(((await (await call("/v1/search/books?q=rothfuss%20wind%20name")).json()) as any).results).toHaveLength(1);
    vi.restoreAllMocks();
    __resetBreakers();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.hardcover.app/")) return Response.json({ data: searchAnswer(JSON.parse(String(init?.body)).query) });
      return new Response("down", { status: 500 });
    });
    const res = await call("/v1/search/books?q=patrick%20rothfuss%20wind");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).results.map((r: any) => r.source)).toEqual(["hardcover", "hardcover"]);
  });

  it("puts a series' books in date order with the undated one last, Hardcover's members included", async () => {
    providers({
      hardcover: (query, variables) => (query.includes('query_type: "Series"')
        ? { search: { results: { hits: [{ document: { id: "24", name: "The Kingkiller Chronicle" } }] } } }
        : { series: [{ name: "The Kingkiller Chronicle", book_series: [
            { position: 1, book: HC_ROW({ id: 1, title: "The Name of the Wind", release_date: "2007-03-27", editions: [{ isbn_13: "9780756404079" }] }) },
            { position: 3, book: HC_ROW() },
          ] }] }),
      openlibrary: () => ({ docs: [OL_DOC()] }),
    });
    const res = await call("/v1/facet/books?kind=franchise&q=The%20Kingkiller%20Chronicle");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: any[] };
    expect(results.map((r) => `${r.source}:${r.sourceId}`)).toEqual(["openlibrary:OL8479867W", "hardcover:426728"]);
  });
});

describe("a cover", () => {
  it("is copied from Hardcover once, kept in R2, and served immutable from then on", async () => {
    const calls = providers({ assets: () => new Response(COVER, { headers: { "Content-Type": "image/jpeg" } }) });
    const first = await call("/v1/cover/hardcover/editions/1/abc.jpg");
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("image/jpeg");
    expect(first.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(COVER);
    expect(await env.COVERS.get("hardcover/editions/1/abc.jpg")).not.toBeNull();
    expect(await count("daily_budget", "kind = 'cover' AND n = 1")).toBe(1);

    // A cover R2 already holds is served without asking Hardcover, even with Hardcover off.
    await env.COVERS.put("hardcover/editions/2/held.jpg", COVER, { httpMetadata: { contentType: "image/png" } });
    const held = await call("/v1/cover/hardcover/editions/2/held.jpg", {}, OFF);
    expect(held.status).toBe(200);
    expect(held.headers.get("Content-Type")).toBe("image/png");
    expect(calls.filter((c) => c.url.startsWith("https://assets.hardcover.app/"))).toHaveLength(1);

    const head = await call("/v1/cover/hardcover/editions/2/held.jpg", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("refuses an address that is not a cover's, a file that is not an image, and a new copy while off", async () => {
    const calls = providers({ assets: () => new Response("<html>", { headers: { "Content-Type": "text/html" } }) });
    expect((await call("/v1/cover/hardcover/static/logos/hardcover-logo.jpeg")).status).toBe(400);
    expect((await call("/v1/cover/hardcover/editions/1/abc.exe")).status).toBe(400);
    expect((await call("/v1/cover/hardcover/editions/3/page.jpg")).status).toBe(502);
    expect(await env.COVERS.get("hardcover/editions/3/page.jpg")).toBeNull();
    expect((await call("/v1/cover/hardcover/editions/4/new.jpg", {}, OFF)).status).toBe(404);
    expect(calls.filter((c) => c.url.startsWith("https://assets.hardcover.app/"))).toHaveLength(1);
    expect((await call("/v1/cover/hardcover/editions/1/abc.jpg", { method: "POST" })).status).toBe(405);
  });
});

describe("resolving a Hardcover id", () => {
  it("takes a book's type and id shape", () => {
    expect(validResolveTarget("hardcover", "book", "426728")).toBe(true);
    expect(validResolveTarget("hardcover", "book", "OL1W")).toBe(false);
    expect(validResolveTarget("hardcover", "movie", "1")).toBe(false);
  });

  it("becomes the Open Library work when Open Library has an edition with one of its ISBNs, with the Hardcover link attached", async () => {
    const calls = providers({
      hardcover: () => ({ books: [HC_ROW({ id: 1, title: "The Name of the Wind", release_date: "2007-03-27", editions: [{ isbn_13: "9780756404079" }] })] }),
      openlibrary: (url) => (url.includes("q=isbn") ? { docs: [OL_DOC()] }
        : url.includes("/works/OL8479867W.json") ? { key: "/works/OL8479867W", title: "The Name of the Wind", description: "Kvothe." }
        : url.includes("editions.json") ? { entries: [] }
        : { docs: [OL_DOC()] }),
    });
    const res = await call("/v1/resolve/hardcover/book/1");
    expect(res.status).toBe(200);
    const { id, created } = (await res.json()) as { id: string; created: boolean };
    expect(created).toBe(true);
    const links = await db.prepare("SELECT source, source_id FROM media_links WHERE media_item_id = ? ORDER BY source").bind(id).all<{ source: string; source_id: string }>();
    expect(links.results).toEqual([{ source: "hardcover", source_id: "1" }, { source: "openlibrary", source_id: "OL8479867W" }]);
    const item = await db.prepare("SELECT title, poster_url, release_date FROM media_items WHERE id = ?").bind(id).first<{ title: string; poster_url: string; release_date: string }>();
    // The title and the cover are Open Library's (the identity, and it has a cover); the day is Hardcover's.
    expect(item).toEqual({ title: "The Name of the Wind", poster_url: "https://covers.openlibrary.org/b/id/8259447-L.jpg", release_date: "2007-03-27" });
    expect(calls.some((c) => c.url.includes("q=isbn%3A"))).toBe(true);

    // Held now: the same id again is one indexed read, no provider call.
    const before = calls.length;
    expect(await (await call("/v1/resolve/hardcover/book/1")).json()).toEqual({ id, created: false });
    expect(calls.length).toBe(before);
    expect(await (await call("/v1/resolve/openlibrary/book/OL8479867W")).json()).toEqual({ id, created: false });
  });

  it("is created under its own id when Open Library has no edition of it, and the page credits both", async () => {
    providers({ hardcover: () => ({ books: [HC_ROW()] }), openlibrary: () => ({ docs: [] }) });
    const res = await call("/v1/resolve/hardcover/book/426728");
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(await count("media_links", "media_item_id = ? AND source = 'hardcover'", [id])).toBe(1);
    const detail = (await (await call(`/v1/items/${id}`)).json()) as any;
    expect(detail.vector.title).toBe("The Doors of Stone");
    expect(detail.vector.sources).toEqual([{ source: "hardcover", sourceId: "426728" }]);
    expect(detail.merged.collection).toBe("The Kingkiller Chronicle");
    expect(detail.merged.communityRatings).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/users_count|ratings_count|9000/);
  });

  it("is not found while Hardcover is off, and a bad id is a bad request", async () => {
    const calls = providers({});
    expect((await call("/v1/resolve/hardcover/book/426728", {}, OFF)).status).toBe(404);
    expect((await call("/v1/resolve/hardcover/book/OL1W")).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("the calendar", () => {
  it("places the month's books from both sources, a book both know once, as Open Library's", async () => {
    providers({
      hardcover: () => ({ books: [
        HC_ROW({ id: 1, title: "The Name of the Wind", release_date: "2026-12-10", editions: [{ isbn_13: "9780756404079" }] }),
        HC_ROW({ release_date: "2026-12-15" }),
        HC_ROW({ id: 3, title: "No cover, no place", release_date: "2026-12-16", image: null }),
      ] }),
      openlibrary: () => ({ docs: [OL_DOC({ first_publish_year: 2026, publish_date: ["December 10, 2026"] })] }),
    });
    const out = await calendarMonth(env, "2026-12", "DE", undefined, new Date("2026-10-17T12:00:00Z"));
    expect(out.ok).toBe(true);
    const items = JSON.parse((out as { body: string }).body).data.items as any[];
    expect(items.map((i) => `${i.source}:${i.sourceId}`)).toEqual(["openlibrary:OL8479867W", "hardcover:426728"]);
    expect(items[1]).toMatchObject({ releaseDate: "2026-12-15", voteCount: 0, voteAverage: null });
  });
});
