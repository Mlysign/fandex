// Personalized discover browse — the engine that replaces the global-popularity
// default feed. It pulls a WIDE pool of upcoming releases, taste-ranks them with
// the SAME facet model the catalog "Best match" sort uses (discovery.ts), and
// returns the most relevant set for the client to date-sort into its timeline.
//
// Two-stage (B2): a cheap genre/language pre-score picks which movie/show
// candidates are worth hydrating; the hydrated ones get full-facet scoring
// (people, keywords, studios). Games are scored from their list genres/tags only
// (RAWG detail costs 4 sub-requests each — not worth it for a browse feed).
//
// Signals: the user's rated taste profile + a LIBRARY/WISHLIST membership prior
// (so an unrated-but-owned/wishlisted genre still counts, and a fresh account
// with only a wishlist still gets a feed) + a gentle original-language affinity
// and a crowd-vote floor.

import { BoundedCache } from "@/lib/boundedCache";
import type { Reason, Profile } from "@/lib/discovery";
import { buildProfile, scoreFacets, computeFandexScore, getCatalogIdf, getCatalogFacets, ROLE_WEIGHT } from "@/lib/discovery";
import { getMembershipSignal } from "@/lib/libraryAnalysis";
import { resolveMediaIdsBySource } from "@/lib/userState";
import { loadLinks } from "@/lib/detail/enrich";
import type { Facet } from "@/lib/facets";
import { extractFacets, tagKey } from "@/lib/facets";
import { mergeLinks, normalizeName, extractYear } from "@/lib/merge";
import { METADATA } from "@/lib/metadata/registry";
import type {
  FeedCandidate, RawPayload} from "@/lib/discoverFeed";
import { fetchGamePage, fetchMoviePage, fetchShowPage, fetchPages,
  fetchIgdbGamePage, fetchTraktMoviePage, fetchTraktShowPage, dedupeGames,
} from "@/lib/discoverFeed";
import type { MediaLink, MediaType } from "@/types";

// ── Tunables ───────────────────────────────────────────────────────
const PAGES_PER_SOURCE = 5;   // wide pull: ~200 candidates per type before ranking
const HYDRATE_KEEP = 24;      // movie/show candidates to hydrate (TMDB = 1 req each)
const FINAL_KEEP = 18;        // items kept per type for the merged feed
const HYDRATE_CONCURRENCY = 8;

const LIB_PRIOR = 0.6;        // an unrated library facet's positive prior (per item, shrunk)
const WISH_PRIOR = 0.9;      // wishlist = forward-looking intent → weighed higher
const K_MEMBER = 3;          // membership confidence shrink: count/(count+K)

const LANG_BONUS = 0.5;      // max nudge toward your dominant original languages
const LANG_MALUS = 0.4;      // nudge away from a language you never engage with
const FLOOR_VOTES = 50;      // only judge crowd score once this many votes exist
const FLOOR_SCORE = 5.0;     // …then drop sub-5/10 (clearly poorly received)

// ── Live profile (rated taste + membership priors) ─────────────────
interface LiveProfile {
  w: Map<string, number>;
  hasSignal: boolean;
  langPref: Map<string, number>;
  langTotal: number;
}

function buildLiveProfile(userId: string): LiveProfile {
  const base = buildProfile(userId);          // rated signal (signed by avg − baseline)
  const w = new Map(base.w);
  const member = getMembershipSignal(userId);

  for (const [id, f] of member.facets) {
    const libShrink = f.libCount / (f.libCount + K_MEMBER);
    const wishShrink = f.wishCount / (f.wishCount + K_MEMBER);
    const role = ROLE_WEIGHT[f.role ?? "tag"] ?? 1;
    const prior = (LIB_PRIOR * libShrink + WISH_PRIOR * wishShrink) * role;
    if (prior !== 0) w.set(id, (w.get(id) ?? 0) + prior);
  }

  let langTotal = 0;
  for (const v of member.languages.values()) langTotal += v;

  return {
    w,
    hasSignal: base.hasSignal || member.facets.size > 0,
    langPref: member.languages,
    langTotal,
  };
}

// Gentle language affinity: + for your dominant languages, − for one you never
// touch. Bounded so it only breaks ties / sinks fully-foreign no-match content
// (the K-drama-flood lever) without overriding a real facet match.
function langTerm(lang: string | null, p: LiveProfile): number {
  if (!lang || p.langTotal === 0) return 0;
  const share = (p.langPref.get(lang) ?? 0) / p.langTotal;
  return share > 0 ? LANG_BONUS * share : -LANG_MALUS;
}

// Drop only clearly poorly-received items that have enough votes to judge.
// Unreleased / low-sample upcoming items always pass (the floor can't see them).
function belowFloor(c: FeedCandidate): boolean {
  return c.voteCount >= FLOOR_VOTES && c.voteAverage != null && c.voteAverage < FLOOR_SCORE;
}

// Tag facets straight off a candidate's list-payload genres/tags (no hydration).
function listFacets(c: FeedCandidate): Facet[] {
  const seen = new Set<string>();
  const out: Facet[] = [];
  for (const name of c.genreNames) {
    const key = tagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "tag", key, label: name });
  }
  return out;
}

// ── Hydration (full facets for movies/shows via one TMDB detail fetch) ──
// Also returns the merged poster so Trakt-sourced candidates (which carry no
// image) get one once hydrated through their TMDB id.
interface Hydrated { facets: Facet[]; posterUrl: string | null }
// LRU-capped: hydration is expensive (a TMDB detail fetch) so we keep recent
// results, but the cap prevents unbounded growth over long uptime (P2).
const _facetCache = new BoundedCache<string, Hydrated>({ max: 3000 });

async function hydrateFacets(c: FeedCandidate): Promise<Hydrated> {
  const ck = `${c.source}:${c.rawId}`;
  const cached = _facetCache.get(ck);
  if (cached) return cached;

  let result: Hydrated = { facets: listFacets(c), posterUrl: c.posterUrl };
  try {
    const provider = METADATA[c.source as keyof typeof METADATA];
    const link = await provider?.fetchById?.(String(c.rawId), c.type);
    if (link) {
      const ml: MediaLink = {
        id: "", mediaItemId: "", source: link.source, sourceId: link.sourceId,
        title: link.title, releaseDate: link.releaseDate, rawData: link.rawData, lastSynced: 0,
      };
      const merged = mergeLinks([ml], c.type);
      result = { facets: extractFacets([ml], c.type, merged), posterUrl: c.posterUrl ?? merged.posterUrl ?? null };
    }
  } catch { /* fall back to list facets */ }

  _facetCache.set(ck, result);
  return result;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Per-type ranking ───────────────────────────────────────────────
interface Scored { c: FeedCandidate; score: number; reasons: Reason[]; fandexScore: number | null; fandexCenter: number | null; fandexPending: boolean }

// Q15 (2026-07-19): the visible Fandex Score badge, using the RAW rated-library
// profile (never the membership-boosted LiveProfile used for feed ranking above,
// and never the seed/pill-refined one) — same rule H5.3 already applies to every
// other surface (card badges, detail page). Facets are whatever's on hand (list
// genres/tags for games + non-hydrated movies/shows, full hydrated facets once
// hydration runs) — a documented, cheaper approximation than the catalog's fully
// hydrated Fandex Score, consistent with this module's existing "no hydration on
// the cheap path" tradeoff.
function fandexFor(facets: Facet[], rawProfile: Profile): { score: number | null; center: number | null } {
  const fx = computeFandexScore(facets, rawProfile);
  return { score: fx?.score ?? null, center: fx?.center ?? null };
}

// ── Facet source of truth (2026-07-29) ─────────────────────────────
// `listFacets` returns a provider list payload's GENRES and nothing else, while
// every DB-backed surface (/api/detail, /api/library, the catalog "find" path)
// scores the same item off its persisted links — credits, keywords, studios.
// Two facet sources, one scorer, two different numbers for one item: Spirited
// Away read 65.8 on the Home rail and 101.5 on its own detail page.
//
// That gap was survivable under the pre-T2 weighted-mean aggregate, which
// divided facet count back out, so a thin item and a rich one landed in the same
// neighbourhood. T2's raw sum removed the divisor by design, which makes score
// magnitude scale directly with how many facets happen to be loaded — turning a
// documented approximation (Q15, H5.3) into a visible 35-point contradiction,
// in BOTH directions (Avengers: Endgame read 68.4 live vs 60.9 persisted).
//
// So the live paths now resolve each candidate to its catalog vector and score
// THOSE facets. Pure in-memory once `getCache()` is warm, plus one batched
// id→uuid query — no hydration, no provider round-trip.
const isDeep = (facets: Facet[]) => facets.some((f) => f.kind !== "tag");
// One feed page's worth of direct media_links reads (see `catalogFacets`).
const DIRECT_LINK_READ_CAP = 60;

function catalogFacets(candidates: FeedCandidate[]): Map<string, Facet[]> {
  const out = new Map<string, Facet[]>();
  if (!candidates.length) return out;

  const pairs: { source: string; sourceId: string }[] = [];
  for (const c of candidates) {
    for (const [source, sid] of Object.entries(c.ids ?? {})) {
      if (sid != null) pairs.push({ source, sourceId: String(sid) });
    }
  }
  if (!pairs.length) return out;

  const idMap = resolveMediaIdsBySource(pairs);
  const unresolved: { candidateId: string; mediaItemId: string }[] = [];

  for (const c of candidates) {
    for (const [source, sid] of Object.entries(c.ids ?? {})) {
      if (sid == null) continue;
      const mid = idMap.get(`${source}:${String(sid)}`);
      if (!mid) continue;
      const facets = getCatalogFacets(mid);
      if (facets && isDeep(facets)) { out.set(c.id, facets); break; }
      // In the catalog table but NOT in the discovery cache: POOL_WHERE keeps
      // browsed-only rows out of it (H2b), and roughly half a feed page is
      // exactly that — rows whose links are already fully enriched
      // (projection_version 2, 20 KB payloads), just pool-excluded. Reading
      // them straight from media_links below is a local query with no provider
      // call, so deferring them to the client's hydration round-trip would be
      // pure latency for data we already hold.
      unresolved.push({ candidateId: c.id, mediaItemId: mid });
      break;
    }
  }

  // Bounded on purpose: one feed page, not the whole catalog. Each read parses
  // that item's stored blobs, which is why the pooled path uses the cache.
  for (const { candidateId, mediaItemId } of unresolved.slice(0, DIRECT_LINK_READ_CAP)) {
    const links = loadLinks(mediaItemId);
    if (!links.length) continue;
    const type = candidateTypeOf(candidates, candidateId);
    if (!type) continue;
    const facets = extractFacets(links, type, mergeLinks(links, type));
    // Still shallow → genuinely thin, and only a provider fetch can fix it.
    // Leave it out so it's classified pending and healed asynchronously.
    if (isDeep(facets)) out.set(candidateId, facets);
  }
  return out;
}

const candidateTypeOf = (candidates: FeedCandidate[], id: string): MediaType | null =>
  candidates.find((c) => c.id === id)?.type ?? null;

async function rankType(
  candidates: FeedCandidate[],
  profile: LiveProfile,
  rawProfile: Profile,
  idf: Map<string, number>,
  hydrate: boolean
): Promise<Scored[]> {
  // Dedup (pages can overlap) + apply the crowd-vote floor.
  const byId = new Map<string, FeedCandidate>();
  for (const c of candidates) if (!belowFloor(c) && !byId.has(c.id)) byId.set(c.id, c);
  const pool = [...byId.values()];

  // Cheap pre-score (list genres/tags + language) — always available.
  const cheap = (c: FeedCandidate) =>
    (scoreFacets(listFacets(c), profile.w, idf)?.score ?? 0) + langTerm(c.originalLanguage, profile);

  // The visible Fandex Score always prefers the catalog's persisted facets (see
  // `catalogFacets`). Feed RANKING deliberately keeps using list facets below —
  // it's a relative ordering over a mostly-unreleased pool, and re-basing it on
  // whichever candidates happen to be in the catalog would quietly reorder the
  // feed, which is a bigger behaviour change than the bug being fixed here.
  const deepByCandidate = catalogFacets(pool);

  if (!hydrate) {
    return pool
      .map((c): Scored => {
        const facets = listFacets(c);
        const s = scoreFacets(facets, profile.w, idf);
        const deep = deepByCandidate.get(c.id);
        const fx = deep ? fandexFor(deep, rawProfile) : { score: null, center: null };
        return {
          c, score: (s?.score ?? 0) + langTerm(c.originalLanguage, profile), reasons: s?.reasons ?? [],
          fandexScore: fx.score, fandexCenter: fx.center, fandexPending: !deep,
        };
      })
      .sort(byScore)
      .slice(0, FINAL_KEEP);
  }

  // Hydrate only the most promising candidates, then full-facet score them.
  const top = pool
    .map((c) => ({ c, cheap: cheap(c) }))
    .sort((a, b) => b.cheap - a.cheap)
    .slice(0, HYDRATE_KEEP)
    .map((x) => x.c);
  const hydrated = await mapLimit(top, HYDRATE_CONCURRENCY, hydrateFacets);
  return top
    .map((c, i): Scored => {
      const h = hydrated[i];
      if (!c.posterUrl && h.posterUrl) c.posterUrl = h.posterUrl; // backfill Trakt items
      const s = scoreFacets(h.facets, profile.w, idf);
      // Catalog facets win over freshly-hydrated ones even here: hydration sees
      // TMDB alone, while a persisted row merges every source's links, so only
      // the catalog's array is guaranteed to equal what /api/detail will show.
      // Hydrated facets are still a fine second choice — they're deep too, so
      // nothing is left pending on this branch.
      const deep = deepByCandidate.get(c.id) ?? h.facets;
      const fx = fandexFor(deep, rawProfile);
      return {
        c, score: (s?.score ?? 0) + langTerm(c.originalLanguage, profile), reasons: s?.reasons ?? [],
        fandexScore: fx.score, fandexCenter: fx.center, fandexPending: false,
      };
    })
    .sort(byScore)
    .slice(0, FINAL_KEEP);
}

// Taste score desc; tiebreak on crowd score so equally-relevant items order by
// quality rather than arbitrarily.
function byScore(a: Scored, b: Scored): number {
  return b.score - a.score || (b.c.voteAverage ?? -1) - (a.c.voteAverage ?? -1);
}

// ── Cross-source dedup (the browse feed shows UNMERGED live items) ──
// Movies/shows: Trakt candidates are keyed by their TMDB id (same `id` format as
// the TMDB discover items), so identity dedup suffices — first (TMDB) wins.
function dedupeById(cands: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  const out: FeedCandidate[] = [];
  for (const c of cands) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
  return out;
}

// Games dedup (RAWG vs IGDB, by normalized title + year) moved to
// discoverFeed.ts and is imported above — SM35/SM36 needed the same rule in the
// section-pagination and trending paths, and three copies of an identity rule is
// how those two surfaces drifted apart in the first place.

// ── Public: the personalized browse feed ───────────────────────────
// Returns client-shaped discover items (taste-selected, NOT yet date-sorted —
// the client owns timeline ordering), or null when the user has no taste signal
// at all (cold start) so the caller can fall back to global popularity.

export interface PersonalizedItem {
  id: string; rawId: number; source: string; type: MediaType;
  title: string; releaseDate: string | null; posterUrl: string | null;
  platforms?: string[]; overview?: string; ids: Record<string, number>;
  raw?: RawPayload | null;   // carried through for H2b persistence, not for the client
  score: number; reasons: Reason[];
  // Q15/Q16 (2026-07-19): community stats + Fandex Score, so the browse feed can
  // be sorted client-side by Popularity/Rating/Fandex Score the same way the
  // catalog find() results already are — previously absent, which is why any
  // non-releaseDate sort had to abandon the browse feed for the (much smaller)
  // local catalog search. communityScore mirrors discovery.ts's 0-100 scale.
  communityVotes: number; communityScore: number | null; fandexScore: number | null;
  // S11 (2026-07-27) — the score's center, so the badge can band relative to
  // this user's own baseline (center±8) instead of a fixed 70/50.
  fandexCenter: number | null;
  // 2026-07-29 — "signed in, but this item's local row is too thin to score
  // honestly yet". Distinct from `fandexScore: null` with this false, which
  // means no score is coming (anonymous, or cold start). The client uses it to
  // show a pending badge and ask for a hydrated score.
  fandexPending: boolean;
}

// Community stats (crowd popularity/rating) — independent of any per-user
// profile, so always attachable regardless of auth state.
function communityStatsOf(c: FeedCandidate): { communityVotes: number; communityScore: number | null } {
  return { communityVotes: c.voteCount, communityScore: c.voteAverage != null ? c.voteAverage * 10 : null };
}

// Attach community stats (+ Fandex Score when signed in) to a page of raw
// candidates — used by the section-pagination ("load more") and anonymous/
// cold-start browse paths, which don't run through rankType's fuller pipeline.
export function decorateSection<T extends FeedCandidate>(
  candidates: T[],
  userId: string | null
): (T & { communityVotes: number; communityScore: number | null; fandexScore: number | null; fandexCenter: number | null; fandexPending: boolean })[] {
  const rawProfile = userId ? buildProfile(userId) : null;
  const catalog = rawProfile ? catalogFacets(candidates) : new Map<string, Facet[]>();
  return candidates.map((c) => {
    const deep = catalog.get(c.id);
    // No profile → no score at all (anonymous / cold start), and nothing to
    // resolve later, so never pending. With a profile: a deep catalog row
    // scores now; a thin one is deliberately left UNSCORED and flagged, so the
    // client can hydrate it rather than render a number we know is depressed.
    const fx = rawProfile && deep ? fandexFor(deep, rawProfile) : { score: null, center: null };
    return {
      ...c, ...communityStatsOf(c),
      fandexScore: fx.score, fandexCenter: fx.center,
      fandexPending: !!rawProfile && !deep,
    };
  });
}

const FEED_TTL_MS = 45 * 60 * 1000;
// Keyed by `${userId}:${region}`. TTL expiry + a size cap so stale/for-many-users
// entries can't accumulate on the long-lived process (P2).
const _feedCache = new BoundedCache<string, PersonalizedItem[]>({ max: 500, ttlMs: FEED_TTL_MS });

export function invalidatePersonalizedFeed(userId?: string) {
  if (!userId) { _feedCache.clear(); return; }
  for (const k of [..._feedCache.keys()]) if (k.startsWith(`${userId}:`)) _feedCache.delete(k);
}

export async function personalizedFeed(userId: string, region: string): Promise<PersonalizedItem[] | null> {
  const profile = buildLiveProfile(userId);
  if (!profile.hasSignal) return null;

  const key = `${userId}:${region}`;
  const hit = _feedCache.get(key);
  if (hit) return hit;

  const idf = getCatalogIdf();
  // Each medium pulls from two sources in parallel: RAWG + IGDB (games),
  // TMDB + Trakt-anticipated (movies/shows). Trakt only paginates a finite
  // anticipated list, so it contributes its first 2 pages, not the full depth.
  const [rawgGames, igdbGames, tmdbMovies, traktMovies, tmdbShows, traktShows] = await Promise.all([
    fetchPages((p) => fetchGamePage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchIgdbGamePage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchMoviePage(p, "future", region), PAGES_PER_SOURCE),
    fetchPages((p) => fetchTraktMoviePage(p), 2),
    fetchPages((p) => fetchShowPage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchTraktShowPage(p), 2),
  ]);

  const games = dedupeGames([...rawgGames, ...igdbGames]);
  const movies = dedupeById([...tmdbMovies, ...traktMovies]);
  const shows = dedupeById([...tmdbShows, ...traktShows]);

  // H5.3's rule (badge uses the RAW rated profile, never a refined/boosted one)
  // extends to the browse feed's badge too — buildProfile() is per-user cached,
  // so this is a cheap cache hit alongside buildLiveProfile's own internal call.
  const rawProfile = buildProfile(userId);

  const [selGames, selMovies, selShows] = await Promise.all([
    rankType(games, profile, rawProfile, idf, false),   // games: list-facet score only (RAWG + IGDB)
    rankType(movies, profile, rawProfile, idf, true),   // movies: hydrate → full facets (TMDB + Trakt)
    rankType(shows, profile, rawProfile, idf, true),    // shows: hydrate → full facets (TMDB + Trakt)
  ]);

  const items: PersonalizedItem[] = [...selGames, ...selMovies, ...selShows].map(({ c, score, reasons, fandexScore, fandexCenter, fandexPending }) => ({
    id: c.id, rawId: c.rawId, source: c.source, type: c.type,
    title: c.title, releaseDate: c.releaseDate, posterUrl: c.posterUrl,
    platforms: c.platforms, overview: c.overview, ids: c.ids, raw: c.raw,
    score, reasons, fandexScore, fandexCenter, fandexPending, ...communityStatsOf(c),
  }));

  _feedCache.set(key, items);
  return items;
}

// Cheap personalization for the infinite-scroll section pages: no hydration,
// just drop the crowd-floor failures and the clearly-irrelevant (negative taste
// + foreign-language no-match), so deeper scrolling doesn't revert to a global
// popularity flood. Keeps load-more fast. Also decorates every kept candidate
// with community stats + Fandex Score (Q15/Q16) so pages loaded via "load more"
// stay sortable the same way the initial personalized pull is.
export function filterSectionPage(userId: string, candidates: FeedCandidate[]) {
  const profile = buildLiveProfile(userId);
  const decorated = decorateSection(candidates, userId);
  if (!profile.hasSignal) return decorated;
  const idf = getCatalogIdf();
  return decorated.filter((c) => {
    if (belowFloor(c)) return false;
    const score = (scoreFacets(listFacets(c), profile.w, idf)?.score ?? 0) + langTerm(c.originalLanguage, profile);
    return score >= 0; // keep neutral-or-better; drop actively-mismatched
  });
}
