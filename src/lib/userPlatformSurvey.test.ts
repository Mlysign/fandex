import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { surveyUserPlatforms } from "./userPlatformSurvey";

// The option list behind Settings → Your platforms, read straight out of the
// stored provider JSON. These pin the parts that are invisible when they break:
// what counts as a Steam "platform", and which region's streaming list wins.

initDb();

const USER = "u1";

function item(id: string, type = "game") {
  run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, ?, ?, ?)", [id, type, id, id]);
  run("INSERT INTO user_item_state (user_id, media_item_id, source, relation) VALUES (?, ?, 'steam', 'library')", [USER, id]);
}

function link(id: string, source: string, sourceId: string, type: string, raw: unknown) {
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, raw_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`${id}-${source}`, id, source, sourceId, type, JSON.stringify(raw)]
  );
}

beforeEach(() => {
  run("DELETE FROM user_item_state");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

describe("Steam's `platforms` object is not only platforms", () => {
  it("counts windows/mac/linux and ignores the compat + VR keys beside them", () => {
    // Measured on the live database: that object also carries
    // steam_deck_compat_category, steam_os_compat_category, vr_support,
    // steam_frame_compat_category, steam_machine_compat_category and
    // steamos_linux — 730 rows each for several. A plain truthiness test offers
    // "vr_support" as a platform you can own. normalize.ts allowlists exactly
    // these three; this must agree with it.
    item("g1");
    link("g1", "steam", "1", "game", {
      appid: 1,
      platforms: {
        windows: true,
        mac: true,
        linux: false,
        steamos_linux: true,
        vr_support: true,
        steam_deck_compat_category: 3,
        steam_os_compat_category: 2,
      },
    });

    const got = surveyUserPlatforms(USER, "DE");
    expect(got.map((o) => o.label).sort()).toEqual(["PC", "macOS"]);
    // The ones that must NOT appear, named so a regression is unmistakable.
    const labels = got.map((o) => o.label.toLowerCase());
    for (const banned of ["vr_support", "steamos_linux", "steam_deck_compat_category"]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("skips a platform whose flag is false", () => {
    item("g2");
    link("g2", "steam", "2", "game", { appid: 2, platforms: { windows: true, mac: false, linux: false } });
    expect(surveyUserPlatforms(USER, "DE").map((o) => o.label)).toEqual(["PC"]);
  });
});

describe("the games sources agree on one platform", () => {
  it("folds IGDB's, Steam's and RAWG's PC spellings and counts the item once", () => {
    item("g3");
    link("g3", "igdb", "3", "game", { id: 3, platforms: [{ name: "PC (Microsoft Windows)" }] });
    link("g3", "steam", "3", "game", { appid: 3, platforms: { windows: true } });
    link("g3", "rawg", "3", "game", { id: 3, platforms: [{ platform: { name: "PC" } }] });

    const got = surveyUserPlatforms(USER, "DE");
    expect(got).toEqual([{ key: "p:pc", label: "PC", group: "games", count: 1 }]);
  });

  it("keeps console generations apart", () => {
    item("g4");
    link("g4", "igdb", "4", "game", { id: 4, platforms: [{ name: "PlayStation 4" }, { name: "PlayStation 5" }] });
    const keys = surveyUserPlatforms(USER, "DE").map((o) => o.key).sort();
    expect(keys).toEqual(["p:playstation-4", "p:playstation-5"]);
  });
});

describe("TMDB watch providers: region, and the region FALLBACK", () => {
  const providers = (region: string, names: string[]) => ({
    id: 9,
    "watch/providers": {
      results: { [region]: { offerType: "flatrate", flatrate: names.map((n, i) => ({ provider_id: i, provider_name: n })) } },
    },
  });

  it("reads the asked-for region", () => {
    item("m1", "movie");
    link("m1", "tmdb", "9", "movie", providers("DE", ["Netflix", "WOW"]));
    expect(surveyUserPlatforms(USER, "DE").map((o) => o.label).sort()).toEqual(["Netflix", "WOW"]);
  });

  it("falls back to US when the region is absent, matching mergeLinks' pickRegion", () => {
    // A flat `WHERE key = :region` would return nothing here and the setting
    // would look empty for anyone outside the covered regions.
    item("m2", "movie");
    link("m2", "tmdb", "9", "movie", providers("US", ["Hulu"]));
    expect(surveyUserPlatforms(USER, "FR").map((o) => o.label)).toEqual(["Hulu"]);
  });

  it("prefers the exact region over US when both exist", () => {
    item("m3", "movie");
    link("m3", "tmdb", "9", "movie", {
      id: 9,
      "watch/providers": {
        results: {
          US: { offerType: "flatrate", flatrate: [{ provider_id: 1, provider_name: "Hulu" }] },
          DE: { offerType: "flatrate", flatrate: [{ provider_id: 2, provider_name: "WOW" }] },
        },
      },
    });
    expect(surveyUserPlatforms(USER, "DE").map((o) => o.label)).toEqual(["WOW"]);
  });

  it("yields nothing for a pre-v3 row with no offerType, rather than throwing", () => {
    item("m4", "movie");
    link("m4", "tmdb", "9", "movie", { id: 9, "watch/providers": { results: { DE: { flatrate: [{ provider_name: "Netflix" }] } } } });
    expect(surveyUserPlatforms(USER, "DE")).toEqual([]);
  });
});

describe("shape and ordering", () => {
  it("namespaces streaming apart from games and orders by count", () => {
    item("g5");
    item("g6");
    item("m5", "movie");
    link("g5", "igdb", "5", "game", { id: 5, platforms: [{ name: "Nintendo Switch" }] });
    link("g6", "igdb", "6", "game", { id: 6, platforms: [{ name: "Nintendo Switch" }] });
    link("m5", "tmdb", "9", "movie", {
      id: 9,
      "watch/providers": { results: { DE: { offerType: "flatrate", flatrate: [{ provider_name: "Netflix" }] } } },
    });

    const got = surveyUserPlatforms(USER, "DE");
    expect(got[0]).toMatchObject({ key: "p:nintendo-switch", count: 2, group: "games" });
    expect(got[1]).toMatchObject({ key: "s:netflix", count: 1, group: "streaming" });
  });

  it("is empty for a user with nothing", () => {
    expect(surveyUserPlatforms(USER, "DE")).toEqual([]);
  });

  it("ignores another user's items", () => {
    run("INSERT INTO users (id) VALUES ('u2')");
    item("g7");
    link("g7", "igdb", "7", "game", { id: 7, platforms: [{ name: "Nintendo Switch" }] });
    expect(surveyUserPlatforms("u2", "DE")).toEqual([]);
  });
});
