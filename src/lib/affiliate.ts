import type { AffiliateProgramId, BuyLink, Source } from "@/types";

// H3.4 — the affiliate layer. SERVER-ONLY (reads non-public env vars); the client
// only ever receives the already-built urls plus a boolean `affiliate` flag.
//
// ── Why this file exists in the shape it does ────────────────────────────────
//
// TASKS.md scoped H3.4 as "a shared buildStoreLink() called from ~5 inline
// sites" — rewriting store urls as they're normalized. Two things found while
// building it moved the design:
//
// 1. **The merchants we link to are not the merchants we have programs with.**
//    Measured against the live `data/rr.db` (400 RAWG game links, 2026-08-03),
//    every store row we render is one of: Steam (291), PlayStation Store (118),
//    GOG (109), Xbox Store (86), Nintendo Store (76), App Store (50), Epic (47),
//    itch.io (34), Google Play (34). Of those only **GOG** has an affiliate
//    program worth wiring; Steam has none at all (TASKS.md already noted this),
//    and the console/mobile storefronts don't offer one either. Meanwhile every
//    program H3.4 actually decided on — GMG, Humble, Fanatical, Amazon
//    PartnerNet, Eneba, Instant Gaming, Kinguin — appears **zero times** in the
//    data. So a pure url-rewriter, which is all the original scope described,
//    would have earned approximately nothing. Hence the second half of this
//    module: `buildBuyLinks()` SYNTHESIZES per-title search links to the
//    merchants we do have programs with. That is where any revenue would come
//    from; the rewriter (`buildStoreLink`) covers the GOG-shaped case.
//
// 2. **Nobody can know a network's link format before signing up.** Amazon and
//    Humble take a plain query parameter on their own domain (verified, see
//    below). The rest run through affiliate NETWORKS (Partnerize, Admitad,
//    FlexOffers, MyLead…) which mint a per-affiliate deep link — the exact
//    template is only visible inside an account Nils doesn't have yet. So those
//    programs are configured as a **template string with a `{url}` placeholder**
//    rather than hardcoded builders: paste the network's own deep link in, and
//    it works with no code change and no redeploy of this logic.
//
// ── Where this runs (deliberately NOT in normalize.ts or mergeLinks) ─────────
//
// Decoration happens at the two DETAIL RENDER boundaries (`/api/detail` and
// `lib/detail/publicDetail.ts`), never at projection or merge time:
//
//   * Not in `normalize.ts` — stored projections would carry baked-in affiliate
//     tags, so changing a tag would need a PROJECTION_VERSION bump and a
//     full-catalog re-projection. That is the exact class of heavy operation
//     that blew the Railway compute budget and took prod down on 2026-07-22.
//     This way a tag change takes effect on the next request, for free.
//   * Not in `mergeLinks()` — it's on the hot path for facetCache, discovery,
//     libraryAnalysis and liveDiscover, none of which render a store link, and
//     it's covered by characterization snapshots this has no business churning.
//
// ── The legal gate, encoded ─────────────────────────────────────────────────
//
// `MONETIZATION_ENABLED` defaults to OFF and everything here is inert without
// it. H3's hard gate is H4.0 → H4.2 (a published Impressum): the first affiliate
// link makes the site commercial under §5 DDG. Do not flip the switch before
// the Impressum is live — see docs/monetization-go-live.md.
//
// ── Cookie exemption (§25 TDDDG) ────────────────────────────────────────────
//
// Every link produced here is a **direct outbound `<a href>`** to the merchant
// or to the affiliate network's own domain. Fandex hosts no `/out?url=…`
// redirect and sets no click cookie, so `docs/cookie-assessment.md`'s
// strictly-necessary exemption is untouched and no consent banner is triggered —
// that document's stated condition, met by construction. A network's own
// redirect hop (prf.hn, etc.) sets cookies on the NETWORK's domain, not on
// fandex.org, which is the distinction that matters.
//
// Amazon is additionally a `param` program and can never be configured as a
// deeplink: the Associates Operating Agreement forbids cloaking a Special Link
// behind a redirect and only pays on a direct click-through.
// https://affiliate-program.amazon.com/help/operating/policies (checked 2026-08-03)

interface AffiliateProgram {
  id: AffiliateProgramId;
  label: string;
  /**
   * Hostnames this program owns, for rewriting links we ALREADY render. Matched
   * as exact-or-subdomain, never as a substring — `amazon.de.evil.test` must not
   * match `amazon.de`.
   */
  hosts: string[];
  /**
   * `param`   — append `?<param>=<tag>` to the merchant's own url. Required for
   *             Amazon (no redirects allowed); also how Humble works.
   * `deeplink`— substitute the url-encoded merchant url into a network template
   *             held in env, e.g. `https://prf.hn/click/camref:1011l123/destination:{url}`.
   */
  kind: "param" | "deeplink";
  /** Query-parameter name, for `kind: "param"` only. */
  param?: string;
  /** Env var holding the tag (`param`) or the `{url}` template (`deeplink`). */
  env: string;
  /** Builds a per-title search url on the merchant's own domain, pre-affiliate. */
  search: (query: string, host: string) => string;
  /**
   * Which media this merchant is worth offering for. Keyshops sell games only;
   * Amazon covers physical movie/show media (Blu-ray/DVD, PartnerNet's 6%).
   */
  media: ("game" | "movie" | "show")[];
  /**
   * Gray-market key reseller. Decided IN for v1 (TASKS.md H3.4) with noted
   * reputational + key-provenance risk — surfaced in the UI, and ordered after
   * the authorized retailers rather than mixed in with them.
   */
  grayMarket?: boolean;
}

// Amazon associate tags are marketplace-specific. The operator is DE-based and
// PartnerNet is the German program, so the default marketplace is amazon.de;
// override with AFFILIATE_AMAZON_HOST if the account is registered elsewhere.
const DEFAULT_AMAZON_HOST = "amazon.de";

const PROGRAMS: AffiliateProgram[] = [
  {
    id: "amazon",
    label: "Amazon",
    hosts: ["amazon.de", "amazon.com", "amazon.co.uk", "amazon.fr", "amazon.it", "amazon.es", "amzn.to"],
    kind: "param",
    param: "tag",
    env: "AFFILIATE_AMAZON_TAG",
    // A bare title search returns every format (stream, book, soundtrack); the
    // caller narrows it for physical media — see buildBuyLinks().
    search: (q, host) => `https://www.${host}/s?k=${encodeURIComponent(q)}`,
    media: ["game", "movie", "show"],
  },
  {
    id: "humble",
    label: "Humble Store",
    hosts: ["humblebundle.com"],
    kind: "param",
    param: "partner",
    env: "AFFILIATE_HUMBLE_PARTNER",
    search: (q) => `https://www.humblebundle.com/store/search?search=${encodeURIComponent(q)}`,
    media: ["game"],
  },
  {
    id: "gog",
    label: "GOG",
    // The one program that also rewrites links we already render — GOG is the
    // 3rd most common store row in the catalog (109/400 sampled game links).
    hosts: ["gog.com"],
    kind: "deeplink",
    env: "AFFILIATE_GOG_LINK",
    search: (q) => `https://www.gog.com/en/games?query=${encodeURIComponent(q)}`,
    media: ["game"],
  },
  {
    id: "gmg",
    label: "Green Man Gaming",
    hosts: ["greenmangaming.com"],
    kind: "deeplink",
    env: "AFFILIATE_GMG_LINK",
    search: (q) => `https://www.greenmangaming.com/search?query=${encodeURIComponent(q)}`,
    media: ["game"],
  },
  {
    id: "fanatical",
    label: "Fanatical",
    hosts: ["fanatical.com"],
    kind: "deeplink",
    env: "AFFILIATE_FANATICAL_LINK",
    search: (q) => `https://www.fanatical.com/en/search?search=${encodeURIComponent(q)}`,
    media: ["game"],
  },
  {
    id: "eneba",
    label: "Eneba",
    hosts: ["eneba.com"],
    kind: "deeplink",
    env: "AFFILIATE_ENEBA_LINK",
    search: (q) => `https://www.eneba.com/store?text=${encodeURIComponent(q)}`,
    media: ["game"],
    grayMarket: true,
  },
  {
    id: "instantGaming",
    label: "Instant Gaming",
    hosts: ["instant-gaming.com"],
    kind: "deeplink",
    env: "AFFILIATE_INSTANT_GAMING_LINK",
    search: (q) => `https://www.instant-gaming.com/en/search/?q=${encodeURIComponent(q)}`,
    media: ["game"],
    grayMarket: true,
  },
  {
    id: "kinguin",
    label: "Kinguin",
    hosts: ["kinguin.net"],
    kind: "deeplink",
    env: "AFFILIATE_KINGUIN_LINK",
    search: (q) => `https://www.kinguin.net/listing?phrase=${encodeURIComponent(q)}`,
    media: ["game"],
    grayMarket: true,
  },
];

/** A store row as rendered. `affiliate` drives the mandatory §5a UWG marker. */
export interface DisplayStoreLink {
  name: string;
  url: string;
  source: Source;
  affiliate?: boolean;
}

// ── Config ───────────────────────────────────────────────────────────────────

// Env is read per call rather than memoized at module load: `next dev` keeps a
// module registry alive across edits, and a cached-at-import switch would make
// "I set the env var and nothing happened" a confusing five minutes. These are
// a handful of property reads on a path that already does a DB round-trip and a
// JSON.parse of a multi-KB blob — not worth caching.
function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * The master kill switch for every commercial link on the site.
 *
 * **Defaults to off, and must stay off until H4.2's Impressum is live** — the
 * first affiliate link makes Fandex commercial under §5 DDG. This is H3's hard
 * gate expressed as code rather than as a line in a doc.
 */
export function isMonetizationEnabled(): boolean {
  return envFlag("MONETIZATION_ENABLED");
}

/**
 * Networks disagree on whether the destination in a deep link should be
 * percent-encoded. Partnerize wants it encoded (`/destination:https%3A%2F%2F…`);
 * Adtraction — which is GOG's network — documents a RAW url, last in the query
 * string (`…&tk=1&url=https://www.gog.com/…`). Supporting only one would make
 * the first program signed up a coin flip between "works" and "silently sends
 * every click to a truncated url", so the template picks:
 *
 *   `{url}`     → percent-encoded  (Partnerize, Impact, most networks)
 *   `{urlRaw}`  → verbatim         (Adtraction, and anything else that appends)
 *
 * Checked 2026-08-03:
 * https://help.adtraction.com/en/articles/1563592-how-to-create-tracking-links
 */
const URL_PLACEHOLDERS = ["{url}", "{urlRaw}"] as const;

/** The configured credential for a program, or null when it isn't set up. */
function credential(p: AffiliateProgram): string | null {
  const raw = process.env[p.env]?.trim();
  if (!raw) return null;
  // A deeplink template without a placeholder would silently send every visitor
  // to the network's bare homepage. Refuse it rather than emit it.
  if (p.kind === "deeplink" && !URL_PLACEHOLDERS.some((ph) => raw.includes(ph))) return null;
  return raw;
}

/** Programs that are switched on AND configured. Empty unless both hold. */
function activePrograms(): { program: AffiliateProgram; credential: string }[] {
  if (!isMonetizationEnabled()) return [];
  const out: { program: AffiliateProgram; credential: string }[] = [];
  for (const program of PROGRAMS) {
    const c = credential(program);
    if (c) out.push({ program, credential: c });
  }
  return out;
}

/**
 * Which programs are live, for the H3.9 go-live check and `/api/health`. Returns
 * only ids and booleans — never the credentials themselves.
 */
export function affiliateStatus(): {
  enabled: boolean;
  configured: AffiliateProgramId[];
  unconfigured: AffiliateProgramId[];
} {
  const configured = PROGRAMS.filter((p) => credential(p) !== null).map((p) => p.id);
  return {
    enabled: isMonetizationEnabled(),
    configured,
    unconfigured: PROGRAMS.filter((p) => !configured.includes(p.id)).map((p) => p.id),
  };
}

// ── Link building ────────────────────────────────────────────────────────────

/** Exact-or-subdomain host match. `evil-amazon.de.test` must never match `amazon.de`. */
function hostMatches(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return h === host || h.endsWith(`.${host}`);
}

/**
 * Which program owns this url, if any — regardless of whether it's configured or
 * switched on. Used to dedupe a synthesized search link against a real product
 * link we already have for the same merchant.
 */
export function programForUrl(url: string): AffiliateProgramId | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return PROGRAMS.find((p) => p.hosts.some((h) => hostMatches(parsed.hostname, h)))?.id ?? null;
}

function applyProgram(url: URL, program: AffiliateProgram, cred: string): string {
  if (program.kind === "param") {
    // Don't stomp a tag that's somehow already there — a provider url that
    // already carries someone's tag is a data problem to look at, not something
    // to silently overwrite, and duplicating the key would make the url invalid.
    if (url.searchParams.has(program.param!)) return url.toString();
    url.searchParams.set(program.param!, cred);
    return url.toString();
  }
  // `{urlRaw}` first: `{url}` is a substring of neither, but checking the more
  // specific placeholder first keeps this correct if one is ever renamed.
  const dest = url.toString();
  return cred.includes("{urlRaw}")
    ? cred.replace("{urlRaw}", dest)
    : cred.replace("{url}", encodeURIComponent(dest));
}

/**
 * The shared helper TASKS.md H3.4 specifies. Given any outbound url, returns the
 * affiliate version when the destination belongs to a switched-on, configured
 * program — otherwise the url untouched.
 *
 * Never throws: a malformed provider url must not be able to break an item page,
 * so anything unparseable comes back exactly as it went in.
 */
export function buildStoreLink(url: string): { url: string; affiliate: boolean } {
  const active = activePrograms();
  if (active.length === 0) return { url, affiliate: false };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, affiliate: false };
  }
  // javascript:/data: can't be an affiliate link and shouldn't be rewritten
  // into one; only real web destinations qualify.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { url, affiliate: false };

  for (const { program, credential: cred } of active) {
    if (!program.hosts.some((h) => hostMatches(parsed.hostname, h))) continue;
    return { url: applyProgram(parsed, program, cred), affiliate: true };
  }
  return { url, affiliate: false };
}

/**
 * Rewrite a merged item's store rows in place-ish (returns a new array). Rows
 * whose destination isn't a configured program pass through byte-identical, so
 * with the kill switch off this is a no-op that only costs an array copy.
 */
export function decorateStoreLinks(links: DisplayStoreLink[]): DisplayStoreLink[] {
  if (activePrograms().length === 0) return links;
  return links.map((l) => {
    const { url, affiliate } = buildStoreLink(l.url);
    return affiliate ? { ...l, url, affiliate: true } : l;
  });
}

/**
 * Synthesize per-title "buy" rows for every configured program that covers this
 * media type. This is the half that can actually earn: the catalog's real store
 * rows are Steam/PSN/Xbox/Nintendo/Epic/itch.io, none of which pay (see the
 * header note), so without these there is nothing to monetize.
 *
 * A SEARCH link, not a product link, and deliberately so: none of these
 * merchants expose a per-product id we could map a title to without ingesting
 * their catalog feed, and a search for the exact title lands the visitor on the
 * right product page in one hop. Authorized retailers are ordered ahead of the
 * gray-market keyshops rather than interleaved.
 *
 * Returns `[]` whenever monetization is off — which is what keeps the whole
 * commercial surface invisible until H4.2 ships.
 */
export function buildBuyLinks(
  title: string,
  type: "game" | "movie" | "show",
  /**
   * Programs to skip because the item already carries a real product link for
   * that merchant. A tagged product page converts better than a search page and
   * costs the visitor a hop less, so when we have both, the search link is pure
   * duplication — verified on a live item page, where GOG showed up twice.
   */
  exclude: AffiliateProgramId[] = []
): BuyLink[] {
  const q = title.trim();
  if (!q) return [];

  const amazonHost = process.env.AFFILIATE_AMAZON_HOST?.trim() || DEFAULT_AMAZON_HOST;
  const out: BuyLink[] = [];

  for (const { program, credential: cred } of activePrograms()) {
    if (!program.media.includes(type)) continue;
    if (exclude.includes(program.id)) continue;
    // Physical media on Amazon: a bare title matches the streaming/book/soundtrack
    // editions too, so narrow it to the format the 6% PartnerNet rate applies to.
    const query = program.id === "amazon" && type !== "game" ? `${q} Blu-ray` : q;

    let built: string;
    try {
      built = applyProgram(new URL(program.search(query, amazonHost)), program, cred);
    } catch {
      continue; // A bad AFFILIATE_AMAZON_HOST shouldn't take the item page down.
    }
    out.push({ programId: program.id, label: program.label, url: built, grayMarket: !!program.grayMarket });
  }

  return out.sort((a, b) => Number(a.grayMarket) - Number(b.grayMarket));
}

/**
 * The ONE call both detail boundaries make. Rewrites the item's existing store
 * rows and synthesizes its buy rows in a single step, with the dedupe between
 * them applied once — `/api/detail` and `lib/detail/publicDetail.ts` render the
 * same component, so letting each assemble this itself is exactly how the two
 * paths would drift (the public page has diverged from the authed one before).
 *
 * Returns `buyLinks: []` and untouched `storeLinks` while monetization is off.
 */
export function decorateItemLinks(
  storeLinks: DisplayStoreLink[],
  title: string,
  type: "game" | "movie" | "show"
): { storeLinks: DisplayStoreLink[]; buyLinks: BuyLink[] } {
  // Read the program ids off the ORIGINAL urls: after decoration a deeplinked
  // row points at the network's host, which no program claims, so deriving the
  // exclusion list from the rewritten rows would silently dedupe nothing.
  const alreadyLinked = storeLinks
    .map((l) => programForUrl(l.url))
    .filter((id): id is AffiliateProgramId => id !== null);

  return {
    storeLinks: decorateStoreLinks(storeLinks),
    buyLinks: buildBuyLinks(title, type, alreadyLinked),
  };
}
