import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { upsertMediaItem } from "../src/catalog/ingest";
import { OPEN_LIBRARY_TITLES_DUE_SQL, runOpenLibraryTitlesStep } from "../src/openLibraryTitles";
import { db, env, wipe } from "./helpers";

// The Open Library books stored before their titles per language (2026-11-21):
// The Way of Kings reads "Der Weg der Könige" to a German account, and only
// Open Library's editions know that. Open Library is faked at `fetch`.

const OL = (id: string, title: string) => ({
  source: "openlibrary" as const, sourceId: id, type: "book" as const, title, releaseDate: "2010",
  rawData: { key: `/works/${id}`, id, title, author_name: ["Brandon Sanderson"], first_publish_year: 2010, subject: ["Fantasy"], language: ["eng", "ger"] },
});

const EDITIONS: Record<string, unknown[]> = {
  OL15358691W: [
    { title: "The way of kings", languages: [{ key: "/languages/eng" }] },
    { title: "Der Weg der Könige", languages: [{ key: "/languages/ger" }] },
  ],
  OL2W: [{ title: "Untitled" }],
};

function openLibrary() {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const m = /openlibrary\.org\/works\/(OL\d+W)\/editions\.json/.exec(url);
    if (!m) throw new Error(`unexpected provider call: ${url}`);
    asked.push(m[1]);
    return Response.json({ entries: EDITIONS[m[1]] ?? [] });
  });
  return asked;
}

const itemOf = async (id: string) =>
  (await db.prepare("SELECT media_item_id FROM media_links WHERE source = 'openlibrary' AND source_id = ?").bind(id).first<{ media_item_id: string }>())!.media_item_id;
const docOf = async (itemId: string) => {
  const row = await db.prepare("SELECT merged, vector FROM item_doc WHERE media_item_id = ?").bind(itemId).first<{ merged: string; vector: string }>();
  return { merged: JSON.parse(row!.merged), vector: JSON.parse(row!.vector) };
};

beforeEach(async () => {
  await wipe();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("the Open Library titles walk", () => {
  it("gives each stored book its titles per language once, onto the page and the catalog's vector, then parks", async () => {
    await upsertMediaItem(db, OL("OL15358691W", "The Way of Kings"));
    await upsertMediaItem(db, OL("OL2W", "Another Book"));
    expect((await db.prepare(OPEN_LIBRARY_TITLES_DUE_SQL).bind("", 5).all()).results).toHaveLength(2);
    const asked = openLibrary();

    expect(await runOpenLibraryTitlesStep(env)).toEqual({ titled: 2, failed: 0 });
    expect(asked).toEqual(["OL15358691W", "OL2W"]);
    const { merged, vector } = await docOf(await itemOf("OL15358691W"));
    expect(merged.titles).toEqual({ en: "", de: "Der Weg der Könige" });
    expect(vector.titles).toEqual({ en: "", de: "Der Weg der Könige" });
    expect(merged.title).toBe("The Way of Kings");
    // A book no edition names a language for leaves the query too.
    expect((await db.prepare(OPEN_LIBRARY_TITLES_DUE_SQL).bind("", 5).all()).results).toHaveLength(0);

    expect(await runOpenLibraryTitlesStep(env)).toEqual({ titled: 0, failed: 0 });
    expect(await runOpenLibraryTitlesStep(env)).toBeNull();
    expect(asked).toHaveLength(2);
  });
});
