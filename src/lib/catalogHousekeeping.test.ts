import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, run, get } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { PROJECTION_VERSION } from "./sources/project";
import { housekeepingPass, housekeepingStatus, housekeepingStartMb } from "./catalogHousekeeping";

// 2026-08-28, docs/catalog-growth.md phase 5 — reclaim BYTES, never rows.
//
// 70% of the database file is `media_links.raw_data`. Dropping a blob reclaims
// almost all of an item's disk while the row, its uuid, its stored slug and
// every user relation survive. Deleting rows instead is what makes public pages
// 404, which the archive already records as an accepted loss from last time.
//
// ⚠️ Everything here is about what must NOT be dropped. The reclaim itself is
// one UPDATE; the never-evict list is the part that, if wrong, loses somebody's
// data or breaks a page a crawler has indexed. Each clause gets its own test,
// for the same reason dbPrune's predicate names every table one by one rather
// than reasoning that one implies another.

initDb();

const USER = "u-housekeeping";
const ORIGINAL = { ...process.env };

const payload = (n: number) => ({
  id: 8_000_000 + n, title: `Bulky ${n}`, release_date: "2020-01-01",
  overview: "x".repeat(60_000), // big enough that one blob is a visible 0.1 MB
  credits: { crew: [{ job: "Director", name: "Greta Gerwig" }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
});

/** A projected item with a real blob — the shape housekeeping may reclaim. */
function seeded(n: number, opts: { projected?: boolean; projection?: boolean } = {}) {
  const { projected = true, projection = true } = opts;
  const id = upsertMediaItem({
    source: "tmdb", sourceId: `hk${n}`, type: "movie", title: `Bulky ${n}`,
    releaseDate: "2020-01-01", rawData: payload(n),
  });
  run(`UPDATE media_links SET projection_version = ?, last_synced = ? WHERE media_item_id = ?`,
    [projected ? PROJECTION_VERSION : 0, 1000 + n, id]);
  if (projection) {
    run(`INSERT OR REPLACE INTO media_item_projection
           (media_item_id, region, last_synced, raw_len, facets, merged, written_at)
         VALUES (?, 'US', 0, 0, '[]', '{}', 0)`, [id]);
  }
  return id;
}

const blobOf = (id: string) =>
  get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ?`, [id])?.raw_data ?? "";
const hasBlob = (id: string) => blobOf(id).length > 0;

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("DELETE FROM home_snapshot_item");
  run("DELETE FROM calendar_snapshot_item");
  run("DELETE FROM item_ip_override");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  // Every test below is about WHAT gets picked, so the size gate is opened.
  process.env.HOUSEKEEPING_START_MB = "0";
});

afterEach(() => { process.env = { ...ORIGINAL }; });

describe("housekeeping by bytes", () => {
  it("does nothing at all below the size threshold", () => {
    // Dropping a blob from a small database costs a refetch later and saves
    // space nobody needed. It is a SIZE trigger, not an age one.
    delete process.env.HOUSEKEEPING_START_MB;
    const id = seeded(1);
    const res = housekeepingPass();
    expect(res).toMatchObject({ ran: false, reason: "under-threshold", dropped: 0 });
    expect(hasBlob(id)).toBe(true);
  });

  it("has a threshold well under the 2 GB tripwire", () => {
    delete process.env.HOUSEKEEPING_START_MB; // beforeEach opens the gate for the others
    expect(housekeepingStartMb()).toBe(1200);
  });

  it("drops the blob and keeps everything else about the row", () => {
    const id = seeded(2);
    expect(housekeepingPass().dropped).toBe(1);
    expect(hasBlob(id)).toBe(false);

    // The whole point: the item is still a real, linkable, titled row.
    const item = get<{ id: string; title: string; slug: string | null }>(
      `SELECT id, title, slug FROM media_items WHERE id = ?`, [id]);
    expect(item?.title).toBe("Bulky 2");
    expect(item?.slug).toBeTruthy();
    expect(get<{ n: number }>(`SELECT COUNT(*) n FROM media_links WHERE media_item_id = ?`, [id])?.n).toBe(1);
  });

  it("never touches an item a user has acted on", () => {
    const mine = seeded(10);
    const other = seeded(11);
    upsertLibraryEntry(USER, mine, "tmdb", { rating: 9, status: "completed" });
    housekeepingPass();
    expect(hasBlob(mine)).toBe(true);
    expect(hasBlob(other)).toBe(false);
  });

  it("never touches an item with tracked episodes", () => {
    // user_episode_state is its own clause because a show can be ticked without
    // ever being rated or wishlisted — the exact case that made it join
    // dbPrune's predicate the moment it existed.
    const tracked = seeded(20);
    run(`INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, sources, updated_at)
         VALUES (?, ?, 1, 1, '[]', 0)`, [USER, tracked]);
    housekeepingPass();
    expect(hasBlob(tracked)).toBe(true);
  });

  it("never touches an item a public snapshot links to", () => {
    // These are the highest-authority pages on the domain. A crawler follows
    // them, so a title losing its payload here is a page losing its content.
    const home = seeded(30);
    const cal = seeded(31);
    run(`INSERT INTO home_snapshot_item (media_item_id) VALUES (?)`, [home]);
    run(`INSERT INTO calendar_snapshot_item (media_item_id) VALUES (?)`, [cal]);
    housekeepingPass();
    expect(hasBlob(home)).toBe(true);
    expect(hasBlob(cal)).toBe(true);
  });

  it("never touches an item a franchise override names", () => {
    const pinned = seeded(40);
    run(`INSERT INTO item_ip_override (media_item_id, ip_key, label, mode, updated_at, source)
         VALUES (?, 'some-franchise', 'Some Franchise', 'add', 0, 'manual')`, [pinned]);
    housekeepingPass();
    expect(hasBlob(pinned)).toBe(true);
  });

  it("never touches a row still waiting to be healed", () => {
    // A thin row is about to be re-derived FROM this payload. Dropping it would
    // turn a cheap heal into a refetch, which is the opposite of the point.
    const thin = seeded(50, { projected: false });
    housekeepingPass();
    expect(hasBlob(thin)).toBe(true);
  });

  it("never touches a row whose projection was never stored", () => {
    // The blob is only redundant BECAUSE the derived form exists. Without it,
    // dropping the payload loses the data outright until a refetch.
    const underived = seeded(60, { projection: false });
    housekeepingPass();
    expect(hasBlob(underived)).toBe(true);
  });

  it("takes the oldest-synced first, so it does not fight the other jobs", () => {
    // Retention and the fill job both walk oldest-first; the newest blob is also
    // the one somebody is most likely looking at.
    const old = seeded(70);
    const recent = seeded(71);
    run(`UPDATE media_links SET last_synced = 1 WHERE media_item_id = ?`, [old]);
    run(`UPDATE media_links SET last_synced = 999999 WHERE media_item_id = ?`, [recent]);
    housekeepingPass(1);
    expect(hasBlob(old)).toBe(false);
    expect(hasBlob(recent)).toBe(true);
  });

  it("respects its batch, so a backlog drains over ticks", () => {
    // PR16: 546,754 rows in one transaction was 12.8 GB of WAL and the site went
    // down. An UPDATE nulling a 7 KB blob is itself WAL, so this is a write job.
    for (let i = 80; i < 85; i++) seeded(i);
    expect(housekeepingPass(2).dropped).toBe(2);
    expect(housekeepingPass(2).dropped).toBe(2);
    expect(housekeepingPass(2).dropped).toBe(1);
    expect(housekeepingPass(2).dropped).toBe(0);
  });

  it("reports what it could reclaim and what the rules are protecting", () => {
    const free = seeded(90);
    const held = seeded(91);
    upsertLibraryEntry(USER, held, "tmdb", { rating: 8, status: "completed" });
    const s = housekeepingStatus();
    expect(s.evictable).toBe(1);
    expect(s.protectedBlobs).toBe(1);
    expect(s.evictableMb).toBeGreaterThan(0);
    expect(s.fileMb).toBeGreaterThan(0);
    expect(hasBlob(free)).toBe(true); // status reports, it does not act
  });
});
