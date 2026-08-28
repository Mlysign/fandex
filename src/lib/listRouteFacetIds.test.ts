import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// 2026-08-28 — the Filters sheet's must-include / must-exclude pills matched
// NOTHING on the Library and Wishlist tabs unless the pill was a tag.
//
// `/api/library` and `/api/calendar` ship `sources[].data` as `{}` (the
// 2026-07-30 payload fix, 30.7 MB of raw provider blobs off the wire), and the
// client predicate rebuilt MediaLink[] out of exactly that field before
// re-running `extractFacets`. People come from `tmdb.credits`, companies from
// `production_companies` / `networks`, franchises from `belongs_to_collection`
// — all inside the blobs. So the derivation returned tags and nothing else.
// Measured on the real account: "Rebecca Ferguson · Cast · 6" took
// /wishlist?tab=library from 1,943 titles to 0, while the same pill on the
// Progress tab beside it correctly returned Silo.
//
// It survived a month with 1,049 tests green for two reasons worth remembering.
// A pill that matches nothing renders identically to a genuine zero result, so
// there is nothing to see. And `facetFilter.test.ts` only ever exercised TAGS —
// the one kind that still worked — so the suite was testing the half of the
// feature that wasn't broken.
//
// ── Why this drives the real route handlers ─────────────────────────────────
// The defect was not in any value. It was a derivation performed on the far
// side of a payload that no longer carried its inputs, so every unit on either
// side of that boundary was correct in isolation and the feature was still
// dead. The only test that can see that is one that takes the response the
// route actually returns and runs the predicate the component actually calls.
// A grep would pass on a `facetIds` assigned to a local variable that never
// reaches the response — which is exactly how `addedAt` went missing on
// /api/calendar for a month (listRouteSortFields.test.ts).
//
// Both routes, because /library and /wishlist are ONE component over TWO
// routes: the half that is missing fails silently, as an inert control.

const USER = "u-facetids";

vi.mock("@/lib/session", () => ({
  requireSession: async () => ({ userId: USER, identityId: "i1", provider: "trakt", displayName: null }),
}));

import { initDb, run } from "@/lib/db";
import { matchesFacetIds } from "@/lib/facetFilter";
import type { FacetPill } from "@/components/discovery/types";
import type { EnrichedItem } from "@/types";
import { GET as libraryGET } from "@/app/api/library/route";
import { GET as calendarGET } from "@/app/api/calendar/route";

initDb();

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const SILO = uuid(1);
const DUNE = uuid(2);

// Two fixtures rather than one, because TMDB's own coverage is split:
// `created_by` and `networks` exist only for a show, and TMDB has no collection
// concept for a show at all, so an `ip` facet can only come off a movie (see
// the coverage note in facets.ts). A single all-in-one blob would be asserting
// against a payload TMDB never sends.
const SHOW_BLOB = {
  title: "Silo",
  genres: [{ name: "Sci-Fi" }],
  created_by: [{ name: "Graham Yost" }],
  credits: {
    crew: [{ job: "Writer", name: "Hugh Howey" }],
    cast: [{ name: "Rebecca Ferguson" }, { name: "Common" }],
  },
  production_companies: [{ name: "AMC Studios" }],
  networks: [{ name: "Apple TV+" }],
};

const MOVIE_BLOB = {
  title: "Dune: Part Two",
  genres: [{ name: "Science Fiction" }],
  credits: {
    crew: [{ job: "Director", name: "Denis Villeneuve" }, { job: "Screenplay", name: "Jon Spaihts" }],
    cast: [{ name: "Rebecca Ferguson" }],
  },
  production_companies: [{ name: "Legendary Pictures" }],
  belongs_to_collection: { name: "Dune Collection" },
};

function seed(id: string, type: "show" | "movie", title: string, blob: unknown, relation: "library" | "wishlist") {
  run(`INSERT OR IGNORE INTO users (id) VALUES (?)`, [USER]);
  run(
    `INSERT OR IGNORE INTO media_items (id, type, title, norm_title, release_date) VALUES (?, ?, ?, ?, ?)`,
    [id, type, title, title.toLowerCase(), "2023-05-05"],
  );
  run(
    `INSERT OR IGNORE INTO media_links (id, media_item_id, source, source_id, media_type, title, release_date, raw_data, last_synced)
     VALUES (?, ?, 'tmdb', ?, ?, ?, ?, ?, 1)`,
    [`ml-${id}`, id, id.slice(0, 8), type, title, "2023-05-05", JSON.stringify(blob)],
  );
  run(
    `INSERT OR IGNORE INTO user_item_state (id, user_id, media_item_id, source, relation, status, added_at)
     VALUES (?, ?, ?, 'trakt', ?, ?, 1700000000)`,
    [`${relation}-${id}`, USER, id, relation, relation === "library" ? "watched" : null],
  );
}

seed(SILO, "show", "Silo", SHOW_BLOB, "library");
seed(DUNE, "movie", "Dune: Part Two", MOVIE_BLOB, "wishlist");

const pill = (kind: string, role: string | undefined, key: string): FacetPill =>
  ({ kind, role, key, label: key } as FacetPill);

async function items(handler: (r: NextRequest) => Promise<Response> | Response, url: string) {
  const res = await handler(new NextRequest(url));
  expect(res.status).toBe(200);
  return (await res.json()).items as EnrichedItem[];
}

describe("/api/library carries the facet ids its own payload destroys", () => {
  it("the shipped item still has empty source blobs — the reason the field exists", async () => {
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    expect(silo.sources.length).toBeGreaterThan(0);
    // If this ever stops being true the payload fix has been undone, and THAT
    // is the regression — not this test.
    expect(silo.sources.every((s) => Object.keys(s.data).length === 0)).toBe(true);
  });

  // What the user actually did. Every non-tag row here matched zero items
  // before the fix, on a tab showing 1,943 of them.
  it.each([
    ["a cast pill",     pill("person", "cast", "rebecca ferguson")],
    ["a creator pill",  pill("person", "creator", "graham yost")],
    ["a writer pill",   pill("person", "writer", "hugh howey")],
    ["a studio pill",   pill("company", "studio", "amc")],
    ["a network pill",  pill("company", "network", "apple tv")],
    ["a tag pill",      pill("tag", undefined, "sci fi")],
  ])("%s matches the item on the Library tab", async (_label, p) => {
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    // The exact call MyStuffView's filter makes.
    expect(matchesFacetIds(silo.facetIds ?? [], [p], [])).toBe(true);
    expect(matchesFacetIds(silo.facetIds ?? [], [], [p])).toBe(false);
  });

  it("a pill for someone who isn't on the item still doesn't match", async () => {
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    expect(matchesFacetIds(silo.facetIds ?? [], [pill("person", "cast", "tilda swinton")], [])).toBe(false);
  });

  it("include is AND, not OR", async () => {
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    const both = [pill("person", "cast", "rebecca ferguson"), pill("person", "cast", "tilda swinton")];
    expect(matchesFacetIds(silo.facetIds ?? [], both, [])).toBe(false);
  });
});

describe("/api/calendar carries them too — the same component reads both", () => {
  it.each([
    ["a cast pill",      pill("person", "cast", "rebecca ferguson")],
    ["a director pill",  pill("person", "director", "denis villeneuve")],
    ["a studio pill",    pill("company", "studio", "legendary")],
    ["a franchise pill", pill("ip", "ip", "dune")],
  ])("%s matches the item on the Wishlist tab", async (_label, p) => {
    const [dune] = await items(calendarGET, "http://localhost/api/calendar");
    expect(matchesFacetIds(dune.facetIds ?? [], [p], [])).toBe(true);
    expect(matchesFacetIds(dune.facetIds ?? [], [], [p])).toBe(false);
  });

  it("one cast pill matches across both routes — the point of a facet filter", async () => {
    const p = pill("person", "cast", "rebecca ferguson");
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    const [dune] = await items(calendarGET, "http://localhost/api/calendar");
    expect(matchesFacetIds(silo.facetIds ?? [], [p], [])).toBe(true);
    expect(matchesFacetIds(dune.facetIds ?? [], [p], [])).toBe(true);
  });

  it("covers all four facet kinds between them, not just the one that worked", async () => {
    const [silo] = await items(libraryGET, "http://localhost/api/library");
    const [dune] = await items(calendarGET, "http://localhost/api/calendar");
    const kinds = new Set([...(silo.facetIds ?? []), ...(dune.facetIds ?? [])].map((id) => id.split("|")[0]));
    expect(kinds).toEqual(new Set(["tag", "person", "company", "ip"]));
  });
});
