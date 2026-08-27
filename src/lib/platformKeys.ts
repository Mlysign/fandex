// "Available on" — turning an item's platform / streaming data into filterable keys.
//
// A LEAF module on purpose: no imports at all, so a client component can use it
// without dragging `db.ts` into the browser bundle. That trap is an invariant in
// AGENTS.md and it fails as a 500 on the page with tsc, lint and every test green.
//
// ── Two namespaces, deliberately not merged ─────────────────────────────────
// `platforms` on a merged item comes from steam/rawg/igdb and is GAMES-only.
// `streamingProviders` comes from TMDB and is MOVIES/SHOWS-only. They are
// different dimensions that happen to answer the same question ("can I actually
// watch or play this?"), and some names live in both worlds — "Apple TV" is a
// streaming service AND a hardware platform. So keys carry their namespace:
//   p:nintendo-switch   a games platform
//   s:netflix           a streaming provider
// Never compare the bare names.

export type PlatformGroup = "games" | "streaming";

const PREFIX: Record<PlatformGroup, string> = { games: "p", streaming: "s" };

/** Stable key for a provider/platform name. Lossy on purpose — display comes from the label. */
export function platformKey(name: string, group: PlatformGroup): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // strip NFD combining marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // ⚠️ "+" and " Plus" are the SAME service spelled two ways, and TMDB
    // returns both — measured on the real library: "Paramount+" 41 alongside
    // "Paramount Plus" 39, "Disney Plus" 259, "Apple TV+" beside "Apple TV".
    // Without this the panel offers the same subscription twice with the
    // audience split across the pair, which reads as two services you don't
    // quite have. The "+" is already gone by here (non-alphanumeric), so this
    // only has to catch the spelled-out tail.
    .replace(/-plus$/, "");
  return `${PREFIX[group]}:${slug}`;
}

export function groupOfKey(key: string): PlatformGroup | null {
  if (key.startsWith("p:")) return "games";
  if (key.startsWith("s:")) return "streaming";
  return null;
}

/** A well-formed key: a known namespace and a non-empty slug. */
export function isPlatformKey(v: unknown): v is string {
  return typeof v === "string" && /^[ps]:[a-z0-9][a-z0-9-]*$/.test(v) && v.length <= 64;
}

/**
 * Clean a list of keys arriving from a client: drop malformed and duplicate
 * entries, keep the order, and cap the length.
 *
 * The cap is not paranoia about abuse — `withUser` rate-limits and this is the
 * user's own row. It bounds a value that is read on the hot filter path and
 * echoed in /api/auth/me, and 200 is far past any real collection (the largest
 * catalog measured offers 116 platforms in total).
 */
export function sanitizePlatformKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (!isPlatformKey(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 200) break;
  }
  return out;
}

// ── Collapsing the long tail ────────────────────────────────────────────────
// Providers arrive with tier and delivery suffixes that are not different
// services to a person choosing what they own: TMDB alone returns "Netflix",
// "Netflix basic with Ads" and "Netflix Kids"; RAWG returns "PlayStation 5" and
// "PlayStation 4" where "do I own a PlayStation" is the real question only
// sometimes — so consoles are NOT collapsed by generation (a PS4 game does not
// run on a Switch, and generation matters for whether you can play it), while
// service tiers ARE (an ad-tier Netflix subscription still shows you the film).
//
// ⚠️ Keep this list short and evidence-led. Every entry is a claim that two
// names are the same thing to a user, and a wrong one silently merges two
// filters into one.
const TIER_SUFFIX = /\s+(basic with ads|with ads|standard with ads|premium|basic|kids|amazon channel|apple tv channel|roku premium channel)$/i;

// ── One platform, three providers, three names ──────────────────────────────
// The games half is worse than the streaming half, because three sources
// describe the same hardware differently. Measured on the real library:
//   "PC (Microsoft Windows)" 584   (IGDB)
//   "Windows"                584   (Steam)
//   "PC"                     478   (RAWG)
// all one platform, listed as the top THREE chips — so the most common thing
// you own appeared three times and none of the counts was the real one.
//
// ⚠️ Only fold names that are provably the same hardware. Xbox Series X|S is
// one entry because the two SKUs run the same games; Xbox One is NOT folded
// into it, and PlayStation 4 is not folded into 5, for the same reason console
// generations are kept apart above.
const PLATFORM_ALIAS: Record<string, string> = {
  "pc (microsoft windows)": "PC",
  "windows": "PC",
  "pc": "PC",
  "win": "PC",
  "mac": "macOS",
  "macos": "macOS",
  "mac os": "macOS",
  "osx": "macOS",
  "linux": "Linux",
  "pc (linux)": "Linux",
  "xbox series x": "Xbox Series X|S",
  "xbox series s": "Xbox Series X|S",
  "xbox series x|s": "Xbox Series X|S",
  "xbox series x/s": "Xbox Series X|S",
};

/** Display label for a raw provider name: service tiers folded, platform aliases canonicalised. */
export function platformLabel(name: string): string {
  const trimmed = name.replace(TIER_SUFFIX, "").trim();
  return PLATFORM_ALIAS[trimmed.toLowerCase()] ?? trimmed;
}

/** The keys an item is "available on", from its merged platform + streaming data. */
export function availableOnKeys(item: {
  platforms?: string[] | null;
  streamingProviders?: { name: string }[] | null;
}): string[] {
  const out = new Set<string>();
  for (const p of item.platforms ?? []) {
    const label = platformLabel(p);
    if (label) out.add(platformKey(label, "games"));
  }
  for (const s of item.streamingProviders ?? []) {
    const label = platformLabel(s?.name ?? "");
    if (label) out.add(platformKey(label, "streaming"));
  }
  return [...out];
}

// ── Which brand mark draws a platform ───────────────────────────────────────
// BRAND_MARKS is keyed by the mark's own display name; provider data is not.
// TMDB says "Apple TV+" where the icon is "Apple TV"; RAWG says "PlayStation 5"
// where the icon is "PlayStation". An EXPLICIT map rather than a prefix match,
// for the reason BrandGlyph already states about its own source map: a platform
// with no mark should be a decision visible in a diff, not a silent miss.
//
// Anything absent here falls through to BrandGlyph's globe with the name
// alongside, which is fine — colour is never the only carrier, and simple-icons
// genuinely no longer ships Nintendo, Xbox, Disney+, Prime Video or Hulu.
const PLATFORM_MARK: Record<string, string> = {
  "Netflix": "Netflix",
  "HBO Max": "HBO Max",
  "Max": "Max",
  "Apple TV+": "Apple TV",
  "Apple TV": "Apple TV",
  "Paramount+": "Paramount+",
  "Paramount Plus": "Paramount+",
  "Crunchyroll": "Crunchyroll",
  "PlayStation 5": "PlayStation",
  "PlayStation 4": "PlayStation",
  "PlayStation 3": "PlayStation",
  "PlayStation": "PlayStation",
  // ⚠️ No entry for "PC" or "macOS", deliberately. PC is not Steam (a PC game
  // may be GOG- or Epic-only) and macOS is not Apple TV. Drawing a store's mark
  // for an operating system states something untrue about where you can buy it.
};

/** The BRAND_MARKS name that draws this platform, or the label itself as a last try. */
export function platformMarkName(label: string): string {
  return PLATFORM_MARK[label] ?? label;
}

export interface PlatformOption { key: string; label: string; group: PlatformGroup; count: number }

/**
 * Build the option list from the items actually on screen, most common first.
 *
 * Counts only what is loaded, because that is all the filter can act on
 * (Discover and MyStuff both filter client-side — see `passesYearMembership`).
 *
 * ⚠️ This is no longer the whole option list. A platform with nothing loaded on
 * it still gets a chip, at 0, via `withKnownPlatforms` below — the earlier rule
 * ("do not offer a control that returns nothing") turned out to be worse in
 * practice, because it made whole sections disappear. Read that function's note
 * before reverting this to a loaded-only list.
 */
export function platformOptions(
  items: { platforms?: string[] | null; streamingProviders?: { name: string }[] | null }[]
): PlatformOption[] {
  const byKey = new Map<string, PlatformOption>();
  const bump = (raw: string, group: PlatformGroup) => {
    const label = platformLabel(raw);
    if (!label) return;
    const key = platformKey(label, group);
    const hit = byKey.get(key);
    if (hit) {
      hit.count += 1;
      // Two spellings now share a key ("Paramount+" / "Paramount Plus"). Show
      // the SHORTER one: it is reliably the branded form, and picking by
      // arrival order would make the label depend on catalog iteration order.
      if (label.length < hit.label.length) hit.label = label;
    } else {
      byKey.set(key, { key, label, group, count: 1 });
    }
  };
  for (const it of items) {
    // Per ITEM, not per raw string: an item listing "Netflix" and "Netflix Kids"
    // must count once, or the tally reads higher than the filtered result.
    const seen = new Set<string>();
    for (const p of it.platforms ?? []) {
      const k = platformKey(platformLabel(p), "games");
      if (!seen.has(k)) { seen.add(k); bump(p, "games"); }
    }
    for (const s of it.streamingProviders ?? []) {
      const k = platformKey(platformLabel(s?.name ?? ""), "streaming");
      if (!seen.has(k)) { seen.add(k); bump(s?.name ?? "", "streaming"); }
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Narrow the filter's options to the platforms this account says it owns.
 *
 * A real library offers 116 platforms and services, most of which the person
 * has no way to watch or play. Once they have told us what they own, the filter
 * should offer that and nothing else — which is the whole point of the setting.
 *
 * ⚠️ An EMPTY owned list means "not configured", not "owns nothing", and must
 * pass everything through. The two are indistinguishable in the stored value and
 * this is the only reading that leaves the filter working for the people who
 * never open settings. If "owns nothing" ever needs saying, it needs its own
 * flag, not an empty array.
 *
 * ⚠️ This is an INTERSECTION with what is loaded, not a replacement. Owning
 * Netflix does not conjure a Netflix chip when nothing on screen is on Netflix —
 * a chip that matches nothing is a control that does nothing.
 */
export function narrowToOwned(
  options: PlatformOption[],
  owned: string[] | null | undefined,
  selected: readonly string[] = []
): PlatformOption[] {
  if (!owned || owned.length === 0) return options;
  const set = new Set(owned);
  // ⚠️ A SELECTED platform survives the narrowing even when it is not owned.
  // Without this the filter can run on something with no chip to un-press:
  // measured, after selecting Nintendo Switch and then narrowing "owns" to
  // Netflix alone, the panel offered one chip while the list stayed filtered to
  // 209 Switch titles and the only escape was Reset all. Same rule as the
  // "+N more" preview cap — an active filter is always visible.
  const keep = new Set(selected);
  return options.filter((o) => set.has(o.key) || keep.has(o.key));
}

/**
 * Does this item match the selected platforms? OR within the selection, because
 * "I own a Switch and a PS5" means either is fine, not both at once.
 *
 * ⚠️ An item we hold NO availability data for is DROPPED, not kept. Both
 * readings are defensible and this one is deliberate: the question is "what can
 * I watch tonight", and padding the answer with maybes makes the filter useless.
 * The panel says so on screen rather than leaving it to be discovered.
 */
export function matchesPlatforms(
  item: { platforms?: string[] | null; streamingProviders?: { name: string }[] | null },
  selected: string[]
): boolean {
  if (selected.length === 0) return true;
  const keys = availableOnKeys(item);
  if (keys.length === 0) return false;
  return keys.some((k) => selected.includes(k));
}

/**
 * The option list the filter should OFFER: everything loaded, plus every
 * platform the account is known to care about, carrying a 0.
 *
 * ⚠️ This deliberately reverses the "derived from the loaded set" rule the
 * function above states, and Nils's reasoning is the better one: a service that
 * quietly vanishes from the sheet reads as a broken filter, not as an empty
 * shelf. Discover is the case that forced it — its feed is UPCOMING releases,
 * which no provider holds watch data for, so the entire Movies & shows section
 * disappeared and the panel looked like it had lost half its function.
 *
 * A 0 chip is honest and it is information: "we know you have Netflix, nothing
 * here is on it". It stays pressable, because a disabled control explains even
 * less than a missing one, and pressing it says so on screen.
 *
 * Ordering: what is actually here first (by count), then the rest by how much of
 * the account's own catalog sits on them, so the tail behind "+N more" is the
 * tail nobody uses rather than whatever sorts first alphabetically.
 */
export function withKnownPlatforms(
  loaded: PlatformOption[],
  known: PlatformOption[]
): PlatformOption[] {
  const byKey = new Map<string, PlatformOption>();
  for (const o of loaded) byKey.set(o.key, o);
  // The survey's own counts, kept only as a tie-break for the zero rows — never
  // shown, because they answer a different question (the whole library) than
  // the chip does (what is on screen).
  const owned = new Map<string, number>();
  for (const k of known) {
    owned.set(k.key, k.count);
    if (!byKey.has(k.key)) byKey.set(k.key, { ...k, count: 0 });
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.count - a.count ||
      (owned.get(b.key) ?? 0) - (owned.get(a.key) ?? 0) ||
      a.label.localeCompare(b.label)
  );
}
