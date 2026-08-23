// P17 — the PUBLIC facet data layer, the crowd half of a facet page.
//
// This is to facetDetail.ts what publicDetail.ts is to enrich.ts: same subject,
// NO per-user data. `buildPublicFacetDetail` takes a facet ref (kind + key) and a
// PERSIST BOOLEAN — never a userId — and returns `PublicFacetPayload`, which by
// construction has no rating / library / you-vs-crowd field. A logged-in
// viewer's personal overlay is layered on top client-side (see the facet
// route's island), exactly like the item page. The boolean, not a userId, is
// deliberate: this module must stay unable to single out which viewer it's
// building for, so a leak here is a compile error, not a discipline problem.
//
// TWO deliberate differences from facetDetail.ts's authed builder:
//   1. The item list is PROVIDER-SOURCED, not `itemsWithFacet` (the Fandex DB).
//      A public page must show a person's FULL filmography / a studio's real
//      catalog / a genre's actual titles, not just what happens to be ingested.
//      So ids resolve by NAME SEARCH against TMDB/RAWG, not by reading a catalog
//      item that carries the facet.
//   2. When `persist` is true, every rendered provider title is written thin
//      (browsed=1) via persistDiscoverItems, so it gets a uuid and links to its
//      item page — the same H2b path /discover uses. Titles we can't persist
//      (or aren't persisting for) stay non-linkable; the page already renders
//      that gracefully (`linkable: false`).
//
//      PR14 (2026-07-22): persisting used to be unconditional. Every crawler
//      walk of a public facet page (60 titles/page) minted that many
//      `media_items` rows, and with no cap on crawl depth the pool grew to
//      ~676k rows against a library of under 2,000 — the root cause of the
//      2026-07-22 memory/cost incident (see docs/archive/history.md and the
//      `prod-db-size-and-page-cache` memory note). Callers now pass
//      `persist: true` only for a viewer with a real session; anonymous
//      visitors and crawlers get the same payload shape with no new writes.

import type { MediaType } from "@/types";
import type { LinkableFacetKind } from "@/lib/facetUrl";
import { personKey } from "@/lib/facets";
import { slugsForItemIds } from "@/lib/itemSlug";
import type { PersonMeta, FacetScope } from "@/lib/facetDetail";
import { tmdbJson, fetchPersonMeta, resolveTmdbCompanyId } from "@/lib/facetDetail";
import { tmdbGenreId, resolveTmdbKeywordId } from "@/lib/sources/tagDiscover";
import { discoverIgdbByTag, igdbImageUrl, igdbReleaseDate, igdbConfigured } from "@/lib/sources/igdb";
import { normalizeName, extractYear } from "@/lib/merge";
import type { PersistableItem } from "@/lib/discoverPersist";
import { persistDiscoverItems, lookupExistingUuids } from "@/lib/discoverPersist";
import { readFacetCache, writeFacetCache } from "@/lib/facetCacheStore";
import { getTagVocab, getCompanyVocab } from "@/lib/discovery";
import { getTagCategories, getTagCategoryOverrides, scoringConfigSignature } from "@/lib/scoringConfig";
import { categorizeTag } from "@/lib/tags";
import { canonicalTagKey, listTagBundles } from "@/lib/tagAlias";
import { bayesRating, NEUTRAL_PRIOR } from "@/lib/ratingsSort";
import { sharedCache } from "@/lib/boundedCache";
import { log, errorFields } from "@/lib/logger";

export type FacetSort = "popular" | "newest" | "rating";
export const FACET_SORTS: FacetSort[] = ["popular", "newest", "rating"];
export function isFacetSort(s: string | null | undefined): s is FacetSort {
  return !!s && (FACET_SORTS as string[]).includes(s);
}

export const FACET_PAGE_SIZE = 60;

// ── SEO: the index threshold for a public facet page ────────────────────────
//
// A facet page listing one or two titles says nothing the item pages it points
// at don't already say, so it competes with them for the same query while
// carrying less. Measured on prod 2026-08-20: those pages render ~33 KB, which
// is the empty-shell size, while a real one runs 90–260 KB.
//
// ⚠️ The threshold is POOL SIZE, not how many titles are LINKABLE, and the
// difference matters. `/person/angelina-jolie` renders a full filmography with
// posters, roles and ratings — 175 KB — and links exactly 2 of them, because
// `linkable` is true only for titles a logged-in visitor's page view happened
// to persist (PR14 gates the write on a real session). That page is
// under-linked, which is a crawl-graph problem; it is not thin, and noindexing
// it would delete a genuinely useful page over an unrelated defect.
//
// `follow` stays TRUE. The page's few outbound item links are the only reason
// the crawler is on it, and nofollow would throw them away along with the page.
export const MIN_INDEXABLE_TITLES = 3;

// The robots directive for a facet page, or undefined to leave the default
// (index, follow) in place. `itemsIndexable` is PUBLIC_ITEMS_INDEXABLE, passed
// in rather than imported so this stays a pure function the tests can drive.
export function facetRobots(
  total: number,
  itemsIndexable: boolean
): { index: boolean; follow: boolean } | undefined {
  // Soft launch beats everything: nothing public is indexed at all.
  if (!itemsIndexable) return { index: false, follow: false };
  if (total < MIN_INDEXABLE_TITLES) return { index: false, follow: true };
  return undefined;
}

// One title on a public facet page. NO per-user field exists on this type — that
// is the leak boundary (asserted in publicFacetDetail.test.ts). `id` is a media
// uuid when the title was persisted (then `linkable` is true and it links to
// /{type}/{id}/{slug}); otherwise a synthetic provider key that renders but does
// not link.
export interface PublicFacetItem {
  id: string;
  /** Public url address segment; see publicUrl.ts. */
  slug?: string | null;
  linkable: boolean;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  communityScore: number | null; // 0-100
  roles: string[];               // person only: ["Director","Writer"] / ["Actor"]
  // Q14 (2026-07-19): the provider source id backing this title — needed so the
  // shared card's quick-action bar (rate/watched/wishlist) resolves to the SAME
  // already-persisted thin row (persistDiscoverItems, above) instead of
  // upsertMediaItem creating a second row for it (the thin-write/pool invariant:
  // a discover-time write is insert-only, so a rating write must MATCH, not
  // duplicate). Absent (empty array) for a non-linkable item, which has no row.
  sources: { source: string; sourceId: string }[];
}

export interface PublicFacetPayload {
  // A public facet page exists for exactly the three LINKABLE kinds — the route
  // only ever resolves one from a /person|/tag|/studio prefix, and `ip` has no
  // public page at all (see facetUrl.ts).
  kind: LinkableFacetKind;
  key: string;
  label: string;                 // display label recovered from the provider
  person: PersonMeta | null;     // people only — public bio/age/photo
  scope: FacetScope;
  nameCollision: boolean;        // Q12: person only — key matched >1 distinct TMDB person
  community: { avg: number | null; count: number }; // crowd avg on a 0-10 scale
  items: PublicFacetItem[];
  total: number;                 // size of the resolved pool (for "N titles")
  page: number;                  // 0-based
  hasMore: boolean;
  sort: FacetSort;
  // Q18 (2026-07-19) — tag pages only (null for person/studio): category +
  // bundle membership (both DB-backed, taxonomy-editor-editable) and a
  // Bayesian-damped crowd average alongside the plain `community.avg`.
  tagCategory: { id: string; label: string; color: string } | null;
  tagBundle: { canonical: string; members: string[] } | null;
  bayesCommunityAvg: number | null;
}

// Internal pooled title (carries raw for persistence + votes for the crowd avg).
// Exported for unit tests of the pure pool logic (role-merge / sort / crowd avg).
export interface PoolTitle {
  source: "tmdb" | "rawg" | "igdb";
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  vote: number | null;  // 0-10
  votes: number;
  roles: string[];
  raw: any;             // provider payload, stored thin
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Title-case a normalized key for a fallback display label ("naughty dog" →
// "Naughty Dog"). The provider name overrides this whenever we resolve one.
function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function tmdbTitle(c: any, mediaHint?: "movie" | "tv", roles: string[] = []): PoolTitle {
  const media = (c.media_type ?? mediaHint) === "tv" ? "show" : "movie";
  return {
    source: "tmdb", sourceId: String(c.id), type: media as MediaType,
    title: c.title || c.name || "Untitled",
    releaseDate: c.release_date || c.first_air_date || null,
    posterUrl: c.poster_path ? `https://image.tmdb.org/t/p/w500${c.poster_path}` : null,
    vote: typeof c.vote_average === "number" && c.vote_average > 0 ? c.vote_average : null,
    votes: c.vote_count ?? 0,
    roles,
    raw: c,
  };
}

function igdbTitle(g: any, roles: string[] = []): PoolTitle {
  return {
    source: "igdb", sourceId: String(g.id), type: "game",
    title: g.name || "Untitled",
    releaseDate: igdbReleaseDate(g),
    posterUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big"),
    vote: typeof g.total_rating === "number" && g.total_rating > 0 ? g.total_rating / 10 : null, // 0-100 → 0-10
    votes: g.total_rating_count ?? 0,
    roles,
    raw: g,
  };
}

// ── PERSON ────────────────────────────────────────────────────────────────────
const CAST_SELF_RE = /^(self|himself|herself|narrator)\b/i;

// Resolve a person key to a TMDB id by SEARCH (not by reading a catalog item, so
// it works for people not in the Fandex DB). Name collisions resolve to the most
// popular exact-key match, else the most popular result overall. `ambiguous` is
// true when more than one distinct person shares the exact key (Q12) — the
// caller surfaces this so a wrong guess ("which Tom?") is obvious, not silent.
interface PersonResolution { id: number | null; ambiguous: boolean }
const _personSearchCache = sharedCache<string, PersonResolution>("publicFacet.personSearch", { max: 5000 });
async function searchPersonId(key: string): Promise<PersonResolution> {
  if (_personSearchCache.has(key)) return _personSearchCache.get(key)!;
  const d = await tmdbJson(`/search/person?query=${encodeURIComponent(key)}&include_adult=false`);
  const results: any[] = d?.results ?? [];
  const byPop = (a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0);
  const exact = results.filter((r) => personKey(r.name ?? "") === key).sort(byPop);
  const id: number | null = (exact[0] ?? [...results].sort(byPop)[0])?.id ?? null;
  const resolution: PersonResolution = { id, ambiguous: exact.length > 1 };
  _personSearchCache.set(key, resolution);
  return resolution;
}

// Q10: TMDB crew jobs that name a courtesy/thanks credit, not real creative
// involvement — they'd otherwise show up as a role badge next to real ones
// like "Director"/"Writer".
const LOW_SIGNAL_CREW_JOBS = new Set(["Thanks", "Special Thanks", "Characters"]);

// Merge a person's whole body of work from combined_credits, deduped by title,
// each carrying every role they held on it ("Director", "Writer", "Actor", …).
export function personPool(credits: any): PoolTitle[] {
  const byKey = new Map<string, PoolTitle>();
  const add = (c: any, role: string) => {
    if (!(c.media_type === "movie" || c.media_type === "tv") || c.id == null) return;
    if ((c.vote_count ?? 0) === 0 && !c.poster_path) return; // cut noise
    const t = tmdbTitle(c);
    const k = `${t.type}:${t.sourceId}`;
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      t.roles = [role];
      byKey.set(k, t);
    }
  };
  for (const c of credits?.cast ?? []) {
    if (CAST_SELF_RE.test(String(c.character ?? ""))) continue;
    add(c, "Actor");
  }
  for (const c of credits?.crew ?? []) {
    const job = c.job || c.department || "Crew";
    if (LOW_SIGNAL_CREW_JOBS.has(job)) continue;
    add(c, job);
  }
  // Present Director/Writer first in each title's role list.
  const RANK = ["Director", "Writer", "Screenplay", "Story", "Creator", "Producer", "Actor"];
  for (const t of byKey.values()) {
    t.roles.sort((a, b) => {
      const ia = RANK.indexOf(a), ib = RANK.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }
  return [...byKey.values()];
}

// ── STUDIO (all company roles fold here) ────────────────────────────────────────
const COMPANY_TMDB_PAGES = [1, 2];
async function tmdbCompanyPool(companyId: number): Promise<PoolTitle[]> {
  const reqs: { media: "movie" | "tv"; path: string }[] = [];
  for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const) {
    for (const sort of ["popularity.desc", recency]) {
      for (const page of COMPANY_TMDB_PAGES) {
        reqs.push({ media, path: `/discover/${media}?with_companies=${companyId}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}` });
      }
    }
  }
  const batches = await Promise.all(reqs.map(async (r) => ({ media: r.media, d: await tmdbJson(r.path) })));
  const seen = new Set<string>();
  const out: PoolTitle[] = [];
  for (const { media, d } of batches) {
    for (const m of d?.results ?? []) {
      const t = tmdbTitle({ ...m, media_type: media });
      const k = `${t.type}:${t.sourceId}`;
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }
  return out;
}

// ── TAG ─────────────────────────────────────────────────────────────────────
// A genre/keyword is effectively unbounded, so we build a bounded, sorted pool
// (a few provider pages blended across popularity + recency) and paginate within
// it. Deeper-than-the-pool pagination is a documented follow-up.
const TAG_POOL_PAGES = [1, 2];
async function tagPool(key: string): Promise<PoolTitle[]> {
  const seen = new Set<string>();
  const out: PoolTitle[] = [];
  const pushTmdb = (media: "movie" | "tv", results: any[] | undefined) => {
    for (const m of results ?? []) { const t = tmdbTitle({ ...m, media_type: media }); const k = `${t.type}:${t.sourceId}`; if (!seen.has(k)) { seen.add(k); out.push(t); } }
  };
  const reqs: Promise<void>[] = [];
  const movieGid = tmdbGenreId(key, "movie");
  const tvGid = tmdbGenreId(key, "show");
  if (movieGid != null || tvGid != null) {
    if (movieGid != null) for (const sort of ["popularity.desc", "primary_release_date.desc"]) for (const page of TAG_POOL_PAGES)
      reqs.push(tmdbJson(`/discover/movie?with_genres=${movieGid}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}`).then((d) => pushTmdb("movie", d?.results)));
    if (tvGid != null) for (const sort of ["popularity.desc", "first_air_date.desc"]) for (const page of TAG_POOL_PAGES)
      reqs.push(tmdbJson(`/discover/tv?with_genres=${tvGid}&sort_by=${sort}&vote_count.gte=10&page=${page}`).then((d) => pushTmdb("tv", d?.results)));
  } else {
    const kwId = await resolveTmdbKeywordId(key);
    if (kwId) for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const)
      for (const sort of ["popularity.desc", recency]) for (const page of TAG_POOL_PAGES)
        reqs.push(tmdbJson(`/discover/${media}?with_keywords=${kwId}&sort_by=${sort}&vote_count.gte=10&page=${page}`).then((d) => pushTmdb(media, d?.results)));
  }
  // PL3 (2026-08-23): the RAWG tag pool is gone. This is the crawlable surface,
  // and a crawler walking the facet long tail is what actually spent RAWG's
  // 20,000/month quota. IGDB and Steam cover games here.

  // Q27 (2026-07-19): IGDB alongside RAWG on the public tag page too — see
  // facetDetail.ts's tagTitles for the same wiring + the reason it's a
  // separate settle-then-dedupe pass instead of pushing straight into `out`.
  //
  // ⚠️ CACHED SEPARATELY, AND ON A MUCH LONGER TTL THAN THE PAGE (2026-08-23).
  // This ONE call was **93% of a cold tag page**. Measured that day: a cold
  // `/tag/*` render took 5.2 s, of which the nine TMDB calls above were ~0.35 s
  // (150 ms each, and they run in parallel), RAWG was 0 (latched off), and the
  // IGDB query alone took **4.3–4.7 s**, repeatably. It is the wildcard-contains
  // scan over themes/keywords/genres in discoverIgdbByTags — expensive on IGDB's
  // side, not ours, and nothing here can make it fast.
  //
  // Because it sits in the same `Promise.all` as the cheap calls, it gates the
  // whole page: every other source was finished in under half a second and the
  // render still waited four more.
  //
  // The budget does not help. It already passes BROWSE_BUDGET_MS (8 s), and a
  // 4.5 s call never trips an 8 s budget — it just spends it. Tightening the
  // budget instead of caching would be actively wrong right now: RAWG's monthly
  // quota is exhausted, so **IGDB is the only games source left**, and a page
  // that drops it shows no games at all. That is the two-source-medium invariant
  // (AGENTS.md) pointing the other way for once.
  //
  // So: cache the RESULT on its own key, for 7 days. The page cache above has a
  // 24 h TTL and a 12,000-row cap that a crawler churns through, so a page-cache
  // miss is common and used to re-pay the full 4.5 s. Now it re-pays it once a
  // week per tag. Same store and same TTL as the similar-rail provider top-up,
  // which is cached for exactly this reason.
  //
  // An empty result IS cached, deliberately: a tag IGDB genuinely knows no games
  // for must not re-ask on every cold render. That is safe here in a way it is
  // not in discoverFeed.ts, because `discoverIgdbByTags` already try/catches to
  // `[]` — so this cache cannot distinguish "no games" from "call failed", and
  // caching a failure for 7 days would be a real regression. It is bounded by
  // the fact that the alternative is re-paying 4.5 s on every crawler hit; if
  // games start vanishing from tag pages, THIS is the first thing to suspect.
  const IGDB_TAG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  let igdbGames: any[] = [];
  if (igdbConfigured()) {
    const igdbKey = `igdbtag:v1:${key}`;
    const cached = readFacetCache(igdbKey, IGDB_TAG_TTL_MS);
    if (cached) {
      try { igdbGames = JSON.parse(cached) as any[]; } catch { igdbGames = []; }
    } else {
      reqs.push(discoverIgdbByTag(key, 40).then((results) => {
        igdbGames = results;
        try { writeFacetCache(igdbKey, JSON.stringify(results)); } catch { /* cache is best-effort */ }
      }));
    }
  }

  await Promise.all(reqs);

  // The title+year set still guards IGDB against whatever else landed in the
  // pool, which after PL3 is Steam rather than RAWG. Keeping the guard rather
  // than deleting it: the sources still use independent id spaces, so title+year
  // remains the only key that spans them.
  const settledTitleYears = new Set(
    out.map((t) => `${normalizeName(t.title)}|${extractYear(t.releaseDate) ?? "?"}`)
  );
  for (const g of igdbGames) {
    // Prefixed deliberately: provider id spaces are independent, so an
    // unprefixed numeric key could collide across sources.
    const k = `game:igdb:${g.id}`;
    if (seen.has(k)) continue;
    const dupeKey = `${normalizeName(g.name ?? "")}|${extractYear(igdbReleaseDate(g)) ?? "?"}`;
    if (settledTitleYears.has(dupeKey)) continue;
    seen.add(k);
    out.push(igdbTitle(g));
  }
  return out;
}

// ── Sort + assemble ───────────────────────────────────────────────────────────

// SM3 — "Highest rated" orders by a Bayesian-damped score, not the raw average:
// an obscure credit with a handful of 9+ votes must not outrank a classic with
// thousands (IMDb-style). score = (v·R + m·C)/(v + m), where C is this pool's
// own crowd average (so the prior adapts to the facet) and m is the prior's
// vote weight. Titles without a rating sort last. The DISPLAYED score stays the
// raw average — only the ordering is damped.
const BAYES_PRIOR_VOTES = 50;
export function bayesScore(t: PoolTitle, prior: number): number {
  if (t.vote == null) return -1;
  return (t.votes * t.vote + BAYES_PRIOR_VOTES * prior) / (t.votes + BAYES_PRIOR_VOTES);
}

// Q23 (2026-07-19) — "Most popular" ranked by RAW vote count buried games
// pages deep: TMDB blockbusters carry tens of thousands of votes vs RAWG/IGDB's
// hundreds, so a facet's games never reached the front page regardless of how
// popular they are within games specifically. Rank each title within its OWN
// source's vote scale (0 = most popular title from that source, 1 = least),
// then sort by that rank — comparable across sources even though the raw vote
// counts aren't. "Highest rated" doesn't need this: Bayesian damping already
// operates on the shared 0-10 rating scale, not a source-specific vote count.
function popularityRanks(pool: PoolTitle[]): Map<PoolTitle, number> {
  const bySource = new Map<string, PoolTitle[]>();
  for (const t of pool) {
    const arr = bySource.get(t.source) ?? [];
    arr.push(t);
    bySource.set(t.source, arr);
  }
  const rank = new Map<PoolTitle, number>();
  for (const arr of bySource.values()) {
    const sorted = [...arr].sort((a, b) => b.votes - a.votes);
    sorted.forEach((t, i) => rank.set(t, i / Math.max(1, sorted.length - 1)));
  }
  return rank;
}

export function sortPool(pool: PoolTitle[], sort: FacetSort): PoolTitle[] {
  // Prior from WELL-VOTED titles only (no crowdAvg small-pool fallback — that
  // would let the very low-vote outliers we're damping pull the prior toward
  // themselves). Neutral 6.5 when nothing qualifies.
  const minVotes = (t: PoolTitle) => (t.source === "rawg" ? 5 : 10);
  const voted = pool.filter((t) => t.vote != null && t.votes >= minVotes(t));
  const prior = voted.length ? voted.reduce((s, t) => s + (t.vote as number), 0) / voted.length : 6.5;

  if (sort === "popular") {
    const rank = popularityRanks(pool);
    return [...pool].sort((a, b) => (rank.get(a) ?? 1) - (rank.get(b) ?? 1) || b.votes - a.votes);
  }
  const cmp: Record<Exclude<FacetSort, "popular">, (a: PoolTitle, b: PoolTitle) => number> = {
    newest: (a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
    rating: (a, b) => bayesScore(b, prior) - bayesScore(a, prior) || b.votes - a.votes,
  };
  return [...pool].sort(cmp[sort]);
}

// Crowd average (0-10) over the well-voted titles in the pool.
export function crowdAvg(pool: PoolTitle[]): { avg: number | null; count: number } {
  const minVotes = (t: PoolTitle) => (t.source === "rawg" ? 5 : 10);
  let voted = pool.filter((t) => t.vote != null && t.votes >= minVotes(t));
  if (voted.length < 3) voted = pool.filter((t) => t.vote != null && t.votes > 0);
  return { avg: mean(voted.map((t) => t.vote as number)) != null ? round1(mean(voted.map((t) => t.vote as number))!) : null, count: voted.length };
}

export interface PublicFacetRef { kind: LinkableFacetKind; key: string; label?: string | null }

// Cross-request cache for the built facet payload (2026-07-20): every facet
// GET fans out to providers (studio = up to 8 TMDB discover calls; tag = TMDB +
// RAWG + IGDB), and crawlers re-visit these pages constantly. The payload is
// pure catalog/provider data — this module never takes a userId — so sharing
// it across viewers can't leak anything; the personal overlay is client-side.
// scoringConfigSignature is folded into the key so an admin edit (tag category,
// bundle — Q18) shows up on the public page immediately instead of after TTL.
//
// PR14: `persist` MUST be part of this key too. It changes which items are
// `linkable` in the payload, so without it the first build after a deploy
// picks a winner at random — an anon-built (all non-linkable) payload can get
// cached and served back to a logged-in viewer, or vice versa, until the TTL
// clears. Same shape of bug the scoringConfigSignature line above already
// guards against, just for a different input.
//
// ── SIZING (2026-08-12) — do not raise either number without re-measuring ────
// Why it matters: measured COLD on prod, `/tag/telepathy` took 59.2 s (07-08)
// and 59.8 s (08-12) to render, `/tag/action` ~12-14 s, warm repeats 0.13-0.22 s.
// `openProviderCircuits` was `{}` throughout, so that is genuine fan-out cost,
// not a dead provider. All three facet routes are `force-dynamic`, robots.txt
// allows /person/ /tag/ /studio/, and the slug surface (every person credited
// across ~2,000 titles) is far larger than any cache we can afford — so a crawl
// sweep runs at a near-100% miss rate. That is a compute AND a third-party
// QUOTA exposure: RAWG's free tier is 20k req/mo.
//
// TTL 1 h -> 24 h. This is the bigger share of the win and costs ZERO extra
// bytes. Safe because scoringConfigSignature() is already folded into the key,
// so an admin tag/bundle edit still busts it immediately rather than waiting
// out the TTL. The cost is that provider-sourced pool data on a public page can
// be up to 24 h stale, which is the right trade for an SEO surface.
//
// max 500 -> 3000, against a ~150 MB budget:
//   Measured `JSON.stringify(payload).length` over 17 real prod payloads via
//   GET /api/facet (6 person, 6 tag, 5 studio): min 1,533 B (studio/naughty dog),
//   median ~14,151 B, p95/max 19,385 B (person/steven spielberg). Tag and studio
//   payloads cluster tightly at ~14 KB because FACET_PAGE_SIZE caps them at 60
//   items; person payloads run larger (bio + longer filmography).
//   BoundedCache bounds ENTRY COUNT, not bytes — that is why this is deliberately
//   not the 5000 the small-value caches beside it use. JSON length also
//   UNDERSTATES live heap (property names, boxed numbers, string headers), so
//   budget against retained size, not the wire form: at a conservative 2.5x,
//   150,000,000 / (19,385 * 2.5) = 3,094 -> 3,000.
//   Headroom check: 3,000 * 19,385 * 2.5 ~= 145 MB against the Dockerfile's
//   --max-old-space-size=1536. The 2026-07-22 memory ramp is why a ceiling
//   exists at all; a blind 500->5000 could have added several hundred MB.
//   Note the key includes page + sort + persist, so one facet can occupy several
//   entries — 3,000 entries is fewer than 3,000 distinct facets.
const FACET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const _facetPageCache = sharedCache<string, PublicFacetPayload>("publicFacet.page", { max: 3000, ttlMs: FACET_CACHE_TTL_MS });

// ── L2: the SAME cache, persisted (2026-08-13) ──────────────────────────────
// L1 above dies with the process and is bounded by heap; the slug surface is far
// larger than 3,000 entries, so a crawl sweep misses it almost every time and a
// restart throws away everything. L2 (`facet_page_cache` in SQLite) fixes both.
//
// WHAT THE MEASUREMENT ACTUALLY SAID (scripts/probe-facet-cost.ts, 2026-08-13) —
// this corrects the number that motivated the work. Cold, real local DB:
//   tag/telepathy   total 60,259ms   fan-out 99%   local  643ms   23 calls
//   person/c.nolan  total     64ms   fan-out 96%   local    3ms    3 calls
//   company/a24     total    159ms   fan-out 98%   local    3ms   14 calls
// Fan-out dominates every kind — but of tag's 250,746ms of provider WORK,
// 234,409ms (93%) was 12 calls to api.rawg.io returning Cloudflare 522s at
// ~19.5s each, with its breaker open. TMDB's 9 calls totalled 726ms. So
// "/tag/telepathy renders in 59.8s" is a DEAD PROVIDER, not inherent cost, and
// person/company pages are already fast cold. Do not re-justify this cache with
// the 60s figure; that is the mistake AGENTS.md records twice (perf §A, and the
// 58s Discover load blamed on the pool cache for days).
//
// The justification that survives measurement is THIRD-PARTY QUOTA: one tag
// build can spend 12 RAWG calls against a 20k req/mo free tier, and a crawl
// sweep over the long tail is what burns it. Latency insulation is a bonus.
//
// Both layers share one key, so `persist` and scoringConfigSignature() guard L2
// exactly as they guard L1 (PR14). L2 stores the serialized payload; a parse
// failure is treated as a miss rather than an error.
/**
 * Clear L1 only, leaving the persisted L2 intact — the shape of a process
 * restart. Test seam: without it there is no way to assert the thing this
 * change exists for, since L1 would answer every second request.
 */
export function _resetFacetPageCacheForTests(): void {
  _facetPageCache.clear();
}

function readFacetL2(cacheKey: string): PublicFacetPayload | null {
  const raw = readFacetCache(cacheKey, FACET_CACHE_TTL_MS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublicFacetPayload;
  } catch {
    return null;
  }
}

// Build the public payload for one facet page. Provider-sourced; persisted
// thin for linkability ONLY when `persist` is true (PR14 — see the module
// header). Returns null only when the kind is unknown.
export async function buildPublicFacetDetail(
  ref: PublicFacetRef,
  opts: { page?: number; sort?: FacetSort; persist?: boolean } = {}
): Promise<PublicFacetPayload | null> {
  const page = Math.max(0, opts.page ?? 0);
  const sort = opts.sort ?? "popular";
  const persist = opts.persist ?? false;
  // `v2` because the payload SHAPE changed on 2026-08-21 (items gained `slug`).
  // The L2 cache is persisted with a 24 h TTL, so without a version bump every
  // already-cached facet page would keep serving slug-less items for a day, and
  // each of their cards would link through the legacy uuid url and its 308.
  // Bump this whenever a field is added to the payload.
  const cacheKey = `v2:${ref.kind}:${ref.key}:${page}:${sort}:${persist ? "persist" : "nopersist"}:${scoringConfigSignature()}`;
  const cachedPayload = _facetPageCache.get(cacheKey);
  if (cachedPayload) return cachedPayload;
  // L2 before the fan-out. A hit re-populates L1 so the next request on this
  // process skips the DB read too.
  const persisted = readFacetL2(cacheKey);
  if (persisted) {
    _facetPageCache.set(cacheKey, persisted);
    return persisted;
  }
  const key = ref.key;
  let pool: PoolTitle[] = [];
  let person: PersonMeta | null = null;
  // Q11: titleCase(key) can't recover a lost hyphen ("sci fi" -> "Sci Fi", not
  // "Sci-Fi") because tagKey() deliberately collapses hyphens/spaces into one
  // form. Prefer the real first-seen catalog casing (catalog-wide, no per-user
  // data) when this tag has appeared in the library; it's the only place the
  // original spelling survives.
  let label = ref.label
    || (ref.kind === "tag" ? getTagVocab().find((v) => v.key === key)?.label : undefined)
    || (ref.kind === "company" ? getCompanyVocab().find((v) => v.key === key)?.label : undefined)
    || titleCase(key);
  let scope: FacetScope = "catalog";
  let nameCollision = false;
  let buildFailed = false;

  try {
    if (ref.kind === "person") {
      const { id, ambiguous } = await searchPersonId(key);
      nameCollision = ambiguous;
      if (id != null) {
        const [meta, credits] = await Promise.all([fetchPersonMeta(id), tmdbJson(`/person/${id}/combined_credits`)]);
        person = meta;
        if (meta?.name) label = meta.name;
        if (credits) { pool = personPool(credits); scope = "filmography"; }
      }
    } else if (ref.kind === "company") {
      // Q25: search providers with the recovered LABEL ("Focus Entertainment"),
      // never the lossy key ("focus") — companyKey() strips trailing legal/role
      // tokens, so searching with the bare key can match an entirely different
      // company (e.g. "focus" -> Focus Features on TMDB, not Focus Entertainment).
      // PL3: the RAWG developer/publisher pool is gone. A game company now
      // serves from TMDB (where it has a studio entry) plus the local catalog,
      // which already carries dev/pub facets from IGDB and Steam.
      const tmdbId = await resolveTmdbCompanyId(label);
      pool = tmdbId != null ? await tmdbCompanyPool(tmdbId) : [];
      if (pool.length) scope = "sample";
    } else {
      pool = await tagPool(key);
      if (pool.length) scope = "sample";
    }
  } catch (e) {
    log.error("public_facet_build_failed", { kind: ref.kind, key, ...errorFields(e) });
    // fall through with whatever pool we have (possibly empty)
    buildFailed = true;
  }

  const sorted = sortPool(pool, sort);
  const community = crowdAvg(sorted);

  // Persist the page's slice thin so each title links to its item page — but
  // ONLY for a real session (PR14). An anon/crawler build never WRITES.
  //
  // It does still RESOLVE: `lookupExistingUuids` is a plain SELECT, so a title
  // some logged-in viewer already persisted links normally for anonymous
  // visitors too. This branch used to be a flat "write or don't" — chosen so
  // "zero writes for an anon build" was trivially verifiable — but the cost was
  // that EVERY card on the logged-out surface rendered inert (SM38, 2026-08-12):
  // 0 clickable items against 2,012 real rows, so anon visitors could not open
  // anything and crawlers dead-ended on every facet page. The zero-write
  // guarantee is unchanged and still asserted in publicFacetDetail.test.ts —
  // it just no longer costs the whole public link graph.
  const start = page * FACET_PAGE_SIZE;
  const slice = sorted.slice(start, start + FACET_PAGE_SIZE);
  const persistable: PersistableItem[] = slice
    .filter((t) => t.raw && t.title)
    .map((t) => ({
      id: `${t.source}:${t.sourceId}`,
      type: t.type, title: t.title, releaseDate: t.releaseDate,
      raw: { source: t.source as any, sourceId: t.sourceId, data: t.raw },
    }));
  const uuidByKey = persist
    ? persistDiscoverItems(persistable)
    : lookupExistingUuids(persistable);

  const slugs = slugsForItemIds([...uuidByKey.values()]);
  const items: PublicFacetItem[] = slice.map((t) => {
    const uuid = uuidByKey.get(`${t.source}:${t.sourceId}`);
    return {
      id: uuid ?? `${t.source}-${t.type}-${t.sourceId}`,
      slug: uuid ? slugs.get(uuid) ?? null : null,
      linkable: uuid != null,
      type: t.type,
      title: t.title,
      releaseDate: t.releaseDate,
      posterUrl: t.posterUrl,
      communityScore: t.vote != null ? Math.round(t.vote * 10) : null,
      roles: t.roles,
      sources: uuid != null ? [{ source: t.source, sourceId: t.sourceId }] : [],
    };
  });

  // Q18 — tag-only extras. `key` arrives already-canonical (facetSsr.tsx
  // resolves a member spelling before calling in, per H5.6), so a direct
  // bundle lookup by canonical suffices — no extra resolution needed here.
  let tagCategory: PublicFacetPayload["tagCategory"] = null;
  let tagBundle: PublicFacetPayload["tagBundle"] = null;
  let bayesCommunityAvg: number | null = null;
  if (ref.kind === "tag") {
    const categoryId = getTagCategoryOverrides().get(key) ?? categorizeTag(key);
    const cat = getTagCategories().find((c) => c.id === categoryId);
    if (cat) tagCategory = { id: cat.id, label: cat.label, color: cat.color };
    const bundle = listTagBundles().find((b) => b.canonical === canonicalTagKey(key));
    if (bundle) tagBundle = bundle;
    if (community.avg != null) {
      const minVotes = (t: PoolTitle) => (t.source === "rawg" ? 5 : 10);
      const voted = sorted.filter((t) => t.vote != null && t.votes >= minVotes(t));
      const totalVotes = voted.reduce((s, t) => s + t.votes, 0);
      bayesCommunityAvg = Math.round(bayesRating(community.avg, totalVotes, NEUTRAL_PRIOR) * 10) / 10;
    }
  }

  const payload: PublicFacetPayload = {
    kind: ref.kind, key, label, person, scope, community, nameCollision,
    items, total: sorted.length, page,
    hasMore: start + FACET_PAGE_SIZE < sorted.length,
    sort, tagCategory, tagBundle, bayesCommunityAvg,
  };
  // A payload degraded by a provider failure must not be pinned for the TTL —
  // the next request should retry the fan-out instead. This matters more for L2
  // than L1: a restart clears L1, but a persisted failure would outlive it.
  if (!buildFailed) {
    _facetPageCache.set(cacheKey, payload);
    writeFacetCache(cacheKey, JSON.stringify(payload));
  }
  return payload;
}
