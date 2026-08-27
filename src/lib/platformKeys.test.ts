import { describe, it, expect } from "vitest";
import {
  platformKey, platformLabel, availableOnKeys, platformOptions, matchesPlatforms, groupOfKey, narrowToOwned,
} from "./platformKeys";

// "Available on" (2026-08-27). The rules worth pinning are the ones that are
// invisible when they break: a namespace collision silently merges two
// different things, and the unknown-availability decision silently changes what
// the filter returns.

describe("platform keys carry their namespace", () => {
  it("keeps a games platform and a streaming service with the same name apart", () => {
    // Apple TV is BOTH a hardware platform and a streaming service. Comparing
    // bare names would make "I own an Apple TV box" and "I subscribe to Apple
    // TV+" the same filter.
    expect(platformKey("Apple TV", "games")).toBe("p:apple-tv");
    expect(platformKey("Apple TV", "streaming")).toBe("s:apple-tv");
    expect(platformKey("Apple TV", "games")).not.toBe(platformKey("Apple TV", "streaming"));
  });

  it("reports the group back from a key", () => {
    expect(groupOfKey("p:nintendo-switch")).toBe("games");
    expect(groupOfKey("s:netflix")).toBe("streaming");
    expect(groupOfKey("netflix")).toBeNull();
  });

  it("slugs punctuation and case away so one service is one key", () => {
    expect(platformKey("PlayStation 5", "games")).toBe("p:playstation-5");
    expect(platformKey("HBO Max", "streaming")).toBe("s:hbo-max");
    expect(platformKey("Disney+", "streaming")).toBe("s:disney");
  });
});

describe("service tiers fold together, console generations do not", () => {
  it("folds ad and kids tiers into the parent service", () => {
    // An ad-tier subscription still shows you the film, so these are one choice.
    expect(platformLabel("Netflix basic with Ads")).toBe("Netflix");
    expect(platformLabel("Netflix Kids")).toBe("Netflix");
    expect(platformLabel("Paramount+ Amazon Channel")).toBe("Paramount+");
    expect(platformKey(platformLabel("Netflix basic with Ads"), "streaming")).toBe(platformKey("Netflix", "streaming"));
  });

  it("does NOT fold console generations, because a PS4 game is not a PS5 game", () => {
    expect(platformLabel("PlayStation 4")).toBe("PlayStation 4");
    expect(platformKey("PlayStation 4", "games")).not.toBe(platformKey("PlayStation 5", "games"));
  });

  it("leaves an ordinary name alone", () => {
    expect(platformLabel("Nintendo Switch")).toBe("Nintendo Switch");
    expect(platformLabel("")).toBe("");
  });
});

describe("availableOnKeys", () => {
  it("reads both dimensions off one item and dedupes tiers", () => {
    expect(availableOnKeys({
      platforms: ["Nintendo Switch", "PC"],
      streamingProviders: [{ name: "Netflix" }, { name: "Netflix Kids" }],
    }).sort()).toEqual(["p:nintendo-switch", "p:pc", "s:netflix"]);
  });

  it("survives absent, null and empty data", () => {
    expect(availableOnKeys({})).toEqual([]);
    expect(availableOnKeys({ platforms: null, streamingProviders: null })).toEqual([]);
    expect(availableOnKeys({ platforms: [""], streamingProviders: [{ name: "" }] })).toEqual([]);
  });
});

describe("platformOptions", () => {
  it("counts each item once per service, even when it lists two tiers of it", () => {
    // The bug this pins: counting raw strings makes the tally read 2 for one
    // item, so the chip promises more results than the filter returns.
    const opts = platformOptions([
      { streamingProviders: [{ name: "Netflix" }, { name: "Netflix basic with Ads" }] },
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ key: "s:netflix", label: "Netflix", count: 1 });
  });

  it("orders by count, then alphabetically, and carries the group", () => {
    const opts = platformOptions([
      { streamingProviders: [{ name: "Netflix" }] },
      { streamingProviders: [{ name: "Netflix" }] },
      { platforms: ["Xbox"] },
      { streamingProviders: [{ name: "Apple TV+" }] },
    ]);
    expect(opts.map((o) => o.key)).toEqual(["s:netflix", "s:apple-tv", "p:xbox"]);
    expect(opts[0].count).toBe(2);
    expect(opts.find((o) => o.key === "p:xbox")!.group).toBe("games");
  });

  it("is empty when nothing loaded carries availability", () => {
    // Which is why the panel must say so rather than render an empty section.
    expect(platformOptions([{ platforms: [] }, {}])).toEqual([]);
  });
});

describe("matchesPlatforms", () => {
  const onNetflix = { streamingProviders: [{ name: "Netflix" }] };
  const onSwitch = { platforms: ["Nintendo Switch"] };
  const unknown = { platforms: [], streamingProviders: [] };

  it("passes everything when nothing is selected", () => {
    expect(matchesPlatforms(unknown, [])).toBe(true);
    expect(matchesPlatforms(onNetflix, [])).toBe(true);
  });

  it("ORs the selection — owning two platforms means either will do", () => {
    const sel = ["s:netflix", "p:nintendo-switch"];
    expect(matchesPlatforms(onNetflix, sel)).toBe(true);
    expect(matchesPlatforms(onSwitch, sel)).toBe(true);
    expect(matchesPlatforms({ streamingProviders: [{ name: "HBO Max" }] }, sel)).toBe(false);
  });

  it("DROPS an item with no availability data, deliberately", () => {
    // The other reading (keep unknowns) is defensible; this one is the choice,
    // and it is why the panel prints a line about partial coverage. If this
    // flips, that copy has to change with it.
    expect(matchesPlatforms(unknown, ["s:netflix"])).toBe(false);
    expect(matchesPlatforms({}, ["s:netflix"])).toBe(false);
  });

  it("matches a tiered listing against the parent service's key", () => {
    expect(matchesPlatforms({ streamingProviders: [{ name: "Netflix basic with Ads" }] }, ["s:netflix"])).toBe(true);
  });
});

// ── Regression: the real library, measured 2026-08-27 ───────────────────────
// The mockup assumed a handful of providers. A real German library offers 57,
// and TMDB spells several of them two ways at once.
describe("the long tail the mockup did not predict", () => {
  it("folds '+' and ' Plus' into one service", () => {
    // Measured on the live library: "Paramount+" 41 chips sat beside
    // "Paramount Plus" 39 — the same subscription, offered twice, with its
    // audience split so neither looked worth picking.
    expect(platformKey("Paramount+", "streaming")).toBe(platformKey("Paramount Plus", "streaming"));
    expect(platformKey("Disney+", "streaming")).toBe(platformKey("Disney Plus", "streaming"));
    expect(platformKey("Apple TV+", "streaming")).toBe(platformKey("Apple TV", "streaming"));
  });

  it("keeps the shorter, branded spelling as the label and sums the counts", () => {
    const opts = platformOptions([
      { streamingProviders: [{ name: "Paramount Plus" }] },
      { streamingProviders: [{ name: "Paramount+" }] },
      { streamingProviders: [{ name: "Paramount Plus" }] },
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ label: "Paramount+", count: 3 });
  });

  it("does NOT fold two genuinely different offerings", () => {
    // "Apple TV Store" is buy/rent, not the subscription — a real distinction,
    // and folding it would claim you can stream something you'd have to buy.
    expect(platformKey("Apple TV Store", "streaming")).not.toBe(platformKey("Apple TV+", "streaming"));
    // Console generations stay apart for the same reason.
    expect(platformKey("Nintendo Switch 2", "games")).not.toBe(platformKey("Nintendo Switch", "games"));
  });
});

describe("one platform described three ways by three providers", () => {
  it("folds IGDB's, Steam's and RAWG's names for a PC into one chip", () => {
    // Measured before the fix: "PC (Microsoft Windows)" 584, "Windows" 584 and
    // "PC" 478 were the top THREE chips in the Games group. One platform, three
    // entries, and not one of the counts was the true total.
    const k = platformKey(platformLabel("PC"), "games");
    expect(platformKey(platformLabel("PC (Microsoft Windows)"), "games")).toBe(k);
    expect(platformKey(platformLabel("Windows"), "games")).toBe(k);
    expect(platformLabel("PC (Microsoft Windows)")).toBe("PC");
  });

  it("folds the Mac spellings and the Xbox Series SKUs", () => {
    expect(platformLabel("Mac")).toBe("macOS");
    expect(platformLabel("macOS")).toBe("macOS");
    expect(platformLabel("Xbox Series S")).toBe("Xbox Series X|S");
    expect(platformLabel("Xbox Series X")).toBe("Xbox Series X|S");
  });

  it("still refuses to fold across console generations", () => {
    expect(platformLabel("Xbox One")).toBe("Xbox One");
    expect(platformKey(platformLabel("Xbox One"), "games")).not.toBe(platformKey(platformLabel("Xbox Series X"), "games"));
  });

  it("sums the three PC names into one count", () => {
    const opts = platformOptions([
      { platforms: ["PC (Microsoft Windows)"] },
      { platforms: ["Windows"] },
      { platforms: ["PC"] },
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ label: "PC", count: 3 });
  });

  it("counts an item once when its own sources disagree about the name", () => {
    // The same game arrives with IGDB's and Steam's spelling on one row.
    const opts = platformOptions([{ platforms: ["PC (Microsoft Windows)", "Windows", "PC"] }]);
    expect(opts).toEqual([{ key: "p:pc", label: "PC", group: "games", count: 1 }]);
  });
});

describe("narrowToOwned — the 'my platforms' setting", () => {
  const opts = platformOptions([
    { streamingProviders: [{ name: "Netflix" }] },
    { streamingProviders: [{ name: "HBO Max" }] },
    { platforms: ["PlayStation 5"] },
    { platforms: ["Nintendo Switch"] },
  ]);

  it("offers only what the account owns", () => {
    const got = narrowToOwned(opts, ["s:netflix", "p:playstation-5"]).map((o) => o.key).sort();
    expect(got).toEqual(["p:playstation-5", "s:netflix"]);
  });

  it("treats an EMPTY owned list as 'not configured' and passes everything", () => {
    // The distinction that matters: empty means the person never opened
    // settings, not that they own nothing. Reading it the other way would empty
    // the filter for every user who never touched it.
    expect(narrowToOwned(opts, [])).toHaveLength(opts.length);
    expect(narrowToOwned(opts, null)).toHaveLength(opts.length);
    expect(narrowToOwned(opts, undefined)).toHaveLength(opts.length);
  });

  it("does NOT invent a chip for something owned but absent from the loaded set", () => {
    // Owning Disney+ while nothing on screen is on Disney+ must not produce a
    // chip that matches nothing.
    expect(narrowToOwned(opts, ["s:disney"])).toEqual([]);
  });

  it("keeps the namespace honest — owning the Apple TV box is not Apple TV+", () => {
    const both = platformOptions([
      { platforms: ["Apple TV"] },
      { streamingProviders: [{ name: "Apple TV+" }] },
    ]);
    expect(narrowToOwned(both, ["p:apple-tv"]).map((o) => o.group)).toEqual(["games"]);
    expect(narrowToOwned(both, ["s:apple-tv"]).map((o) => o.group)).toEqual(["streaming"]);
  });
});

describe("a SELECTED platform is never hidden by the owned narrowing", () => {
  const opts = platformOptions([
    { streamingProviders: [{ name: "Netflix" }] },
    { platforms: ["Nintendo Switch"] },
  ]);

  it("keeps an active filter visible even when it is not owned", () => {
    // Measured before this: select Nintendo Switch, then narrow "owns" to
    // Netflix alone. The panel offered ONE chip while the list stayed filtered
    // to 209 Switch titles, and the only way out was Reset all — an active
    // filter with no control. Same rule as the "+N more" preview cap.
    const got = narrowToOwned(opts, ["s:netflix"], ["p:nintendo-switch"]);
    expect(got.map((o) => o.key).sort()).toEqual(["p:nintendo-switch", "s:netflix"]);
  });

  it("drops it again once it is deselected", () => {
    expect(narrowToOwned(opts, ["s:netflix"], []).map((o) => o.key)).toEqual(["s:netflix"]);
  });

  it("still passes everything when nothing is owned, selection or not", () => {
    expect(narrowToOwned(opts, [], ["p:nintendo-switch"])).toHaveLength(2);
  });
});
