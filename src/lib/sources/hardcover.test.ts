import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getHardcoverBook, hardcoverCard, hardcoverConfigured, hardcoverCoverPath, hardcoverDate, HardcoverNotConfigured, hardcoverTags,
  isbn13, parseHardcoverBook, searchDocuments, searchHardcover, seriesHardcover, setHardcoverEnv, upcomingHardcover,
} from "@/lib/sources/hardcover";
import { bookIdentityKey, mergeBookCards, stripIsbns } from "@/lib/sources/bookPure";
import { bookCard, openLibraryWorkByIsbn } from "@/lib/sources/openlibrary";
import { __resetBreakers } from "@/lib/http";
import { extractFacets } from "@/lib/facets";
import { mergeLinks } from "@/lib/merge";
import type { MediaLink } from "@/types";

// Hardcover, the second book source (2026-10-17). The shapes are the ones its
// GraphQL schema reference documents (docs.hardcover.app/api/graphql/schemas/books)
// and its search guide; the rating and reader-count fields are IN the fixtures
// on purpose, so the tests can prove they never reach a record.
//
// ⚠️ A provider's shape is not verifiable from its documentation (AGENTS.md).
// What these prove is the mapping and the rules; the live shape was to be
// probed with the real token the day it arrived.

const ROW = {
  id: 426728, title: "The Doors of Stone", subtitle: "The Kingkiller Chronicle: Day Three", slug: "the-doors-of-stone",
  description: "The third day of Kvothe's story.", release_date: null, release_year: null, pages: null, editions_count: 3,
  compilation: false, is_partial_book: false, canonical_id: null, book_status_id: 1,
  image: { url: "https://assets.hardcover.app/editions/31843562/8162436135689143.jpg" },
  cached_tags: { Genre: [{ tag: "Fantasy", tagSlug: "fantasy", count: 40 }, { tag: "Fiction" }], Mood: [{ tag: "adventurous" }], "Content Warning": [{ tag: "Violence" }], Tag: [{ tag: "magic" }] },
  contributions: [{ contribution: "Author", author: { name: "Patrick Rothfuss" } }, { contribution: "Narrator", author: { name: "Nick Podehl" } }],
  featured_book_series: { position: 3, series: { id: 24, name: "The Kingkiller Chronicle" } },
  book_series: [{ position: 3, series: { id: 24, name: "The Kingkiller Chronicle" } }],
  // The same edition twice over: an ISBN-10 converts to the ISBN-13 beside it, so the record holds one.
  editions: [{ isbn_13: "9780756404079", isbn_10: "0756404074" }, { isbn_13: null, isbn_10: null }],
  // Other users' data, which a professional project may not use. Present here to prove they are dropped.
  rating: 4.4, ratings_count: 1200, users_count: 53000, users_read_count: 100, lists_count: 9, reviews_count: 12,
};

const SEARCH_DOC = {
  id: "426728", title: "The Doors of Stone", slug: "the-doors-of-stone", author_names: ["Patrick Rothfuss"],
  isbns: ["9780756404079"], release_year: null, release_date_i: null, series_names: ["The Kingkiller Chronicle"],
  featured_series: { name: "The Kingkiller Chronicle" }, featured_series_position: 3, genres: ["Fantasy"], tags: ["magic"],
  image: { url: "https://assets.hardcover.app/editions/31843562/8162436135689143.jpg" },
  rating: 4.4, ratings_count: 1200, users_count: 53000,
};

const DUNE_OL = {
  key: "/works/OL893414W", title: "Dune", first_publish_year: 1965, cover_i: 11481354, ratings_average: 4.3, ratings_count: 448,
  author_name: ["Frank Herbert"], publish_date: ["August 1965", "1965-08-01"], isbn: ["0441172717", "9780441172719", "9780340960196"],
  want_to_read_count: 5000, already_read_count: 3000, subject: ["Science fiction"],
};
const DUNE_HC = parseHardcoverBook({
  ...ROW, id: 1, title: "Dune", subtitle: null, slug: "dune", release_date: "1965-08-01", contributions: [{ contribution: "Author", author: { name: "Frank Herbert" } }],
  editions: [{ isbn_13: "9780441172719", isbn_10: null }], featured_book_series: null, book_series: [],
})!;

function answers(sequence: unknown[], status = 200) {
  const calls: { url: string; init: RequestInit & { headers?: Record<string, string> } }[] = [];
  let i = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init as any });
    const data = sequence[Math.min(i++, sequence.length - 1)];
    return new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}
const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body)) as { query: string; variables: Record<string, unknown> };

beforeEach(() => {
  __resetBreakers();
  setHardcoverEnv(() => ({ token: "test-token" }));
});
afterEach(() => vi.restoreAllMocks());

describe("a Hardcover record", () => {
  it("keeps the facts about the book and nothing other users made", () => {
    const b = parseHardcoverBook(ROW);
    expect(b).toEqual({
      id: 426728, title: "The Doors of Stone", subtitle: "The Kingkiller Chronicle: Day Three", slug: "the-doors-of-stone",
      description: "The third day of Kvothe's story.", releaseDate: null, authors: ["Patrick Rothfuss"],
      series: { name: "The Kingkiller Chronicle", position: 3 }, isbns: ["9780756404079"],
      cover: "https://fandex.org/v1/cover/hardcover/editions/31843562/8162436135689143.jpg",
      tags: ["Fantasy", "Fiction", "magic"], pages: null, editionsCount: 3, compilation: false, canonicalId: null,
    });
    // The rules: no rating, no count of readers, no lists. Not even by another name.
    expect(JSON.stringify(b)).not.toMatch(/rating|users_count|lists|reviews|53000|4\.4/);
  });

  it("reads the search index's document the same way", () => {
    const b = parseHardcoverBook(SEARCH_DOC);
    expect(b).toMatchObject({
      id: 426728, title: "The Doors of Stone", authors: ["Patrick Rothfuss"], isbns: ["9780756404079"],
      series: { name: "The Kingkiller Chronicle", position: 3 }, tags: ["Fantasy", "magic"],
      cover: "https://fandex.org/v1/cover/hardcover/editions/31843562/8162436135689143.jpg",
    });
    expect(searchDocuments({ found: 1, hits: [{ document: SEARCH_DOC }] })).toEqual([SEARCH_DOC]);
    expect(searchDocuments(JSON.stringify({ hits: [{ document: SEARCH_DOC }] }))).toEqual([SEARCH_DOC]);
    expect(searchDocuments([SEARCH_DOC])).toEqual([SEARCH_DOC]);
    expect(searchDocuments(null)).toEqual([]);
  });

  it("drops a deleted row, and keeps a duplicate's canonical id so the caller can follow it", () => {
    expect(parseHardcoverBook({ ...ROW, book_status_id: 3 })).toBeNull();
    expect(parseHardcoverBook({ ...ROW, canonical_id: 99 })?.canonicalId).toBe(99);
    expect(parseHardcoverBook({ ...ROW, canonical_id: ROW.id })?.canonicalId).toBeNull();
    expect(parseHardcoverBook({ title: "no id" })).toBeNull();
  });

  it("reads a date as the catalog keeps dates: January 1st is the year alone, the index's seconds are a day", () => {
    expect(hardcoverDate("2027-03-16", 2027)).toBe("2027-03-16");
    expect(hardcoverDate("2026-01-01", 2026)).toBe("2026");
    expect(hardcoverDate(null, 2012)).toBe("2012");
    expect(hardcoverDate(1_800_000_000, null)).toBe("2027-01-15");
    expect(hardcoverDate(null, null)).toBeNull();
  });

  it("turns an ISBN-10 into its ISBN-13 and refuses what is neither", () => {
    expect(isbn13("0756404074")).toBe("9780756404079");
    // Another edition of the same book: a different ISBN, not a typo of the one above.
    expect(isbn13("0756404746")).toBe("9780756404741");
    expect(isbn13("978-0-7564-0407-9")).toBe("9780756404079");
    expect(isbn13("080442957X")).toBe("9780804429573");
    expect(isbn13("abc")).toBeNull();
    expect(isbn13(null)).toBeNull();
  });

  it("takes genres and tags and leaves moods and content warnings out", () => {
    expect(hardcoverTags(ROW.cached_tags)).toEqual(["Fantasy", "Fiction", "magic"]);
    expect(hardcoverTags(JSON.stringify(ROW.cached_tags))).toEqual(["Fantasy", "Fiction", "magic"]);
    expect(hardcoverTags(null, ["Fantasy", "Fantasy"], [{ tag: "magic" }])).toEqual(["Fantasy", "magic"]);
  });

  it("only ever points a cover at Hardcover's asset host, under the shapes it uses", () => {
    expect(hardcoverCoverPath("https://assets.hardcover.app/editions/19454574/9509867934646082.jpg")).toBe("editions/19454574/9509867934646082.jpg");
    // Probed live 2026-10-17: the singular folder, a hash or a uuid for a file name, and a sized book image.
    expect(hardcoverCoverPath("https://assets.hardcover.app/edition/30399253/4012102f186dc02f51e56a849f8d76c6dd8d2dc9.jpeg")).toBe("edition/30399253/4012102f186dc02f51e56a849f8d76c6dd8d2dc9.jpeg");
    expect(hardcoverCoverPath("https://assets.hardcover.app/edition/31571207/601b0d78-4db6-4573-9927-a3af83802ba2.jpg")).toBe("edition/31571207/601b0d78-4db6-4573-9927-a3af83802ba2.jpg");
    expect(hardcoverCoverPath("https://assets.hardcover.app/books/1/291303-L.jpg")).toBe("books/1/291303-L.jpg");
    expect(hardcoverCoverPath("https://assets.hardcover.app/static/logos/hardcover-logo.jpeg")).toBeNull();
    expect(hardcoverCoverPath("https://hardcover.app/books/x/ogimage.png")).toBeNull();
    expect(hardcoverCoverPath("https://assets.hardcover.app/editions/1/../../x.jpg")).toBeNull();
  });

  it("makes a card with no votes and no rating: those are Hardcover's readers', not ours", () => {
    expect(hardcoverCard(parseHardcoverBook(ROW)!)).toEqual({
      source: "hardcover", sourceId: "426728", type: "book", title: "The Doors of Stone", releaseDate: null,
      posterUrl: "https://fandex.org/v1/cover/hardcover/editions/31843562/8162436135689143.jpg", votes: 0, rating: null, popularity: 0,
      genres: ["Fantasy", "Fiction", "magic"], authors: ["Patrick Rothfuss"], isbns: ["9780756404079"],
    });
  });
});

describe("the two book sources as one list", () => {
  const dune = bookCard(DUNE_OL)!;

  it("sees the same book through a shared ISBN, or the same title and author, and keeps Open Library's", () => {
    const hcDune = hardcoverCard(DUNE_HC);
    const byTitle = hardcoverCard({ ...DUNE_HC, id: 2, isbns: ["9999999999990"], title: "Dune: Deluxe Edition" });
    const other = hardcoverCard(parseHardcoverBook(ROW)!);
    const merged = mergeBookCards([dune], [hcDune, byTitle, other]);
    expect(merged.map((c) => `${c.source}:${c.sourceId}`)).toEqual(["openlibrary:OL893414W", "hardcover:426728"]);
    // Open Library's cover stays, though Hardcover has one too.
    expect(merged[0].posterUrl).toBe(dune.posterUrl);
    expect(stripIsbns(merged).every((c) => !("isbns" in c))).toBe(true);
  });

  it("gives a book Open Library has no cover for Hardcover's, and nothing else of Hardcover's", () => {
    const bare = { ...dune, posterUrl: null };
    const merged = mergeBookCards([bare], [hardcoverCard(DUNE_HC)]);
    expect(merged).toEqual([{ ...bare, posterUrl: DUNE_HC.cover }]);
    expect(bare.posterUrl).toBeNull();
  });

  it("keys a title without its subtitle or its article, plus the author's surname", () => {
    expect(bookIdentityKey({ title: "The Doors of Stone", authors: ["Patrick Rothfuss"] }))
      .toBe(bookIdentityKey({ title: "Doors of Stone: The Kingkiller Chronicle 3", authors: ["Patrick  Rothfuss"] }));
    // The surname only: "Herbert, Frank" and "Frank Herbert" are one author. A different surname is not.
    expect(bookIdentityKey({ title: "Dune", authors: ["Frank Herbert"] })).toBe(bookIdentityKey({ title: "Dune", authors: ["Herbert"] }));
    expect(bookIdentityKey({ title: "Dune", authors: ["Frank Herbert"] })).not.toBe(bookIdentityKey({ title: "Dune", authors: ["Kyle MacLachlan"] }));
  });

  it("gives the Open Library card authors and ISBNs, for the matching", () => {
    expect(dune.authors).toEqual(["Frank Herbert"]);
    expect(dune.isbns).toEqual(["9780441172719", "9780340960196"]);
  });
});

describe("a book held by both", () => {
  const olLink = { source: "openlibrary", sourceId: "OL893414W", rawData: { ...DUNE_OL, id: "OL893414W", series_name: ["Dune"] } } as unknown as MediaLink;
  const hcLink = { source: "hardcover", sourceId: "1", rawData: DUNE_HC } as unknown as MediaLink;

  it("takes its title, series and cover from Open Library, its date from Hardcover, and no Hardcover rating", () => {
    const m = mergeLinks([olLink, hcLink], "book");
    expect(m.title).toBe("Dune");
    expect(m.collection).toBe("Dune");
    expect(m.posterUrl).toBe("https://covers.openlibrary.org/b/id/11481354-L.jpg");
    // Hardcover's cover only where Open Library has none (Nils, 2026-10-17).
    const noCover = { ...olLink, rawData: { ...(olLink as any).rawData, cover_i: undefined } } as unknown as MediaLink;
    expect(mergeLinks([noCover, hcLink], "book").posterUrl).toBe(DUNE_HC.cover);
    expect(m.releaseDate).toBe("1965-08-01");
    expect(m.authors).toEqual(["Frank Herbert"]);
    // Open Library's first ISBN as it lists it: its normalizer predates Hardcover and is unchanged.
    expect(m.isbn).toBe("0441172717");
    expect(m.communityRatings.map((r) => r.source)).toEqual(["openlibrary"]);
    expect(m.storeLinks.map((l) => l.name)).toEqual(["Open Library", "Hardcover"]);
  });

  it("gives the score an author and a series off a Hardcover-only book", () => {
    const rothfuss = { source: "hardcover", sourceId: "426728", rawData: parseHardcoverBook(ROW) } as unknown as MediaLink;
    const m = mergeLinks([rothfuss], "book");
    expect(m).toMatchObject({ title: "The Doors of Stone", collection: "The Kingkiller Chronicle", releaseDate: null, communityRatings: [] });
    const facets = extractFacets([rothfuss], "book", m);
    expect(facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", role: "creator", label: "Patrick Rothfuss" }),
      expect.objectContaining({ kind: "ip", label: "The Kingkiller Chronicle" }),
      expect.objectContaining({ kind: "tag", label: "Fantasy" }),
    ]));
  });
});

describe("talking to Hardcover", () => {
  it("sends one top-level query with the token as a bearer, whichever way the token was pasted", async () => {
    for (const token of ["test-token", "Bearer test-token"]) {
      setHardcoverEnv(() => ({ token }));
      const calls = answers([{ search: { results: { hits: [{ document: SEARCH_DOC }] } } }]);
      const cards = await searchHardcover("doors of stone");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.hardcover.app/v1/graphql");
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.headers?.Authorization).toBe("Bearer test-token");
      const b = body(calls[0]);
      expect(b.variables).toMatchObject({ q: "doors of stone" });
      expect((b.query.match(/\bsearch\(/g) ?? []).length).toBe(1);
      expect(cards).toEqual([expect.objectContaining({ source: "hardcover", sourceId: "426728", title: "The Doors of Stone", authors: ["Patrick Rothfuss"] })]);
      vi.restoreAllMocks();
    }
  });

  it("follows a duplicate to the book it duplicates", async () => {
    const calls = answers([{ books: [{ ...ROW, canonical_id: 7 }] }, { books: [{ ...ROW, id: 7 }] }]);
    const b = await getHardcoverBook("426728");
    expect(b?.id).toBe(7);
    expect(calls.map((c) => body(c).variables.id)).toEqual([426728, 7]);
    expect(await getHardcoverBook("x")).toBeNull();
  });

  it("finds a series by search, the exact name over the first hit, then asks for its books in order", async () => {
    const calls = answers([
      { search: { results: { hits: [{ document: { id: "9", name: "The Kingkiller Chronicle Companion" } }, { document: { id: "24", name: "The Kingkiller Chronicle" } }] } } },
      { series: [{ name: "The Kingkiller Chronicle", book_series: [
        // What Hardcover listed on 2026-10-17: the book, then its copies at the same position.
        { position: 1, book: { ...ROW, id: 1, title: "The Name of the Wind", editions_count: 108 } },
        { position: 1, book: { ...ROW, id: 2, title: "El nombre del viento", editions_count: 1 } },
        { position: 1, book: { ...ROW, id: 3, title: "The Name of the Wind Limited Edition - Full Color", editions_count: 1, image: null } },
        { position: 1, book: { ...ROW, id: 4, title: "Kingkiller Chronicle Patrick Rothfuss Collection 3 Books Set", editions_count: 1 } },
        { position: 1.1, book: { ...ROW, id: 5, title: "The Name of the Wind, Book 1", is_partial_book: true } },
        { position: 3, book: ROW },
      ] }] },
    ]);
    const cards = await seriesHardcover("the kingkiller chronicle");
    expect(body(calls[1]).variables).toMatchObject({ id: 24 });
    // One per position, the one with the most editions; no box set, no part, nothing without a cover.
    expect(cards.map((c) => c.title)).toEqual(["The Name of the Wind", "The Doors of Stone"]);
  });

  it("lists only a book with a cover: a record without one is a translation, a bundle or a stub", async () => {
    answers([{ search: { results: { hits: [{ document: SEARCH_DOC }, { document: { ...SEARCH_DOC, id: "77", title: "Not Yet Announced", image: null } }] } } }]);
    expect((await searchHardcover("doors")).map((c) => c.sourceId)).toEqual(["426728"]);
  });

  it("asks for a month's books by the month's bounds, and leaves a part of a book out", async () => {
    const calls = answers([{ books: [ROW, { ...ROW, id: 5, title: "Part One", is_partial_book: true }] }]);
    expect((await upcomingHardcover("2026-12")).map((c) => c.sourceId)).toEqual(["426728"]);
    expect(body(calls[0]).variables).toMatchObject({ from: "2026-12-01", to: "2027-01-01" });
    expect(await upcomingHardcover("2026-13")).toEqual([]);
  });

  it("reads a GraphQL error and a bad status as failures, never as an empty answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "field 'nope' not found" }] }), { status: 200 }));
    await expect(searchHardcover("dune")).rejects.toThrow(/field 'nope'/);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(searchHardcover("dune")).rejects.toThrow(/429/);
  });
});

describe("matching a Hardcover book at Open Library", () => {
  const olAnswers = (docs: unknown[]) => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ docs }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return calls;
  };

  it("asks by several ISBNs at once and answers the work", async () => {
    const calls = olAnswers([{ key: "/works/OL893414W", title: "Dune", cover_i: 11481354, ratings_count: 448 }]);
    expect(await openLibraryWorkByIsbn(["9780441172719", "0441172717", "bad"])).toBe("OL893414W");
    expect(decodeURIComponent(calls[0])).toContain("isbn:(9780441172719 OR 0441172717)");
  });

  it("lets no stub claim a book: Open Library's Doors of Stone is a coverless, unrated placeholder", async () => {
    // Probed 2026-10-17: Hardcover's placeholder editions share their ISBNs with
    // OL35688235W "Untitled Rothfuss 3 Of 3", and that title must not win.
    olAnswers([{ key: "/works/OL35688235W", title: "Untitled Rothfuss 3 Of 3", first_publish_year: 2012 }]);
    expect(await openLibraryWorkByIsbn(["9780575081468"])).toBeNull();
    expect(await openLibraryWorkByIsbn([])).toBeNull();
  });
});

describe("the kill switch", () => {
  it("is on with a token, off without one, and off on an explicit 0 or false only", () => {
    setHardcoverEnv(() => ({ token: "t" }));
    expect(hardcoverConfigured()).toBe(true);
    setHardcoverEnv(() => ({}));
    expect(hardcoverConfigured()).toBe(false);
    for (const enabled of ["0", "false", "FALSE"]) {
      setHardcoverEnv(() => ({ token: "t", enabled }));
      expect(hardcoverConfigured(), enabled).toBe(false);
    }
    // A typo must leave the site working (the IGDB switch's rule).
    for (const enabled of ["1", "true", "", "  ", "off-ish"]) {
      setHardcoverEnv(() => ({ token: "t", enabled }));
      expect(hardcoverConfigured(), enabled).toBe(true);
    }
  });

  it("makes no request while off, and says so", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    setHardcoverEnv(() => ({ token: "t", enabled: "0" }));
    await expect(searchHardcover("dune")).rejects.toBeInstanceOf(HardcoverNotConfigured);
    await expect(getHardcoverBook(1)).rejects.toBeInstanceOf(HardcoverNotConfigured);
    await expect(seriesHardcover("dune")).rejects.toBeInstanceOf(HardcoverNotConfigured);
    await expect(upcomingHardcover("2026-11")).rejects.toBeInstanceOf(HardcoverNotConfigured);
    expect(spy).not.toHaveBeenCalled();
  });

  it("opts its one call site into the 401/403 latch: the token is ours, for everybody", () => {
    // httpCallSites.test.ts only sees an app key in a URL; this one rides in a header.
    const src = readFileSync(join(process.cwd(), "src", "lib", "sources", "hardcover.ts"), "utf8");
    const call = src.slice(src.indexOf("httpFetch(ENDPOINT"), src.indexOf("});", src.indexOf("httpFetch(ENDPOINT")));
    expect(call).toContain("appScopedAuth: true");
  });
});
