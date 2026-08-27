import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { availabilityForItems } from "./availability";
import { annotateAvailability } from "./annotateDiscover";

// catalog-growth phase 1: read the streaming availability we already hold,
// rather than paying a provider call per title for it. The rules worth pinning
// are the ones that fail SILENTLY: a region picked differently from mergeLinks
// makes the filter and the item page disagree, and a bucket read in the wrong
// order says a film is "on Netflix" when it is only rentable.

initDb();

const ITEM = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function link(mediaItemId: string, results: unknown, sourceId = mediaItemId) {
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data, last_synced)
     VALUES (?, ?, 'tmdb', ?, 'movie', 'T', ?, 0)`,
    [`l-${sourceId}`, mediaItemId, sourceId, JSON.stringify({ "watch/providers": { results } })]
  );
}

const p = (id: number, name: string) => ({ provider_id: id, provider_name: name });

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  // media_links.media_item_id is a real FK, so the rows have to exist first.
  for (const id of [ITEM, OTHER]) {
    run("INSERT INTO media_items (id, type, title, created_at, updated_at) VALUES (?, 'movie', 'T', 0, 0)", [id]);
  }
});

describe("availabilityForItems", () => {
  it("reads the raw TMDB shape, subscription bucket first", () => {
    // A title that is both streamable and rentable is "on Netflix", not "on
    // Apple TV Store" — flatrate wins, which is TMDB's own precedence and the
    // one the merged item page applies.
    link(ITEM, { DE: { flatrate: [p(8, "Netflix")], rent: [p(2, "Apple TV Store")] } });
    expect(availabilityForItems([ITEM], "DE").get(ITEM)).toEqual([{ name: "Netflix", providerId: 8 }]);
  });

  it("reads the projected shape, honouring its stored offerType", () => {
    // Projection v3+ writes the winning bucket's name alongside it. Trust that
    // rather than re-deriving, so a projected row and its source agree.
    link(ITEM, { DE: { rent: [p(2, "Apple TV Store")], offerType: "rent", link: "https://x" } });
    expect(availabilityForItems([ITEM], "DE").get(ITEM)).toEqual([{ name: "Apple TV Store", providerId: 2 }]);
  });

  it("falls back country → US → GB → first key, like mergeLinks", () => {
    link(ITEM, { FR: { flatrate: [p(1, "FrOnly")] }, US: { flatrate: [p(8, "Netflix")] }, GB: { flatrate: [p(9, "Prime")] } });
    expect(availabilityForItems([ITEM], "DE").get(ITEM)).toEqual([{ name: "Netflix", providerId: 8 }]);
    expect(availabilityForItems([ITEM], "GB").get(ITEM)).toEqual([{ name: "Prime", providerId: 9 }]);
    expect(availabilityForItems([ITEM], "FR").get(ITEM)).toEqual([{ name: "FrOnly", providerId: 1 }]);
  });

  it("takes the first key when neither the country nor US nor GB is present", () => {
    link(ITEM, { AT: { flatrate: [p(30, "WOW")] }, CH: { flatrate: [p(8, "Netflix")] } });
    expect(availabilityForItems([ITEM], "DE").get(ITEM)).toEqual([{ name: "WOW", providerId: 30 }]);
  });

  it("says nothing rather than nothing-found for a title with no blob", () => {
    // ABSENT, never []. An empty array reads as "we know it is on no service",
    // and the filter hides those deliberately.
    expect(availabilityForItems([ITEM], "DE").has(ITEM)).toBe(false);
  });

  it("dedupes a provider listed twice in one bucket", () => {
    link(ITEM, { DE: { flatrate: [p(8, "Netflix"), p(1796, "Netflix")] } });
    expect(availabilityForItems([ITEM], "DE").get(ITEM)).toHaveLength(1);
  });

  it("handles more ids than one chunk, and unknown ids", () => {
    link(ITEM, { DE: { flatrate: [p(8, "Netflix")] } });
    const many = Array.from({ length: 450 }, (_, i) => `missing-${i}`);
    const got = availabilityForItems([...many, ITEM, OTHER], "DE");
    expect(got.size).toBe(1);
    expect(got.get(ITEM)).toEqual([{ name: "Netflix", providerId: 8 }]);
  });

  it("survives a malformed blob without taking the batch down", () => {
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data, last_synced)
       VALUES ('l-bad', ?, 'tmdb', 'bad', 'movie', 'T', 'not json', 0)`,
      [OTHER]
    );
    link(ITEM, { DE: { flatrate: [p(8, "Netflix")] } });
    const got = availabilityForItems([ITEM, OTHER], "DE");
    expect(got.get(ITEM)).toEqual([{ name: "Netflix", providerId: 8 }]);
    expect(got.has(OTHER)).toBe(false);
  });
});

describe("annotateAvailability", () => {
  it("attaches providers to items we hold and leaves the rest untouched", () => {
    link(ITEM, { DE: { flatrate: [p(8, "Netflix")] } });
    const [a, b] = annotateAvailability(
      [{ id: ITEM, title: "Held" }, { id: OTHER, title: "Not held" }],
      "DE"
    );
    expect((a as any).streamingProviders).toEqual([{ name: "Netflix", providerId: 8 }]);
    expect((b as any).streamingProviders).toBeUndefined();
  });

  it("skips items that were never resolved to a row", () => {
    // `linkable: false` means persistDiscoverBatch found no uuid, so `id` is
    // still a provider id and would match nothing — or worse, something else.
    link(ITEM, { DE: { flatrate: [p(8, "Netflix")] } });
    const [only] = annotateAvailability([{ id: ITEM, linkable: false }], "DE");
    expect((only as any).streamingProviders).toBeUndefined();
  });
});
