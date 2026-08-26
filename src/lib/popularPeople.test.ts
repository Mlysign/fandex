import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { invalidateDiscoveryCache } from "./discovery";
import { popularPeople, roleLabel, MIN_TITLES, POPULAR_PEOPLE_POOL } from "./popularPeople";

// Home's "Popular people" rail. The properties worth pinning are the ones that
// are invisible when they break: a rail that quietly links noindexed pages, a
// ranking that quietly ignores role weight, and a portrait lookup that quietly
// costs a provider call.

initDb();

const USER = "u-people";

/**
 * Insert a catalog title with a TMDB payload carrying real credits.
 *
 * `browsed = 0` puts it in the POOL, which is what popularPeople reads. The
 * credits shape is TMDB's own (`credits.cast[]` / `credits.crew[]` with
 * `profile_path`), because that is where the portraits genuinely come from.
 */
function addTitle(
  id: string,
  releaseDate: string,
  credits: { cast?: object[]; crew?: object[] },
) {
  run(
    `INSERT INTO media_items (id, type, title, norm_title, release_date, browsed)
     VALUES (?, 'movie', ?, ?, ?, 0)`,
    [id, id, id, releaseDate],
  );
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
     VALUES (?, ?, 'tmdb', ?, ?, ?)`,
    [`${id}-link`, id, id, id, JSON.stringify({ title: id, credits })],
  );
}

const actor = (name: string, id: number, order = 0, profile: string | null = "/p.jpg") =>
  ({ id, name, order, character: "Someone", profile_path: profile });
const director = (name: string, id: number, profile: string | null = "/d.jpg") =>
  ({ id, name, job: "Director", department: "Directing", profile_path: profile });

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

describe("popularPeople", () => {
  it("excludes anyone below the index threshold", () => {
    // ⚠️ The load-bearing one. `/person/{slug}` is `noindex, follow` under three
    // pool titles, so linking a two-title person from the homepage spends the
    // strongest internal link we have on a page we have asked Google to drop.
    // Nothing about the rendered rail would look wrong if this regressed.
    for (let i = 0; i < 2; i++) addTitle(`thin-${i}`, "2025-01-01", { cast: [actor("One Off", 1)] });
    for (let i = 0; i < MIN_TITLES; i++) {
      addTitle(`solid-${i}`, "2025-01-01", { cast: [actor("Real Name", 2)] });
    }

    const names = popularPeople(new Date("2026-01-01T00:00:00Z")).map((p) => p.name);
    expect(names).toContain("Real Name");
    expect(names).not.toContain("One Off");
  });

  it("ranks by role weight, not by raw title count", () => {
    // A director carries 1.3 and a lead 0.6, so three directing credits must
    // outrank three top-billed roles. This is the same shape as the Fandex
    // Score's 2026-08-22 bug, where a selection sorted by a raw deviation while
    // the thing it fed was made of a weighted one.
    for (let i = 0; i < 4; i++) {
      addTitle(`d-${i}`, "2025-01-01", { crew: [director("Helmer Person", 10)] });
      addTitle(`a-${i}`, "2025-01-01", { cast: [actor("Lead Person", 11)] });
    }

    const ranked = popularPeople(new Date("2026-01-01T00:00:00Z"));
    const helmer = ranked.findIndex((p) => p.name === "Helmer Person");
    const lead = ranked.findIndex((p) => p.name === "Lead Person");
    expect(helmer).toBeGreaterThanOrEqual(0);
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(helmer).toBeLessThan(lead);
  });

  it("weights a lead above a background credit on the same title count", () => {
    // `prominence` is billing order, and it is the difference between a rail of
    // faces people recognise and a rail of working actors.
    //
    // Note the fillers are load-bearing: `castProminence` reads the ARRAY INDEX,
    // not TMDB's `order` field (the array already arrives in billing order), and
    // the top three positions all count fully. A two-entry cast would score both
    // of these identically and the test would pass for the wrong reason.
    const fillers = [1, 2, 3].map((n) => actor(`Filler ${n}`, 900 + n, n));
    for (let i = 0; i < 4; i++) {
      addTitle(`x-${i}`, "2025-01-01", {
        cast: [actor("Top Billed", 20, 0), ...fillers, actor("Background Player", 21, 11)],
      });
    }

    const ranked = popularPeople(new Date("2026-01-01T00:00:00Z"));
    const top = ranked.find((p) => p.name === "Top Billed");
    const low = ranked.find((p) => p.name === "Background Player");
    expect(top!.score).toBeGreaterThan(low!.score);
  });

  it("takes the portrait from stored provider data, with no fetch", () => {
    // The whole rail is affordable on `/` only because the portrait is already
    // in a media_links blob. If this ever needs a provider call it costs two
    // TMDB requests per face on the most-hit page in the app.
    for (let i = 0; i < MIN_TITLES; i++) {
      addTitle(`p-${i}`, "2025-01-01", { crew: [director("Framed Person", 30, "/abc.jpg")] });
    }
    const p = popularPeople(new Date("2026-01-01T00:00:00Z"))
      .find((x) => x.name === "Framed Person");
    expect(p?.portraitUrl).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
  });

  it("keeps a person with no stored portrait, rather than dropping them", () => {
    // The card renders initials. Dropping them instead would silently bias the
    // rail toward whichever titles happen to have complete credits.
    for (let i = 0; i < MIN_TITLES; i++) {
      addTitle(`n-${i}`, "2025-01-01", { crew: [director("No Photo", 40, null)] });
    }
    const p = popularPeople(new Date("2026-01-01T00:00:00Z"))
      .find((x) => x.name === "No Photo");
    expect(p).toBeDefined();
    expect(p?.portraitUrl).toBeNull();
  });

  it("gives a person a linkable /person/ href", () => {
    for (let i = 0; i < MIN_TITLES; i++) {
      addTitle(`h-${i}`, "2025-01-01", { crew: [director("Guillermo del Toro", 50)] });
    }
    const p = popularPeople(new Date("2026-01-01T00:00:00Z"))
      .find((x) => x.name === "Guillermo del Toro");
    expect(p?.href).toBe("/person/guillermo-del-toro");
  });

  it("never returns more than the pool depth", () => {
    for (let person = 0; person < POPULAR_PEOPLE_POOL + 5; person++) {
      for (let i = 0; i < MIN_TITLES; i++) {
        addTitle(`m-${person}-${i}`, "2025-01-01", { crew: [director(`Person ${person}`, 100 + person)] });
      }
    }
    expect(popularPeople(new Date("2026-01-01T00:00:00Z")).length).toBe(POPULAR_PEOPLE_POOL);
  });

  it("returns an empty list on an empty catalog instead of throwing", () => {
    expect(popularPeople(new Date("2026-01-01T00:00:00Z"))).toEqual([]);
  });
});

describe("roleLabel", () => {
  it("names the four roles a card can show", () => {
    expect(roleLabel("director")).toBe("Director");
    expect(roleLabel("cast")).toBe("Actor");
    expect(roleLabel("writer")).toBe("Writer");
    expect(roleLabel("creator")).toBe("Creator");
  });

  it("falls back to the role id rather than a flat label", () => {
    // Same reasoning as the tag categories: a role named after itself still
    // tells you which one it is, where a generic "Person" does not.
    expect(roleLabel("composer")).toBe("Composer");
  });
});
