import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { upsertMediaItem } from "../src/catalog/ingest";
import type { Env } from "../src/env";
import {
  HARDCOVER_MOODS_DUE_SQL, HARDCOVER_RECHECK_DAYS, HARDCOVER_WALK_DUE_SQL, runHardcoverWalkStep,
} from "../src/hardcoverWalk";
import { count, db, env, wipe } from "./helpers";

// Hardcover onto the books held from Open Library (2026-11-02): Dune Messiah's
// page showed none of Hardcover's moods, because nothing ever asked Hardcover
// about a book that came in through Open Library. Provider calls are faked at
// `fetch`; the Hardcover fake answers by the GraphQL field asked for.

const OFF = { ...env, HARDCOVER_TOKEN: undefined } as Env;

const OL = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  source: "openlibrary" as const, sourceId: id, type: "book" as const, title, releaseDate: "1969",
  rawData: { key: `/works/${id}`, id, title, author_name: ["Frank Herbert"], first_publish_year: 1969, isbn: ["0441172695"], subject: ["Science fiction"], language: ["eng"], ...over },
});

const MESSIAH = {
  id: 11, title: "Dune Messiah", slug: "dune-messiah", description: "Paul, twelve years on.", release_date: "1969-10-15", release_year: 1969,
  pages: 256, editions_count: 300, compilation: false, is_partial_book: false, canonical_id: null, book_status_id: 1,
  image: null, contributions: [{ contribution: "Author", author: { name: "Frank Herbert" } }],
  cached_tags: { Genre: [{ tag: "Science Fiction" }], Mood: [{ tag: "Dark" }, { tag: "Reflective" }, { tag: "Tense" }], "Content Warning": [{ tag: "Violence" }] },
  featured_book_series: { position: 2, series: { id: 1, name: "Dune" } }, book_series: [], editions: [{ isbn_13: "9780441172696" }],
  rating: 3.9, users_count: 40000,
};

interface Hc { editions?: unknown[]; search?: unknown[]; books?: (id: number) => unknown[] }

function hardcover(answer: Hc) {
  const queries: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.hardcover.app/")) throw new Error(`unexpected provider call: ${url}`);
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    queries.push(query);
    if (/^\s*query \(\$isbns/.test(query)) return Response.json({ data: { editions: answer.editions ?? [] } });
    if (query.includes("search(")) return Response.json({ data: { search: { results: { hits: (answer.search ?? []).map((document) => ({ document })) } } } });
    if (query.includes("books(where: {id")) return Response.json({ data: { books: answer.books?.(Number(variables.id)) ?? [] } });
    throw new Error(`unexpected Hardcover query: ${query.slice(0, 80)}`);
  });
  return queries;
}

const itemOf = async (source: string, id: string) =>
  (await db.prepare("SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?").bind(source, id).first<{ media_item_id: string }>())?.media_item_id;
const merged = async (itemId: string) =>
  JSON.parse((await db.prepare("SELECT merged FROM item_doc WHERE media_item_id = ?").bind(itemId).first<{ merged: string }>())!.merged);
const rawOf = async (source: string, id: string) =>
  JSON.parse((await db.prepare("SELECT raw_data FROM media_links WHERE source = ? AND source_id = ?").bind(source, id).first<{ raw_data: string }>())!.raw_data);

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("the Hardcover walk", () => {
  it("attaches the Hardcover book to an Open Library book, and the page gains its moods", async () => {
    await upsertMediaItem(db, OL("OL893415W", "Dune Messiah"));
    const queries = hardcover({ editions: [{ book: MESSIAH }] });

    const r = await runHardcoverWalkStep(env);
    expect(r).toMatchObject({ linked: 1, absent: 0, failed: 0, budget: false });
    expect(queries).toHaveLength(1);

    const item = (await itemOf("openlibrary", "OL893415W"))!;
    expect(await itemOf("hardcover", "11")).toBe(item);
    const m = await merged(item);
    expect(m.tags.map((t: string) => t.toLowerCase())).toEqual(expect.arrayContaining(["science fiction", "dark", "reflective", "tense"]));
    expect(m.tags).not.toContain("Violence");
    // Open Library stays the identity; the day comes from Hardcover, the same year as Open Library's.
    expect(m.title).toBe("Dune Messiah");
    expect(m.releaseDate).toBe("1969-10-15");
    // Facts only.
    expect(JSON.stringify(await rawOf("hardcover", "11"))).not.toMatch(/rating|users_count|40000/);
    // Two requests counted against both days: the walk's and Hardcover's.
    expect(await count("daily_budget", "kind = 'hardcover_walk' AND n = 1")).toBe(1);
    expect(await count("daily_budget", "kind = 'hardcover' AND n = 1")).toBe(1);
  });

  it("falls back to a search by title and author, and stamps a book Hardcover does not have", async () => {
    await upsertMediaItem(db, OL("OL1W", "Children of Dune", { isbn: [] }));
    await upsertMediaItem(db, OL("OL2W", "God Emperor of Dune"));
    hardcover({
      editions: [],
      search: [
        { id: "30", title: "Children of Dune", author_names: ["Frank Herbert"], moods: ["Dark"], genres: ["Science Fiction"] },
        { id: "31", title: "God Emperor of Dune", author_names: ["Someone Else"] },
      ],
    });
    const now = 1_800_000_000;
    const r = await runHardcoverWalkStep(env, 3, now);
    expect(r).toMatchObject({ linked: 1, absent: 1 });
    expect(await itemOf("hardcover", "30")).toBe(await itemOf("openlibrary", "OL1W"));
    expect(await count("media_links", "source = 'hardcover'")).toBe(1);
    // Not the same book (another author): stamped, and left out until the recheck window passes.
    expect((await rawOf("openlibrary", "OL2W")).hardcoverChecked).toBe(now);
    const due = (at: number) => db.prepare(HARDCOVER_WALK_DUE_SQL).bind("", at - HARDCOVER_RECHECK_DAYS * 86_400, 10).all();
    expect((await due(now + 86_400)).results).toHaveLength(0);
    expect((await due(now + (HARDCOVER_RECHECK_DAYS + 1) * 86_400)).results).toHaveLength(1);
  });

  it("parks for a day at the end of a pass, then starts over for the books stored since", async () => {
    await upsertMediaItem(db, OL("OL1W", "Dune Messiah"));
    hardcover({ editions: [{ book: MESSIAH }] });
    expect((await runHardcoverWalkStep(env)).linked).toBe(1);
    expect((await runHardcoverWalkStep(env)).linked).toBe(0); // the pass is through: parked
    expect(await db.prepare("SELECT value FROM kv WHERE key = 'hardcover_walk_cursor'").first("value")).toBe("");
    // A book stored while parked waits for the park to lapse.
    await upsertMediaItem(db, { ...OL("OL0W", "Dune Messiah", { first_publish_year: 1990 }), releaseDate: "1990" });
    expect((await runHardcoverWalkStep(env)).absent + (await runHardcoverWalkStep(env)).linked).toBe(0);
    await db.prepare("DELETE FROM kv WHERE key = 'hardcover_walk_idle'").run();
    // The same Hardcover book is already on another item: stamped, never moved.
    const r = await runHardcoverWalkStep(env);
    expect(r).toMatchObject({ linked: 0, absent: 1 });
    expect(await itemOf("hardcover", "11")).toBe(await itemOf("openlibrary", "OL1W"));
  });

  it("stops at the walk's own cap, before Hardcover's shared one, and files nothing it did not ask", async () => {
    await upsertMediaItem(db, OL("OL1W", "Dune Messiah"));
    const queries = hardcover({ editions: [{ book: MESSIAH }] });
    const r = await runHardcoverWalkStep({ ...env, HARDCOVER_WALK_DAILY_CAP: "0" } as Env);
    expect(r.budget).toBe(true);
    expect(queries).toHaveLength(0);
    expect((await rawOf("openlibrary", "OL1W")).hardcoverChecked).toBeUndefined();
    expect(await count("daily_budget", "kind = 'hardcover'")).toBe(0);
  });

  it("does nothing while Hardcover is off, and leaves a failing book unstamped for the next pass", async () => {
    await upsertMediaItem(db, OL("OL1W", "Dune Messiah"));
    hardcover({});
    expect(await runHardcoverWalkStep(OFF)).toMatchObject({ linked: 0, absent: 0, failed: 0 });
    expect(await count("daily_budget")).toBe(0);
    vi.restoreAllMocks();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ errors: [{ message: "field not allowed" }] }));
    const r = await runHardcoverWalkStep(env);
    expect(r).toMatchObject({ failed: 1, linked: 0, absent: 0 });
    expect((await rawOf("openlibrary", "OL1W")).hardcoverChecked).toBeUndefined();
  });

  it("gives a Hardcover link stored before moods its moods, and nothing else of the record changes", async () => {
    const old = { id: 11, title: "Dune Messiah", tags: ["Science Fiction"], authors: ["Frank Herbert"], isbns: [], cover: null, slug: "dune-messiah" };
    await upsertMediaItem(db, { source: "hardcover", sourceId: "11", type: "book", title: "Dune Messiah", releaseDate: "1969-10-15", rawData: old });
    expect((await db.prepare(HARDCOVER_MOODS_DUE_SQL).bind(5).all()).results).toHaveLength(1);
    hardcover({ books: (id) => (id === 11 ? [MESSIAH] : []) });

    const r = await runHardcoverWalkStep(env);
    expect(r.moods).toBe(1);
    const raw = await rawOf("hardcover", "11");
    expect(raw).toMatchObject({ ...old, moods: ["Dark", "Reflective", "Tense"] });
    expect((await merged((await itemOf("hardcover", "11"))!)).tags).toEqual(expect.arrayContaining(["Dark", "Reflective"]));
    expect((await db.prepare(HARDCOVER_MOODS_DUE_SQL).bind(5).all()).results).toHaveLength(0);
  });

  it("reads the Open Library links from its cursor by the primary key, and probes for a Hardcover link by the item index", async () => {
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${HARDCOVER_WALK_DUE_SQL}`).bind("", 1, 3).all<{ detail: string }>()).results.map((r) => r.detail);
    expect(plan.some((d) => /SEARCH l USING (PRIMARY KEY|INDEX sqlite_autoindex_media_links)/.test(d)), plan.join(" | ")).toBe(true);
    expect(plan.some((d) => /SEARCH h USING (COVERING )?INDEX idx_links_item/.test(d)), plan.join(" | ")).toBe(true);
    expect(plan.some((d) => /SCAN (l|h)\b/.test(d)), plan.join(" | ")).toBe(false);

    for (let i = 0; i < 20; i++) await upsertMediaItem(db, OL(`OL${100 + i}W`, `Book ${i}`));
    const res = await db.prepare(HARDCOVER_WALK_DUE_SQL).bind("", 1, 3).all();
    expect(res.results).toHaveLength(3);
    expect(res.meta.rows_read).toBeLessThanOrEqual(20);
  });
});
