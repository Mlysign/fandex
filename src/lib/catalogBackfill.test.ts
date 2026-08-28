import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDb, run, query, get } from "./db";
// `import type`, not `typeof import(...)` inline: the repo forbids import() type
// annotations (@typescript-eslint/consistent-type-imports, an ERROR here).
import type * as DiscoverFeed from "./discoverFeed";

// 2026-08-28, docs/catalog-growth.md phase 4 — the seeded backfill.
//
// What this pins is the SAFETY, because the correctness half (does a page turn
// into catalog rows) is `persistDiscoverItems`, which is already covered. The
// dangerous properties are the ones that only show up at scale or after a
// deploy:
//
//   - it does nothing unless deliberately switched on
//   - it stops at a real ceiling rather than growing forever
//   - its position survives a restart, or every deploy re-fetches from page 1
//     and burns quota to learn nothing
//   - a provider failure does not advance a cursor past a page never read
//   - an EMPTY page ends a lane; a SHORT one does not
//   - lanes take turns, so one does not race ahead of the rest
//
// PR16 is the reason this file is longer than the module deserves: 546,754 rows
// in one go was 12.8 GB of WAL to S3 and took the site down. A job that grows
// the database is the one to over-test.

const fetchLanes = vi.hoisted(() => ({ movie: vi.fn(), show: vi.fn(), game: vi.fn() }));

vi.mock("./discoverFeed", async (orig) => ({
  ...(await orig<typeof DiscoverFeed>()),
  fetchMoviePage: fetchLanes.movie,
  fetchShowPage: fetchLanes.show,
  fetchGamePageAllSources: fetchLanes.game,
}));

const { backfillBatch, laneStates, resetBackfill, backfillMaxItems } = await import("./catalogBackfill");

initDb();

let counter = 0;
/** A page of candidates the persist path will actually write. */
const page = (n: number) =>
  Array.from({ length: n }, () => {
    const id = ++counter;
    return {
      id: `tmdb-movie-${9_000_000 + id}`, rawId: 9_000_000 + id, source: "tmdb", type: "movie",
      title: `Backfilled ${id}`, releaseDate: "2026-06-01", posterUrl: null, ids: { tmdb: 9_000_000 + id },
      raw: { source: "tmdb", sourceId: String(9_000_000 + id), data: { id: 9_000_000 + id, title: `Backfilled ${id}`, release_date: "2026-06-01" } },
      genreNames: [], originalLanguage: null, voteCount: 0, voteAverage: null, popularity: null,
    };
  });

const ORIGINAL = { ...process.env };
const items = () => get<{ n: number }>(`SELECT COUNT(*) n FROM media_items`)?.n ?? 0;
const cursor = (lane: string) => query<{ page: number; exhausted: number; strikes: number }>(
  `SELECT page, exhausted, strikes FROM backfill_cursor WHERE lane = ?`, [lane])[0];

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM backfill_cursor");
  process.env.BACKFILL_ENABLED = "1";
  for (const f of Object.values(fetchLanes)) { f.mockReset(); f.mockResolvedValue([]); }
});

afterEach(() => { process.env = { ...ORIGINAL }; });

describe("seeded backfill", () => {
  it("does nothing at all unless switched on", async () => {
    delete process.env.BACKFILL_ENABLED;
    fetchLanes.movie.mockResolvedValue(page(20));
    const res = await backfillBatch();
    expect(res).toMatchObject({ ran: false, reason: "disabled", pages: 0, added: 0 });
    expect(fetchLanes.movie).not.toHaveBeenCalled();
    expect(items()).toBe(0);
  });

  it("turns a page of candidates into catalog rows", async () => {
    fetchLanes.movie.mockResolvedValue(page(5));
    const res = await backfillBatch(1);
    expect(res.ran).toBe(true);
    expect(res.pages).toBe(1);
    expect(res.seen).toBe(5);
    expect(res.added).toBe(5);
    expect(items()).toBe(5);
  });

  it("stops at the ceiling rather than growing forever", async () => {
    // The ceiling is a sizing decision (24.2 KB an item, a 2 GB tripwire), not a
    // formality, so it must hold without anyone watching.
    process.env.BACKFILL_MAX_ITEMS = "3";
    fetchLanes.movie.mockResolvedValue(page(10));
    await backfillBatch(1);
    expect(items()).toBe(10);
    // Over the ceiling now: the next pass must not fetch at all.
    fetchLanes.movie.mockClear();
    const res = await backfillBatch(1);
    expect(res).toMatchObject({ ran: false, reason: "at-cap" });
    expect(fetchLanes.movie).not.toHaveBeenCalled();
  });

  it("has a ceiling that is actually set", () => {
    expect(backfillMaxItems()).toBe(50_000);
  });

  it("remembers its page across passes, so a restart does not start over", async () => {
    // The property that matters after a deploy: re-reading page 1 forever costs
    // quota and finds nothing new.
    fetchLanes.movie.mockResolvedValue(page(3));
    await backfillBatch(1);
    expect(cursor("movie:future").page).toBe(2);
    await backfillBatch(1);
    // A different lane took the second turn, so movie stays where it was.
    expect(cursor("movie:future").page).toBe(2);
  });

  it("gives every lane a turn instead of letting one race ahead", async () => {
    for (const f of Object.values(fetchLanes)) f.mockResolvedValue(page(2));
    const res = await backfillBatch(3);
    expect(res.pages).toBe(3);
    expect(new Set(res.lanes).size).toBe(3);
  });

  it("never ends a lane on a SHORT page", async () => {
    // A window that genuinely holds few releases must not stop the backfill.
    fetchLanes.movie.mockResolvedValue(page(1));
    await backfillBatch(1);
    expect(cursor("movie:future")).toMatchObject({ exhausted: 0, strikes: 0, page: 2 });
  });

  it("needs THREE consecutive empty pages to end a lane, not one", async () => {
    // ⚠️ Measured, not imagined. The first live run marked `game:past`
    // exhausted on page 1 with nothing seen, because RAWG was quota-latched and
    // `fetchGamePageAllSources` SWALLOWS a provider failure and answers `[]`.
    // So an empty page cannot tell "this window is finished" from "this provider
    // is down" — the same `undefined` vs `[]` confusion the prune invariant
    // exists to prevent, here costing a lane that silently never runs again.
    for (const f of Object.values(fetchLanes)) f.mockResolvedValue([]);
    await backfillBatch(6);   // one empty page each
    for (const s of laneStates()) { expect(s.strikes, s.lane).toBe(1); expect(s.exhausted, s.lane).toBe(0); }
    await backfillBatch(6);
    for (const s of laneStates()) expect(s.exhausted, s.lane).toBe(0);
    await backfillBatch(6);   // third strike
    for (const s of laneStates()) expect(s.exhausted, s.lane).toBe(1);
    // An empty page never advances the cursor: there was nothing on it.
    expect(cursor("movie:future").page).toBe(1);
  });

  it("forgives a transient outage: one good page resets the strikes", async () => {
    // The whole point of counting rather than ending. A provider that blips must
    // not permanently stop a lane.
    for (const f of Object.values(fetchLanes)) f.mockResolvedValue([]);
    await backfillBatch(6);
    await backfillBatch(6);
    expect(cursor("movie:future").strikes).toBe(2);

    fetchLanes.movie.mockResolvedValue(page(3));
    await backfillBatch(6);
    expect(cursor("movie:future")).toMatchObject({ strikes: 0, exhausted: 0 });
  });

  it("stops picking lanes once they are all exhausted", async () => {
    for (const f of Object.values(fetchLanes)) f.mockResolvedValue([]);
    for (let i = 0; i < 3; i++) await backfillBatch(6);   // three strikes each
    const calls = fetchLanes.movie.mock.calls.length + fetchLanes.show.mock.calls.length + fetchLanes.game.mock.calls.length;
    const res = await backfillBatch(6);
    expect(res.pages).toBe(0);
    expect(fetchLanes.movie.mock.calls.length + fetchLanes.show.mock.calls.length + fetchLanes.game.mock.calls.length).toBe(calls);
  });

  it("does not advance a cursor past a page it never read", async () => {
    // A provider outage must cost a retry, not a hole in the catalog.
    fetchLanes.movie.mockRejectedValue(new Error("IGDB down"));
    fetchLanes.show.mockResolvedValue([]);
    fetchLanes.game.mockResolvedValue([]);
    await backfillBatch(1);
    expect(cursor("movie:future").page).toBe(1);
    expect(cursor("movie:future").exhausted).toBe(0);
  });

  it("survives a failing lane without abandoning the pass", async () => {
    fetchLanes.movie.mockRejectedValue(new Error("provider down"));
    fetchLanes.show.mockResolvedValue(page(4));
    fetchLanes.game.mockResolvedValue(page(4));
    const res = await backfillBatch(3);
    expect(res.added).toBeGreaterThan(0);
  });

  it("skips a candidate with no raw payload, which would be a dangling id", async () => {
    const good = page(2);
    const bad = page(2).map((c) => ({ ...c, raw: null }));
    fetchLanes.movie.mockResolvedValue([...good, ...bad]);
    const res = await backfillBatch(1);
    expect(res.seen).toBe(4);
    expect(items()).toBe(2);
  });

  it("counts only rows it actually created, not candidates it re-saw", async () => {
    // Re-reading a page whose titles we already hold is the normal case once a
    // window has been walked; reporting those as "added" would make the log lie
    // about progress.
    const p = page(3);
    fetchLanes.movie.mockResolvedValue(p);
    expect((await backfillBatch(1)).added).toBe(3);
    fetchLanes.movie.mockResolvedValue(p);
    for (const f of [fetchLanes.show, fetchLanes.game]) f.mockResolvedValue([]);
    let again = 0;
    for (let i = 0; i < 6; i++) again += (await backfillBatch(1)).added;
    expect(again).toBe(0);
    expect(items()).toBe(3);
  });

  it("resets every lane when asked, because the windows slide", async () => {
    for (const f of Object.values(fetchLanes)) f.mockResolvedValue([]);
    for (let i = 0; i < 3; i++) await backfillBatch(6);
    expect(resetBackfill()).toBeGreaterThan(0);
    for (const s of laneStates()) {
      expect(s.page).toBe(1); expect(s.exhausted).toBe(0); expect(s.strikes).toBe(0);
    }
  });

  it("reports six lanes, both directions, before anything has run", () => {
    const lanes = laneStates().map((s) => s.lane).sort();
    expect(lanes).toEqual([
      "game:future", "game:past", "movie:future", "movie:past", "show:future", "show:past",
    ]);
  });
});
