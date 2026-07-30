// Home's rotating stat highlights (2026-07-30).
//
// Nils: "the stats at the top are cool but it gets redundant if it shows the same
// thing every time. I would prefer a randomized selection of interesting stats or
// even recommendations." Home had exactly one derived stat — `pickBestGenre` —
// pinned to the `genre` category forever, next to three counters.
//
// So: seven GENERATORS, two drawn per day (lib/dailyRotation seeds on the date +
// userId, so a pick is stable while you're looking at it and different tomorrow).
//
// EVERY generator reads data already in memory. No new SQL, no provider call:
//   • the aggregated facets, per-facet best item, and library ids all come from
//     getLibraryFacetAnalysis (one cached analysis per library signature)
//   • the two recommendation generators use discovery.ts's catalog cache via
//     itemsWithFacet() + computeFandexScore(), both pure in-memory
// That's deliberate — a rotating strip that costs a query per variant would make
// Home slower on every load, and Home is already the heaviest page.

import { query } from "@/lib/db";
import type { FacetRole } from "@/lib/facets";
import type { FacetStat, LibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import {
  getLibraryFacetAnalysis, pickBestTag, pickBestByRole, pickMostSeenByRole, pickMostSeenTag,
} from "@/lib/libraryAnalysis";
import { buildProfile, computeFandexScore, itemsWithFacet, MIN_RATED_FOR_FANDEX_SCORE } from "@/lib/discovery";
import type { Profile } from "@/lib/discovery";
import { getTagCategories } from "@/lib/scoringConfig";
import { seedFor, rngFrom } from "@/lib/dailyRotation";
import { buildFacetHref, buildItemHref } from "@/lib/itemUrl";
import { CATEGORY_LABELS } from "@/lib/tags";
import { ROLE_LABELS } from "@/lib/constants";

/** One panel: an eyebrow, the headline value, and a supporting line. */
export interface Highlight {
  /** Stable id for the generator that produced it — used to avoid repeats. */
  kind: string;
  eyebrow: string;
  value: string;
  detail: string;
  href?: string;
  posterUrl?: string | null;
}

/** Don't crown a facet seen on 1-2 items — SM11's lesson, applied everywhere. */
const MIN_TAG_COUNT = 3;
const MIN_PERSON_COUNT = 2;

// Roles worth naming in a highlight. `cast` is excluded from the "highest rated"
// slot on purpose: with prominence weighting a bit-part actor in one 10/10 film
// still outranks a director you've rated 30 times, which reads as nonsense.
const QUALITY_ROLES = ["director", "creator", "writer"];
const VOLUME_ROLES = ["director", "creator", "writer", "cast"];

const singular = (role: string) => (ROLE_LABELS[role] ?? role).replace(/s$/, "");
const categoryLabel = (id: string, live: { id: string; label: string }[]) =>
  live.find((c) => c.id === id)?.label ?? CATEGORY_LABELS[id] ?? id;

// A generator returns null whenever the library can't support it honestly (too
// few ratings, no facet clears the minimum, nothing left to recommend). The
// picker only ever draws from what actually resolved, so a thin library degrades
// to fewer panels rather than to made-up ones.
type Generator = (ctx: Ctx) => Highlight | null;

interface Ctx {
  analysis: LibraryFacetAnalysis;
  profile: Profile;
  /** Tag categories worth highlighting: live list, `meta` and `other` dropped. */
  categories: { id: string; label: string }[];
  rng: () => number;
  /** library ∪ wishlist — what a recommendation must NOT be. */
  known: Set<string>;
}

const pickOne = <T,>(xs: T[], rng: () => number): T | null =>
  xs.length === 0 ? null : xs[Math.floor(rng() * xs.length)];

/**
 * Pick a random option that ACTUALLY RESOLVES, rather than picking blind and
 * giving up.
 *
 * This is load-bearing, not a micro-optimisation. The first version drew one
 * category (or role) at random and returned null if nothing in it cleared the
 * minimum — so with 7 categories and a library whose tags are mostly genres, six
 * of seven draws produced nothing, four of the seven generators had a ~1-in-7
 * hit rate, and the strip routinely rendered empty on a library that could
 * plainly support it. Resolving all the options and choosing among the ones that
 * worked keeps the rotation random where it's visible and reliable where it isn't.
 */
function pickViable<O, R>(options: O[], rng: () => number, resolve: (o: O) => R | null): { option: O; value: R } | null {
  const viable: { option: O; value: R }[] = [];
  for (const option of options) {
    const value = resolve(option);
    if (value != null) viable.push({ option, value });
  }
  return pickOne(viable, rng);
}

const facetHrefOf = (f: { kind: string; role?: string; key: string; label: string }) =>
  buildFacetHref(f as Parameters<typeof buildFacetHref>[0]);

// ── The seven generators ───────────────────────────────────────────

/** "Your top setting — Steampunk" */
const topTagInCategory: Generator = ({ analysis, categories, rng }) => {
  const hit = pickViable(categories, rng, (c) => pickBestTag(analysis.facets, c.id, MIN_TAG_COUNT));
  if (!hit) return null;
  const { option: cat, value: best } = hit;
  return {
    kind: "topTagInCategory",
    eyebrow: `Your top ${cat.label.toLowerCase()}`,
    value: best.label,
    detail: `${best.count} rated · you average ${best.ba.toFixed(1)}`,
    href: facetHrefOf({ kind: "tag", key: best.key, label: best.label }),
  };
};

/** "Your highest rated director — Tim Burton" */
const bestPersonByRole: Generator = ({ analysis, rng }) => {
  const hit = pickViable(QUALITY_ROLES, rng, (r) => pickBestByRole(analysis.facets, "person", r, MIN_PERSON_COUNT));
  if (!hit) return null;
  const { option: role, value: best } = hit;
  return {
    kind: "bestPersonByRole",
    eyebrow: `Your highest rated ${singular(role).toLowerCase()}`,
    value: best.label,
    detail: `${best.count} rated · you average ${best.ba.toFixed(1)}`,
    href: facetHrefOf(best),
  };
};

/** "Your most watched actor — Tom Hanks" */
const mostSeenPersonByRole: Generator = ({ analysis, rng }) => {
  const hit = pickViable(VOLUME_ROLES, rng, (r) => pickMostSeenByRole(analysis.facets, "person", r, MIN_PERSON_COUNT));
  if (!hit) return null;
  const { option: role, value: most } = hit;
  return {
    kind: "mostSeenPersonByRole",
    eyebrow: `Your most watched ${singular(role).toLowerCase()}`,
    value: most.label,
    detail: `${most.count} titles · you average ${most.ba.toFixed(1)}`,
    href: facetHrefOf(most),
  };
};

/** "Your most watched theme — Time travel" */
const mostSeenTagInCategory: Generator = ({ analysis, categories, rng }) => {
  const hit = pickViable(categories, rng, (c) => pickMostSeenTag(analysis.facets, c.id, MIN_TAG_COUNT));
  if (!hit) return null;
  const { option: cat, value: most } = hit;
  return {
    kind: "mostSeenTagInCategory",
    eyebrow: `Your most watched ${cat.label.toLowerCase()}`,
    value: most.label,
    detail: `${most.count} titles · you average ${most.ba.toFixed(1)}`,
    href: facetHrefOf(most),
  };
};

/** "Your best steampunk title — Mortal Engines" */
const bestItemForTag: Generator = ({ analysis, categories, rng }) => {
  // Viable = the category has a qualifying tag AND we know your best item for it.
  const hit = pickViable(categories, rng, (c) => {
    const tag = pickBestTag(analysis.facets, c.id, MIN_TAG_COUNT);
    if (!tag) return null;
    // Tags carry no role, so the facet id is `tag||<key>` (see facets.ts).
    const item = analysis.topItemByFacet.get(`tag||${tag.key}`);
    return item ? { tag, item } : null;
  });
  if (!hit) return null;
  const { tag, item } = hit.value;
  return {
    kind: "bestItemForTag",
    eyebrow: `Your best ${tag.label.toLowerCase()} title`,
    value: item.title,
    detail: `You rated it ${item.rating % 1 === 0 ? item.rating.toFixed(0) : item.rating.toFixed(1)}/10`,
    href: buildItemHref({ id: item.id, type: item.type, title: item.title }),
    posterUrl: item.posterUrl,
  };
};

// ── The two recommendation highlights ──────────────────────────────
// "Because you like Steampunk: Hugo" — the highest Fandex Score item carrying
// that facet that you DON'T already have.
//
// `known` excludes wishlist as well as library: a title you've already saved
// isn't a discovery, and surfacing one as "because you like X" reads as a bug.
function recommendFor(
  ref: { kind: "tag" | "person"; role?: FacetRole; key: string; label: string },
  ctx: Ctx
): { title: string; href: string; score: number; posterUrl: string | null } | null {
  const candidates = itemsWithFacet(ref);
  let best: { title: string; href: string; score: number; posterUrl: string | null } | null = null;
  for (const v of candidates) {
    if (ctx.known.has(v.id)) continue;
    const fx = computeFandexScore(v.facets, ctx.profile);
    if (!fx) continue;
    if (!best || fx.score > best.score) {
      best = {
        title: v.title,
        href: buildItemHref({ id: v.id, type: v.type, title: v.title }),
        score: fx.score,
        posterUrl: v.posterUrl,
      };
    }
  }
  return best;
}

/** "Because you like Steampunk — Hugo" */
const recommendByTag: Generator = (ctx) => {
  const hit = pickViable(ctx.categories, ctx.rng, (c) => {
    const tag = pickBestTag(ctx.analysis.facets, c.id, MIN_TAG_COUNT);
    if (!tag) return null;
    const rec = recommendFor({ kind: "tag", key: tag.key, label: tag.label }, ctx);
    return rec ? { tag, rec } : null;
  });
  if (!hit) return null;
  const { tag, rec } = hit.value;
  return {
    kind: "recommendByTag",
    eyebrow: `Because you like ${tag.label}`,
    value: rec.title,
    detail: `Fandex Score ${Math.round(rec.score)} · not in your library`,
    href: rec.href,
    posterUrl: rec.posterUrl,
  };
};

/** "Because you like Johnny Depp — Sleepy Hollow" */
const recommendByPerson: Generator = (ctx) => {
  const hit = pickViable(VOLUME_ROLES, ctx.rng, (role) => {
    // Most-seen rather than best-rated: a person you've watched a lot has more
    // un-watched catalog left, so the recommendation is likelier to resolve.
    const person: FacetStat | null = pickMostSeenByRole(ctx.analysis.facets, "person", role, MIN_PERSON_COUNT);
    if (!person) return null;
    const rec = recommendFor({ kind: "person", role: person.role, key: person.key, label: person.label }, ctx);
    return rec ? { person, rec } : null;
  });
  if (!hit) return null;
  const { person, rec } = hit.value;
  return {
    kind: "recommendByPerson",
    eyebrow: `Because you like ${person.label}`,
    value: rec.title,
    detail: `Fandex Score ${Math.round(rec.score)} · not in your library`,
    href: rec.href,
    posterUrl: rec.posterUrl,
  };
};

// Order is the tie-break when the rotation has to fall back, so the cheap
// library-stat generators come before the two catalog-scanning ones.
const GENERATORS: Generator[] = [
  topTagInCategory,
  bestPersonByRole,
  mostSeenPersonByRole,
  mostSeenTagInCategory,
  bestItemForTag,
  recommendByTag,
  recommendByPerson,
];

/**
 * `n` highlights for `userId` on `day` ("YYYY-MM-DD"). Deterministic for a given
 * (userId, day): same input, same panels.
 *
 * Never repeats a generator within one call, and tries the remaining generators
 * in a shuffled order until it has `n` — so a library that can't answer (say)
 * "your top mood" silently gets a different panel instead of an empty one.
 */
export function buildHighlights(userId: string, day: string, n = 2): Highlight[] {
  const analysis = getLibraryFacetAnalysis(userId);
  // Below the Fandex Score's own minimum there's no honest taste signal to
  // report — the same gate the score badge uses, so Home can't claim to know
  // your favourite director from two ratings.
  if (analysis.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return [];

  const rng = rngFrom(seedFor("highlights", userId, day));
  const ctx: Ctx = {
    analysis,
    profile: buildProfile(userId),
    // `meta` is ignored noise and `other` is the catch-all — neither makes a
    // sentence anyone wants to read ("your top meta / noise: sequel").
    categories: getTagCategories()
      .filter((c) => c.id !== "meta" && c.id !== "other" && !c.ignored)
      .map((c) => ({ id: c.id, label: categoryLabel(c.id, getTagCategories()) })),
    rng,
    known: new Set([...analysis.libraryIds, ...wishlistIds(userId)]),
  };

  // Shuffle the generator order with the same rng, then take the first `n` that
  // resolve. Weighted picking isn't wanted here — unlike a rail, no highlight is
  // "better" than another, they're just different.
  const order = [...GENERATORS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const out: Highlight[] = [];
  const seenValue = new Set<string>();
  for (const gen of order) {
    if (out.length >= n) break;
    const h = gen(ctx);
    // Two generators can legitimately land on the same headline (your top genre
    // and your most-watched genre are often one tag) — showing it twice, side by
    // side, is worse than showing one panel.
    if (!h || seenValue.has(h.value)) continue;
    seenValue.add(h.value);
    out.push(h);
  }
  return out;
}

// The one query this module runs, and only because `analysis.libraryIds` covers
// the library alone. Cheap: one indexed read of ~100 rows.
function wishlistIds(userId: string): string[] {
  return query<{ media_item_id: string }>(
    "SELECT media_item_id FROM user_watchlist WHERE user_id = ?", [userId]
  ).map((r) => r.media_item_id);
}
