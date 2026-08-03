import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DisplayStoreLink } from "./affiliate";
import {
  buildStoreLink,
  decorateStoreLinks,
  decorateItemLinks,
  buildBuyLinks,
  isMonetizationEnabled,
  affiliateStatus,
} from "./affiliate";

// H3.4. The tests that matter here are the ones about NOT emitting a commercial
// link: the kill switch, the unconfigured program, and host matching. Fandex is
// gated on H4.0/H4.2 (a published Impressum) precisely because the first
// affiliate link makes the site commercial under §5 DDG, so a leak past the
// switch is a legal problem, not a cosmetic one.

const ENV_KEYS = [
  "MONETIZATION_ENABLED",
  "AFFILIATE_AMAZON_TAG",
  "AFFILIATE_AMAZON_HOST",
  "AFFILIATE_HUMBLE_PARTNER",
  "AFFILIATE_GOG_LINK",
  "AFFILIATE_GMG_LINK",
  "AFFILIATE_FANATICAL_LINK",
  "AFFILIATE_ENEBA_LINK",
  "AFFILIATE_INSTANT_GAMING_LINK",
  "AFFILIATE_KINGUIN_LINK",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The fully-configured state — every program on, switch on. */
function enableAll() {
  process.env.MONETIZATION_ENABLED = "1";
  process.env.AFFILIATE_AMAZON_TAG = "fandex-21";
  process.env.AFFILIATE_HUMBLE_PARTNER = "fandex";
  process.env.AFFILIATE_GOG_LINK = "https://prf.hn/click/camref:1011l1/destination:{url}";
  process.env.AFFILIATE_GMG_LINK = "https://prf.hn/click/camref:1011l2/destination:{url}";
  process.env.AFFILIATE_FANATICAL_LINK = "https://track.test/c/1/3?u={url}";
  process.env.AFFILIATE_ENEBA_LINK = "https://track.test/c/1/4?u={url}";
  process.env.AFFILIATE_INSTANT_GAMING_LINK = "https://track.test/c/1/5?u={url}";
  process.env.AFFILIATE_KINGUIN_LINK = "https://track.test/c/1/6?u={url}";
}

const GOG_URL = "https://www.gog.com/game/cyberpunk_2077";
const STEAM_URL = "https://store.steampowered.com/app/1091500";

function storeRows(): DisplayStoreLink[] {
  return [
    { name: "Steam", url: STEAM_URL, source: "steam" },
    { name: "GOG", url: GOG_URL, source: "rawg" },
  ];
}

describe("the kill switch (H3's H4.0→H4.2 legal gate)", () => {
  it("is off when the var is absent — the correct production state today", () => {
    expect(isMonetizationEnabled()).toBe(false);
  });

  it("emits nothing commercial while off, even with every program configured", () => {
    enableAll();
    delete process.env.MONETIZATION_ENABLED;

    expect(buildStoreLink(GOG_URL)).toEqual({ url: GOG_URL, affiliate: false });
    expect(buildBuyLinks("Cyberpunk 2077", "game")).toEqual([]);
    // Byte-identical, not merely equivalent: nothing may be rewritten.
    expect(decorateStoreLinks(storeRows())).toEqual(storeRows());
  });

  it("accepts 1/true and rejects anything else, so a typo fails CLOSED", () => {
    for (const on of ["1", "true", "TRUE"]) {
      process.env.MONETIZATION_ENABLED = on;
      expect(isMonetizationEnabled()).toBe(true);
    }
    for (const off of ["0", "false", "yes", "on", ""]) {
      process.env.MONETIZATION_ENABLED = off;
      expect(isMonetizationEnabled()).toBe(false);
    }
  });
});

describe("an unconfigured program stays inert", () => {
  it("does not rewrite when the switch is on but no credential is set", () => {
    process.env.MONETIZATION_ENABLED = "1";
    expect(buildStoreLink(GOG_URL).affiliate).toBe(false);
    expect(buildBuyLinks("Hades", "game")).toEqual([]);
  });

  it("rejects a deeplink template with NEITHER placeholder rather than sending traffic to a bare homepage", () => {
    process.env.MONETIZATION_ENABLED = "1";
    process.env.AFFILIATE_GOG_LINK = "https://prf.hn/click/camref:1011l1";
    expect(buildStoreLink(GOG_URL).affiliate).toBe(false);
    expect(affiliateStatus().configured).not.toContain("gog");
  });

  it("accepts either placeholder as configuration", () => {
    process.env.MONETIZATION_ENABLED = "1";
    for (const tpl of ["https://n.test/c?u={url}", "https://n.test/c?u={urlRaw}"]) {
      process.env.AFFILIATE_GOG_LINK = tpl;
      expect(affiliateStatus().configured, tpl).toContain("gog");
    }
  });

  it("treats a whitespace-only credential as unset", () => {
    process.env.MONETIZATION_ENABLED = "1";
    process.env.AFFILIATE_AMAZON_TAG = "   ";
    expect(buildBuyLinks("Dune", "movie")).toEqual([]);
  });
});

describe("buildStoreLink — rewriting links we already render", () => {
  beforeEach(enableAll);

  it("wraps a GOG url in the network deeplink, url-encoded", () => {
    const { url, affiliate } = buildStoreLink(GOG_URL);
    expect(affiliate).toBe(true);
    expect(url).toBe(
      `https://prf.hn/click/camref:1011l1/destination:${encodeURIComponent(GOG_URL)}`
    );
  });

  it("substitutes {urlRaw} verbatim, for networks that append the destination", () => {
    // Adtraction (GOG's network) documents a RAW url last in the query string.
    // Encoding it there would send every click to a url the network can't parse.
    process.env.AFFILIATE_GOG_LINK = "https://track.adtraction.com/t/t?a=243&as=110183&t=2&tk=1&url={urlRaw}";
    const { url, affiliate } = buildStoreLink(GOG_URL);
    expect(affiliate).toBe(true);
    expect(url).toBe(
      `https://track.adtraction.com/t/t?a=243&as=110183&t=2&tk=1&url=${GOG_URL}`
    );
    expect(url).not.toContain("%3A%2F%2F");
  });

  it("still encodes for {url}, so the two placeholders can't be confused", () => {
    expect(buildStoreLink(GOG_URL).url).toContain(encodeURIComponent(GOG_URL));
  });

  it("leaves Steam alone — the most common store row, and it has no affiliate program", () => {
    expect(buildStoreLink(STEAM_URL)).toEqual({ url: STEAM_URL, affiliate: false });
  });

  it("appends Amazon's tag as a query param and never as a redirect", () => {
    const { url, affiliate } = buildStoreLink("https://www.amazon.de/dp/B08X");
    expect(affiliate).toBe(true);
    // Amazon's Operating Agreement disqualifies commission on links reached via
    // an intermediate redirect, so the host must remain Amazon's own.
    expect(new URL(url).hostname).toBe("www.amazon.de");
    expect(new URL(url).searchParams.get("tag")).toBe("fandex-21");
  });

  it("preserves existing query params instead of clobbering them", () => {
    const { url } = buildStoreLink("https://www.amazon.de/s?k=dune&i=dvd");
    const p = new URL(url).searchParams;
    expect(p.get("k")).toBe("dune");
    expect(p.get("i")).toBe("dvd");
    expect(p.get("tag")).toBe("fandex-21");
  });

  it("does not overwrite a tag the provider url already carried", () => {
    const withTag = "https://www.amazon.de/dp/B08X?tag=someone-else-21";
    const { url } = buildStoreLink(withTag);
    expect(new URL(url).searchParams.get("tag")).toBe("someone-else-21");
    expect(url).not.toContain("fandex-21");
  });

  it("is idempotent — decorating twice does not double-tag", () => {
    const once = buildStoreLink(GOG_URL).url;
    // The wrapped url is on the network's host, which no program claims, so a
    // second pass must leave it exactly as it is.
    expect(buildStoreLink(once)).toEqual({ url: once, affiliate: false });
  });
});

describe("host matching cannot be tricked", () => {
  beforeEach(enableAll);

  it("matches subdomains but not lookalike or suffix-appended hosts", () => {
    expect(buildStoreLink("https://embed.gog.com/game/x").affiliate).toBe(true);
    expect(buildStoreLink("https://www.gog.com/game/x").affiliate).toBe(true);
    for (const evil of [
      "https://gog.com.attacker.test/game/x",
      "https://notgog.com/game/x",
      "https://evil-amazon.de/dp/B08X",
      "https://amazon.de.phish.test/dp/B08X",
    ]) {
      expect(buildStoreLink(evil), evil).toEqual({ url: evil, affiliate: false });
    }
  });

  it("never throws on a malformed or non-web url — an item page must not break on bad provider data", () => {
    for (const bad of ["", "not a url", "javascript:alert(1)", "data:text/html,x", "//gog.com/x"]) {
      expect(() => buildStoreLink(bad)).not.toThrow();
      expect(buildStoreLink(bad)).toEqual({ url: bad, affiliate: false });
    }
  });
});

describe("decorateStoreLinks", () => {
  beforeEach(enableAll);

  it("flags only the rows it actually rewrote", () => {
    const out = decorateStoreLinks(storeRows());
    expect(out.find((l) => l.name === "Steam")?.affiliate).toBeUndefined();
    const gog = out.find((l) => l.name === "GOG")!;
    expect(gog.affiliate).toBe(true);
    expect(gog.url).not.toBe(GOG_URL);
    // Non-url fields survive untouched — the UI keys and colours off them.
    expect(gog.source).toBe("rawg");
  });

  it("does not mutate the caller's array", () => {
    const input = storeRows();
    decorateStoreLinks(input);
    expect(input[1].url).toBe(GOG_URL);
    expect(input[1].affiliate).toBeUndefined();
  });
});

describe("buildBuyLinks — the half that can actually earn", () => {
  beforeEach(enableAll);

  it("offers every game program and puts gray-market keyshops last", () => {
    const links = buildBuyLinks("Hollow Knight: Silksong", "game");
    expect(links.map((l) => l.programId)).toEqual([
      "amazon", "humble", "gog", "gmg", "fanatical",
      "eneba", "instantGaming", "kinguin",
    ]);
    const firstGray = links.findIndex((l) => l.grayMarket);
    expect(links.slice(firstGray).every((l) => l.grayMarket)).toBe(true);
  });

  it("url-encodes the title into the merchant search, punctuation and all", () => {
    const humble = buildBuyLinks("Hollow Knight: Silksong", "game").find((l) => l.programId === "humble")!;
    const u = new URL(humble.url);
    expect(u.hostname).toBe("www.humblebundle.com");
    expect(u.searchParams.get("search")).toBe("Hollow Knight: Silksong");
    expect(u.searchParams.get("partner")).toBe("fandex");
  });

  it("offers only Amazon for movies and shows — the keyshops sell games", () => {
    for (const type of ["movie", "show"] as const) {
      expect(buildBuyLinks("Dune: Part Two", type).map((l) => l.programId)).toEqual(["amazon"]);
    }
  });

  it("narrows physical media to Blu-ray so the 6% PartnerNet rate applies", () => {
    const [amazon] = buildBuyLinks("Dune: Part Two", "movie");
    expect(new URL(amazon.url).searchParams.get("k")).toBe("Dune: Part Two Blu-ray");
    // …and does NOT do that for games, which are keys, not discs.
    const gameAmazon = buildBuyLinks("Hades", "game").find((l) => l.programId === "amazon")!;
    expect(new URL(gameAmazon.url).searchParams.get("k")).toBe("Hades");
  });

  it("honours AFFILIATE_AMAZON_HOST and defaults to amazon.de", () => {
    expect(new URL(buildBuyLinks("Hades", "game")[0].url).hostname).toBe("www.amazon.de");
    process.env.AFFILIATE_AMAZON_HOST = "amazon.co.uk";
    expect(new URL(buildBuyLinks("Hades", "game")[0].url).hostname).toBe("www.amazon.co.uk");
  });

  it("returns nothing for a blank title rather than a link to an empty search", () => {
    expect(buildBuyLinks("", "game")).toEqual([]);
    expect(buildBuyLinks("   ", "game")).toEqual([]);
  });

  it("survives a malformed AFFILIATE_AMAZON_HOST by dropping that one program", () => {
    process.env.AFFILIATE_AMAZON_HOST = "not a host";
    const links = buildBuyLinks("Hades", "game");
    expect(links.some((l) => l.programId === "amazon")).toBe(false);
    expect(links.length).toBeGreaterThan(0);
  });
});

describe("decorateItemLinks — the one call both detail boundaries make", () => {
  it("is fully inert while the switch is off", () => {
    enableAll();
    delete process.env.MONETIZATION_ENABLED;
    const out = decorateItemLinks(storeRows(), "Cyberpunk 2077", "game");
    expect(out.buyLinks).toEqual([]);
    expect(out.storeLinks).toEqual(storeRows());
  });

  it("drops the synthesized search link for a merchant we already product-link", () => {
    enableAll();
    const out = decorateItemLinks(storeRows(), "Cyberpunk 2077", "game");
    // The item has a real GOG product page, so no GOG *search* row…
    expect(out.buyLinks.map((l) => l.programId)).not.toContain("gog");
    // …but the product row itself is still tagged.
    expect(out.storeLinks.find((l) => l.name === "GOG")?.affiliate).toBe(true);
    // Everything else still offered.
    expect(out.buyLinks.map((l) => l.programId)).toContain("gmg");
  });

  it("excludes on the ORIGINAL url, not the rewritten one", () => {
    enableAll();
    // Regression guard: after decoration a deeplinked row points at prf.hn,
    // which no program claims — deriving the exclusion list from the rewritten
    // rows would silently dedupe nothing and GOG would appear twice again.
    const twice = decorateItemLinks(
      decorateItemLinks(storeRows(), "Cyberpunk 2077", "game").storeLinks,
      "Cyberpunk 2077",
      "game"
    );
    expect(twice.buyLinks.map((l) => l.programId)).toContain("gog");
  });

  it("keeps a merchant we don't link to — Steam's presence excludes nothing", () => {
    enableAll();
    const out = decorateItemLinks(
      [{ name: "Steam", url: STEAM_URL, source: "steam" }],
      "Hades",
      "game"
    );
    expect(out.buyLinks.map((l) => l.programId)).toContain("gog");
    expect(out.buyLinks).toHaveLength(8);
  });
});

describe("affiliateStatus — the H3.9 go-live readout", () => {
  it("reports configuration independently of the switch, and never leaks credentials", () => {
    process.env.AFFILIATE_AMAZON_TAG = "fandex-21";
    const s = affiliateStatus();
    expect(s.enabled).toBe(false);
    expect(s.configured).toEqual(["amazon"]);
    expect(s.unconfigured).toContain("kinguin");
    expect(JSON.stringify(s)).not.toContain("fandex-21");
  });
});
