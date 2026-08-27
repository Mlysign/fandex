import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDb, run } from "@/lib/db";
import type * as DiscoverPersistModule from "@/lib/discoverPersist";

// Partial mock: `persistDiscoverItems` is spied because it is the WRITE path
// these tests exist to prove is never called, while `lookupExistingUuids` must
// stay REAL — it is the read-only resolution being tested. Mocking the whole
// module would make every assertion below vacuous.
vi.mock("@/lib/discoverPersist", async (importOriginal) => {
  const actual = await importOriginal<typeof DiscoverPersistModule>();
  return { ...actual, persistDiscoverItems: vi.fn().mockReturnValue(new Map()) };
});

/**
 * SM38 (2026-08-12). `persistDiscoverBatch`'s anonymous branch used to return an
 * empty uuid map, so EVERY card on the logged-out surface — Home, Discover, the
 * facet grids — rendered inert: zero clickable items against ~2,000 real catalog
 * rows in production. Anonymous visitors could not open anything from the two
 * main browse pages and crawlers dead-ended.
 *
 * The facet half got a regression test the same day; this is the other half.
 * Both properties have to hold together, which is why they are asserted
 * together: an already-known title must LINK, and the write path must still
 * never fire for an anonymous caller. Fixing either alone re-creates a bug —
 * dropping the second re-opens the 2026-07-22 cost outage.
 */
describe("persistDiscoverBatch — anonymous resolution (SM38)", () => {
  initDb();

  beforeEach(() => {
    vi.clearAllMocks();
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
    run("INSERT INTO media_items (id, type, title) VALUES ('uuid-known', 'movie', 'Known Movie')");
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, raw_data)
       VALUES ('link-known', 'uuid-known', 'tmdb', '555', 'movie', '{}')`
    );
  });

  const known = { id: "tmdb:555", type: "movie", title: "Known Movie", releaseDate: null,
    raw: { source: "tmdb", sourceId: "555", data: {} } };
  const unknown = { id: "tmdb:999", type: "movie", title: "Unknown Movie", releaseDate: null,
    raw: { source: "tmdb", sourceId: "999", data: {} } };

  it("resolves an already-known title to its real uuid for an anonymous caller", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const [item] = persistDiscoverBatch([known] as any, null);

    expect(item.id).toBe("uuid-known");
    expect((item as { linkable?: boolean }).linkable).not.toBe(false);
  });

  it("leaves a genuinely unknown title non-linkable — the gate is per item", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const [item] = persistDiscoverBatch([unknown] as any, null);

    expect(item.id).toBe("tmdb:999"); // keeps its synthetic composite id
    expect((item as { linkable?: boolean }).linkable).toBe(false);
  });

  it("NEVER calls the write path for an anonymous caller (PR13–PR15)", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");

    persistDiscoverBatch([known, unknown] as any, null);

    expect(persistDiscoverItems).not.toHaveBeenCalled();
  });

  it("still writes for a real session", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");

    persistDiscoverBatch([unknown] as any, "user-1");

    expect(persistDiscoverItems).toHaveBeenCalledTimes(1);
  });

  it("strips `raw` from every item, whatever the auth state (H2a leak boundary)", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    for (const userId of [null, "user-1"]) {
      const [item] = persistDiscoverBatch([known] as any, userId);
      expect(item).not.toHaveProperty("raw");
    }
  });
});

/**
 * The outage fallback (catalog-growth phase 2) hands this function items that
 * ARE catalog rows: their `id` is already a media_items uuid and they carry no
 * `raw`, because there is nothing to persist. Both resolvers skip anything
 * without `raw`, so before 2026-08-27 every one of those cards shipped
 * `linkable: false` with no slug — a whole page of titles nobody could click,
 * which is precisely the defect the SM38 block above exists to prevent.
 */
describe("persistDiscoverBatch — items that are already catalog rows", () => {
  initDb();

  const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  beforeEach(() => {
    vi.clearAllMocks();
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
    run("INSERT INTO media_items (id, type, title, slug) VALUES (?, 'game', 'Stored Game', 'stored-game')", [UUID]);
  });

  it("keeps the uuid, finds the slug, and stays linkable with no `raw`", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const [item] = persistDiscoverBatch([{ id: UUID, type: "game", title: "Stored Game", releaseDate: null }] as any, "user-1");
    expect(item.id).toBe(UUID);
    expect((item as any).slug).toBe("stored-game");
    expect((item as any).linkable).not.toBe(false);
  });

  it("works for an anonymous visitor too — that is who an outage page serves", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");
    const [item] = persistDiscoverBatch([{ id: UUID, type: "game", title: "Stored Game", releaseDate: null }] as any, null);
    expect((item as any).slug).toBe("stored-game");
    expect(persistDiscoverItems).not.toHaveBeenCalled();
  });

  it("still marks a genuine first-sighting non-linkable", async () => {
    const { persistDiscoverBatch } = await import("@/lib/annotateDiscover");
    const [item] = persistDiscoverBatch([{ id: "tmdb-movie-999", type: "movie", title: "New", releaseDate: null }] as any, null);
    expect((item as any).linkable).toBe(false);
  });
});
