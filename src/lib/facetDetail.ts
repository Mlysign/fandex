// Facet detail — everything about one tag / person / company: the titles that
// carry it (with the user's library state), the user's average rating, how that
// compares to the crowd, and (for people) a TMDB bio/age. Powers /insights/facet.
//
// Two sides, sourced independently so neither gets skewed:
//   - YOUR average  → always your full local catalog for the facet (every title
//     you rated), via itemsWithFacet. A sampled crowd set must NOT shrink this.
//   - CROWD average → the broadest sensible set (payload.scope):
//       person  → full TMDB filmography (combined_credits)        "filmography"
//       studio  → TMDB titles, popularity + recency sample        "sample"
//       dev/pub → local catalog only (PL3 dropped the RAWG sample)  "catalog"
//       tag     → TMDB genre/keyword + IGDB + Steam, pop+recent     "sample"
//       (network / failed resolution / no external) → catalog      "catalog"
// Sampling blends popularity with recency on purpose: popularity-only over-
// represents hits and inflates the crowd average.

import { sharedCache } from "@/lib/boundedCache";
import { httpFetch, BROWSE_BUDGET_MS } from "@/lib/http";
import type { DiscoveryVector } from "@/lib/discovery";
import { itemsWithFacet, resolvePersonTmdbId } from "@/lib/discovery";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import { getUserStateMap, resolveMediaIdsBySource } from "@/lib/userState";
import { fandexForPage } from "@/lib/liveDiscover";
import { persistDiscoverItems } from "@/lib/discoverPersist";
import { tmdbGenreId, resolveTmdbKeywordId } from "@/lib/sources/tagDiscover";
import { discoverIgdbByTags, igdbImageUrl, igdbReleaseDate, igdbConfigured } from "@/lib/sources/igdb";
import { searchSteamByTags, extractSteamDate } from "@/lib/sources/steam";
import { normalizeName, extractYear } from "@/lib/merge";
import type { FacetRole } from "@/lib/facets";
import { tagKey } from "@/lib/facets";
import type { MediaType } from "@/types";

const TMDB = process.env.TMDB_API_KEY;
const MAX_ITEMS = 150;
const COMPANY_PAGES = [1, 2]; // sample depth for a studio/dev (≈40 per sort order)
const TAG_PAGES = [1];        // tags are huge → 20 popular + 20 recent per source
const WRITER_JOBS = new Set(["Writer", "Screenplay", "Story", "Novel", "Author", "Comic Book", "Characters", "Teleplay"]);

export type FacetScope = "filmography" | "sample" | "catalog";

export interface FacetRefIn { kind: string; role?: FacetRole; key: string; label: string }

export interface FacetDetailItem {
  id: string;
  /** Public url address segment; see publicUrl.ts. */
  slug?: string | null;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  communityScore: number | null; // 0-100
  sources: { source: string; sourceId: string }[];
  // SM45 (2026-08-13) — optional because only buildExternalCandidates (the
  // advanced-search supplement) fills them in; the facet DETAIL page builds the
  // same item shape and doesn't show a Fandex badge. Absent → no badge, which is
  // what every caller rendered before this existed.
  fandexScore?: number | null;
  fandexCenter?: number | null;
  fandexPending?: boolean;
}

export interface PersonMeta {
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  age: number | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownForDepartment: string | null;
  tmdbUrl: string;
}

export interface FacetDetailPayload {
  facet: FacetRefIn;
  person: PersonMeta | null;
  scope: FacetScope;
  stats: {
    userAvg: number | null;
    userCount: number;
    totalCount: number;              // titles in the merged list (yours + discovered)
    crowdCount: number;              // titles the crowd average is computed over
    communityAvg: number | null;     // crowd avg (0-10) over the full/sampled set
    catalogCommunityAvg: number | null; // crowd avg (0-10) over the titles you rated
    baseline: number;
    delta: number | null;
  };
  items: FacetDetailItem[];
  shown: number;
}

// Normalized external title (crowd vote on a 0-10 scale).
interface ExtTitle {
  source: "tmdb" | "rawg" | "igdb" | "steam";
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  vote: number | null;
  votes: number;
  // The provider LIST payload this was built from (2026-08-13). Carried so an
  // external candidate can be thin-written like a browse-feed item — which is
  // what gives it a uuid, and therefore a Fandex Score and a heal path.
  // `persistDiscoverItems` refuses anything without it, which is exactly why
  // advanced search's database results were unscoreable: the payload was
  // dropped here, three lines from where the provider handed it to us.
  raw?: any;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function ageFrom(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  const end = deathday ? new Date(deathday) : new Date();
  if (isNaN(b.getTime()) || isNaN(end.getTime())) return null;
  let age = end.getFullYear() - b.getFullYear();
  const m = end.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Exported so the public facet layer (publicFacetDetail.ts) shares the exact same
// TMDB plumbing (key handling, error swallowing) instead of duplicating it. Its
// RAWG twin was removed by PL3 (2026-08-23) along with every facet-path RAWG
// call; RAWG remains a CONNECTOR and its stored rows still project, but this
// surface makes no RAWG requests at all now.
//
// It passes BROWSE_BUDGET_MS (2026-08-13). Every caller is a browse
// path — advanced search's database results and the public facet pages — and
// every one of them already degrades to "this source contributed nothing this
// round" via the `catch` right here. Without a budget they paid the full retry
// ladder per call: with RAWG down, `facet-fetch` measured **66.1 s on prod** for
// a two-tag query, and the public `/tag/*` pages were the source of the 59.8 s
// render once blamed on the cache. This is the same fix SM44 made to the heal
// loop, one route over — per-source FAILURE isolation is not per-source LATENCY
// isolation, and a `try/catch` around a provider call only buys the first.
export async function tmdbJson(path: string): Promise<any | null> {
  if (!TMDB) return null;
  try {
    const r = await httpFetch(
      `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB}`,
      { budgetMs: BROWSE_BUDGET_MS, appScopedAuth: true }
    );
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const _personCache = sharedCache<number, PersonMeta | null>("facetDetail.person", { max: 2000 });
export async function fetchPersonMeta(id: number): Promise<PersonMeta | null> {
  if (_personCache.has(id)) return _personCache.get(id)!;
  const d = await tmdbJson(`/person/${id}`);
  if (!d) { _personCache.set(id, null); return null; }
  const meta: PersonMeta = {
    name: d.name,
    biography: d.biography || null,
    birthday: d.birthday || null,
    deathday: d.deathday || null,
    age: ageFrom(d.birthday || null, d.deathday || null),
    placeOfBirth: d.place_of_birth || null,
    profileUrl: d.profile_path ? `https://image.tmdb.org/t/p/w300${d.profile_path}` : null,
    knownForDepartment: d.known_for_department || null,
    tmdbUrl: `https://www.themoviedb.org/person/${id}`,
  };
  _personCache.set(id, meta);
  return meta;
}

function tmdbCredit(c: any): ExtTitle {
  return {
    source: "tmdb", sourceId: String(c.id),
    type: (c.media_type === "tv" ? "show" : "movie") as MediaType,
    title: c.title || c.name || "Untitled",
    releaseDate: c.release_date || c.first_air_date || null,
    posterUrl: c.poster_path ? `https://image.tmdb.org/t/p/w500${c.poster_path}` : null,
    vote: typeof c.vote_average === "number" ? c.vote_average : null,
    votes: c.vote_count ?? 0,
    raw: c,
  };
}
// A Steam store item, from the tag search. `resolvedTags` is already attached by
// searchSteamByTags, so a row persisted from here carries the same tag names the
// merge unions into an item's tags (TAG_SOURCES includes "steam") — meaning a
// game found this way is scoreable on Steam's vocabulary, not just findable.
function steamGame(item: any): ExtTitle {
  const appid = item.appid ?? item.id;
  const capsule = item.assets?.asset_url_format && item.assets?.library_capsule
    ? `https://shared.fastly.steamstatic.com/store_item_assets/${item.assets.asset_url_format.replace("${FILENAME}", item.assets.library_capsule)}`
    : null;
  const pct = item.reviews?.summary_filtered?.percent_positive;
  return {
    source: "steam", sourceId: String(appid), type: "game",
    title: item.name || "Untitled",
    releaseDate: extractSteamDate(item),
    posterUrl: capsule ?? (appid ? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg` : null),
    // Steam reports % positive, not a 0-10 score — rescale to the shared scale.
    vote: typeof pct === "number" && pct > 0 ? pct / 10 : null,
    votes: item.reviews?.summary_filtered?.review_count ?? 0,
    raw: { ...item, appid },
  };
}

function igdbGame(g: any): ExtTitle {
  return {
    source: "igdb", sourceId: String(g.id), type: "game",
    title: g.name || "Untitled",
    releaseDate: igdbReleaseDate(g),
    posterUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big"),
    vote: typeof g.total_rating === "number" && g.total_rating > 0 ? g.total_rating / 10 : null, // 0-100 → 0-10
    votes: g.total_rating_count ?? 0,
    raw: g,
  };
}

// People: the full filmography for the clicked role.
function personTitles(role: string, credits: any): ExtTitle[] {
  const raw: any[] =
    role === "cast" ? (credits.cast ?? [])
    : role === "director" ? (credits.crew ?? []).filter((c: any) => c.job === "Director")
    : role === "writer" ? (credits.crew ?? []).filter((c: any) => WRITER_JOBS.has(c.job))
    : (credits.crew ?? []);
  const seen = new Set<string>();
  return raw
    .filter((c) => (c.media_type === "movie" || c.media_type === "tv") && c.id != null)
    .filter((c) => !(role === "cast" && /^(self|himself|herself|narrator)\b/i.test(String(c.character ?? ""))))
    .filter((c) => (c.vote_count ?? 0) > 0 || c.poster_path)
    .map(tmdbCredit)
    .filter((t) => { const k = `${t.type}:${t.sourceId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Studios: TMDB titles by the company, blended across popularity + recency.
async function tmdbCompanyTitles(companyId: number): Promise<ExtTitle[]> {
  const reqs: { media: "movie" | "tv"; path: string }[] = [];
  for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const) {
    for (const sort of ["popularity.desc", recency]) {
      for (const page of COMPANY_PAGES) {
        reqs.push({ media, path: `/discover/${media}?with_companies=${companyId}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}` });
      }
    }
  }
  const batches = await Promise.all(reqs.map(async (r) => ({ media: r.media, d: await tmdbJson(r.path) })));
  const out: ExtTitle[] = [];
  const seen = new Set<string>();
  for (const { media, d } of batches) {
    for (const m of d?.results ?? []) {
      const t = tmdbCredit({ ...m, media_type: media });
      const k = `${t.type}:${t.sourceId}`;
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }
  return out;
}

// Tags: a popularity + recency sample from TMDB (genre or keyword), RAWG (genre
// or tag) and IGDB. A tag's full catalog is the whole platform, so we sample.
//
// 2026-08-13 — takes ALL the active tag keys and ANDs them AT THE PROVIDER,
// rather than sampling each tag separately and intersecting afterwards. That
// distinction is the whole ballgame: each pull is ~40 rows out of a tag with
// thousands, so intersecting two samples came back empty even when matching
// games obviously exist (measured: `deckbuilding` 29, `tower defense` 40,
// intersection **0**). Asking the provider for the conjunction samples FROM the
// intersection instead. Each source expresses it differently, and a source that
// cannot express it contributes NOTHING rather than a wider set — a partial AND
// is indistinguishable from a correct one in the results, which is worse than
// an empty section.
async function tagTitles(keys: string[]): Promise<ExtTitle[]> {
  const out: ExtTitle[] = [];
  const seen = new Set<string>();
  const pushTmdb = (media: "movie" | "tv", results: any[] | undefined) => {
    for (const m of results ?? []) { const t = tmdbCredit({ ...m, media_type: media }); const k = `${t.type}:${t.sourceId}`; if (!seen.has(k)) { seen.add(k); out.push(t); } }
  };
  const reqs: Promise<void>[] = [];

  // TMDB: comma-joined values are AND within `with_genres`/`with_keywords`, and
  // the two params AND with each other, so ONE query expresses the whole filter.
  // A key that resolves to neither a genre nor a keyword can't be expressed at
  // all — and dropping it would quietly turn "A and B" into "A", a wider result
  // set wearing a narrower filter's label — so TMDB sits the round out instead.
  for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const) {
    const type: MediaType = media === "tv" ? "show" : "movie";
    const genreIds: number[] = [];
    const keywordIds: number[] = [];
    let expressible = true;
    for (const key of keys) {
      const gid = tmdbGenreId(key, type);
      if (gid != null) { genreIds.push(gid); continue; }
      const kwId = await resolveTmdbKeywordId(key);
      if (kwId) keywordIds.push(kwId); else { expressible = false; break; }
    }
    if (!expressible) continue;
    const params = [
      genreIds.length ? `with_genres=${genreIds.join(",")}` : "",
      keywordIds.length ? `with_keywords=${keywordIds.join(",")}` : "",
    ].filter(Boolean).join("&");
    if (!params) continue;
    const adult = media === "movie" ? "&include_adult=false" : "";
    for (const sort of ["popularity.desc", recency]) for (const page of TAG_PAGES)
      reqs.push(tmdbJson(`/discover/${media}?${params}&sort_by=${sort}&vote_count.gte=10${adult}&page=${page}`)
        .then((d) => pushTmdb(media, d?.results)));
  }

  // PL3 (2026-08-23): RAWG used to contribute FOUR requests here, which is the
  // entire measured RAWG cost of a cold tag page (docs/scalability.md §1). Its
  // 20,000/month free quota was being spent by a crawler walking the facet long
  // tail, not by people, and the paid tier is only 2.5x larger. IGDB and Steam
  // below cover games for this surface, and Steam is the better tag vocabulary
  // anyway.

  // Q27 (2026-07-19): IGDB alongside RAWG — a tag like "anime" is a real IGDB
  // theme/keyword but not a RAWG genre, and IGDB's game catalog covers titles
  // RAWG's doesn't. Collected separately (not pushed straight into `out`) so
  // it can dedupe against RAWG's SETTLED results by normalized title + release
  // year (same key liveDiscover.ts's dedupeGames uses for this exact pair,
  // since the two sources use independent ids) — RAWG and IGDB race in the
  // same Promise.all, so dedup can't run until both have actually landed.
  let igdbGames: any[] = [];
  if (igdbConfigured()) reqs.push(discoverIgdbByTags(keys, 40).then((results) => { igdbGames = results; }));

  // STEAM (2026-08-13) — the best tag vocabulary there is for games, and the
  // reason this pull exists at all for a query like `deckbuilding` + `tower
  // defense`: TMDB, RAWG and IGDB together returned ZERO for that pair, Steam
  // returns 277. It expresses the conjunction natively (`tagids_must_match`), so
  // no post-filter is needed here — see searchSteamByTags.
  let steamGames: any[] = [];
  reqs.push(searchSteamByTags(keys, 40).then((results) => { steamGames = results; }));

  await Promise.all(reqs);

  // Dedupe the game sources against each other by normalized title + release
  // year — they use independent ids, so that key is the only thing that spans
  // them (same key liveDiscover's dedupeGames uses for exactly this). RAWG lands
  // first as the incumbent, then IGDB, then Steam; each is checked against
  // everything already accepted, so a title present in all three appears once.
  const titleYears = new Set(
    out.map((t) => `${normalizeName(t.title)}|${extractYear(t.releaseDate) ?? "?"}`)
  );
  const acceptGame = (key: string, title: string, date: string | null, build: () => ExtTitle) => {
    if (seen.has(key)) return;
    const dupeKey = `${normalizeName(title ?? "")}|${extractYear(date) ?? "?"}`;
    if (titleYears.has(dupeKey)) return;
    seen.add(key);
    titleYears.add(dupeKey);
    out.push(build());
  };
  for (const g of igdbGames) {
    acceptGame(`game:igdb:${g.id}`, g.name ?? "", igdbReleaseDate(g), () => igdbGame(g));
  }
  for (const s of steamGames) {
    const appid = s.appid ?? s.id;
    acceptGame(`game:steam:${appid}`, s.name ?? "", extractSteamDate(s), () => steamGame(s));
  }
  return out;
}

const _tmdbCompanyCache = sharedCache<string, number | null>("facetDetail.tmdbCompany", { max: 5000 });
export async function resolveTmdbCompanyId(label: string): Promise<number | null> {
  const ck = label.toLowerCase();
  if (_tmdbCompanyCache.has(ck)) return _tmdbCompanyCache.get(ck)!;
  const d = await tmdbJson(`/search/company?query=${encodeURIComponent(label)}`);
  const results: any[] = d?.results ?? [];
  let id: number | null = null;
  if (results.length === 1) {
    id = results[0].id;
  } else if (results.length > 1) {
    // TMDB fragments studios across entities — pick the one with the largest catalog.
    const sized = await Promise.all(
      results.slice(0, 5).map(async (c) => ({ id: c.id as number, total: (await tmdbJson(`/discover/movie?with_companies=${c.id}&page=1`))?.total_results ?? 0 }))
    );
    sized.sort((a, b) => b.total - a.total);
    id = sized[0]?.total > 0 ? sized[0].id : (results.find((r) => (r.name ?? "").toLowerCase() === ck)?.id ?? results[0].id);
  }
  _tmdbCompanyCache.set(ck, id);
  return id;
}

function sortItems(items: FacetDetailItem[]) {
  items.sort((a, b) => {
    if ((a.rating != null) !== (b.rating != null)) return a.rating != null ? -1 : 1;
    if (a.rating != null && b.rating != null && a.rating !== b.rating) return b.rating - a.rating;
    return (b.communityScore ?? -1) - (a.communityScore ?? -1) || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
  });
}

// ── Router ────────────────────────────────────────────────────────
export async function buildFacetDetail(userId: string, ref: FacetRefIn): Promise<FacetDetailPayload> {
  const catVectors = itemsWithFacet(ref);

  if (ref.kind === "person") {
    const id = resolvePersonTmdbId(ref.role ?? "cast", ref.key);
    if (id) {
      const [meta, credits] = await Promise.all([fetchPersonMeta(id), tmdbJson(`/person/${id}/combined_credits`)]);
      const ext = credits ? personTitles(ref.role ?? "cast", credits) : null;
      return assemble(userId, ref, meta, ext ? "filmography" : "catalog", catVectors, ext);
    }
    return assemble(userId, ref, null, "catalog", catVectors, null);
  }

  if (ref.kind === "company") {
    if (ref.role === "studio") {
      const cid = await resolveTmdbCompanyId(ref.label);
      const ext = cid != null ? await tmdbCompanyTitles(cid) : null;
      if (ext && ext.length) return assemble(userId, ref, null, "sample", catVectors, ext);
    }
    // PL3: a game developer/publisher used to get a RAWG sample here. It now
    // serves from the local catalog, which is a deliberate trade: the sample
    // cost provider calls on a crawlable page, and our own catalog already
    // carries dev/pub facets from IGDB and Steam.
    return assemble(userId, ref, null, "catalog", catVectors, null); // network / failed
  }

  // tag
  const ext = await tagTitles([ref.key]);
  return assemble(userId, ref, null, ext.length ? "sample" : "catalog", catVectors, ext.length ? ext : null);
}

// Q27 (2026-07-19) — the /discover "more from the databases" supplement wants
// EXTERNAL candidates ONLY, filtered by hide-library/hide-wishlist — unlike
// buildFacetDetail's merged list, which puts the user's own rated titles for
// this facet FIRST (by design, for the facet detail page's "your titles"
// framing) and caps at MAX_ITEMS. For a facet with a large local pool (a big
// existing anime library, say), every one of those 150 slots was consumed by
// titles the user already owns — so the membership filter had nothing left to
// let through, even though the provider search itself found real candidates.
// This bypasses that merge entirely: resolve the external set the same way,
// skip catVectors, filter by membership directly against user state.
export interface MembershipFilterIn { library?: string; wishlist?: string; rated?: string }

/**
 * The identity an external title is matched by ACROSS facet pulls — normalized
 * title + year, not source id.
 *
 * Ids can't do it: a game can come back from RAWG under one facet and from IGDB
 * under another, with unrelated ids, and intersecting on those would drop the
 * very titles that match both. This is the same key `tagTitles` already uses to
 * dedupe RAWG against IGDB, for the same reason.
 */
export const extTitleKey = (t: { title: string; releaseDate: string | null }) =>
  `${normalizeName(t.title ?? "")}|${extractYear(t.releaseDate) ?? "?"}`;

/**
 * Resolve the external candidate set for EVERY include-facet and return only the
 * titles present in all of them.
 *
 * 2026-08-13 — this used to be a UNION, done in the route by concatenating each
 * facet's set. So with `deckbuilding` + `tower defense` active, the local half
 * (`find()`, which ANDs) returned **0** and the database half returned **69**
 * OR'd results — StarCraft and Doom 3 under a filter neither of them matches.
 * One filter, two contradictory readings, and the half that obeyed the user
 * contributed nothing. Nils's call (2026-08-13): AND, matching the local half,
 * accepting that a narrow pair of tags may legitimately return very little.
 */
export async function buildExternalSets(
  userId: string, refs: FacetRefIn[], membership?: MembershipFilterIn
): Promise<FacetDetailItem[]> {
  if (!refs.length) return [];

  // TAGS are ANDed at the provider, in ONE pull for all of them — see
  // tagTitles. Intersecting separate per-tag samples afterwards returns nothing:
  // each sample is ~40 rows out of thousands, so two of them rarely overlap even
  // when plenty of titles carry both tags.
  const tags = refs.filter((r) => r.kind !== "person" && r.kind !== "company");
  const others = refs.filter((r) => r.kind === "person" || r.kind === "company");

  // People and companies each resolve to ONE entity with a bounded, complete set
  // (a filmography, a studio's catalog), so those are exhaustive rather than
  // sampled and intersecting them afterwards is both correct and the only option
  // — there is no provider query for "directed by X and produced by Y".
  const sets = await Promise.all([
    ...(tags.length ? [tagTitles(tags.map((t) => t.key))] : []),
    ...others.map((r) => externalTitlesFor(r)),
  ]);
  if (!sets.length) return [];
  if (sets.some((s) => !s.length)) return []; // an empty set ANDs to nothing

  const [first, ...rest] = sets;
  const external = rest.length
    ? first.filter((t) => {
        const k = extTitleKey(t);
        return rest.every((s) => s.some((o) => extTitleKey(o) === k));
      })
    : first;
  return finishExternalCandidates(userId, external, membership);
}

async function externalTitlesFor(ref: FacetRefIn): Promise<ExtTitle[]> {
  let external: ExtTitle[] = [];
  if (ref.kind === "person") {
    const id = resolvePersonTmdbId(ref.role ?? "cast", ref.key);
    if (id) {
      const credits = await tmdbJson(`/person/${id}/combined_credits`);
      if (credits) external = personTitles(ref.role ?? "cast", credits);
    }
  } else if (ref.kind === "company") {
    if (ref.role === "studio") {
      const cid = await resolveTmdbCompanyId(ref.label);
      if (cid != null) external = await tmdbCompanyTitles(cid);
    }
    // PL3: game dev/publisher has no external sample any more, by design.
  } else {
    external = await tagTitles([ref.key]);
  }
  return external;
}

function finishExternalCandidates(
  userId: string, external: ExtTitle[], membership?: MembershipFilterIn
): FacetDetailItem[] {
  if (!external.length) return [];

  // Give every candidate a catalog row BEFORE anything else looks at it
  // (2026-08-13). This is the same insert-only, `browsed=1`, projection-version-0
  // thin write the browse feed has always done — driven by a payload a provider
  // already returned to one of OUR queries, never by a caller-supplied id — and
  // it is the whole unlock: a uuid is what makes an item scoreable, heal-able and
  // linkable. Without it the database half of advanced search could only ever
  // show a community rating, because there was nothing to hang a score on.
  //
  // Authed-only by construction: /api/discover/facet-fetch is `withUser`, and the
  // anonymous facet surface goes through publicFacetDetail.ts, which keeps its
  // own lookup-only branch (PR13–15's "an anonymous request writes nothing").
  const persistable = external
    .filter((t) => t.raw && t.title)
    .map((t) => ({
      id: `${t.source}-${t.type}-${t.sourceId}`,
      type: t.type,
      title: t.title,
      releaseDate: t.releaseDate,
      raw: { source: t.source, sourceId: t.sourceId, data: t.raw },
    }));
  try { persistDiscoverItems(persistable); } catch { /* live-only this round */ }

  const extMap = resolveMediaIdsBySource(external.map((t) => ({ source: t.source, sourceId: t.sourceId })));
  const state = getUserStateMap(userId, [...new Set(extMap.values())]);

  const seen = new Set<string>();
  const local = new Set<string>(); // ids that resolved to a real media_items row
  const out: FacetDetailItem[] = [];
  for (const t of external) {
    const mid = extMap.get(`${t.source}:${t.sourceId}`);
    const key = mid ?? `${t.source}-${t.type}-${t.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const st = mid ? state.get(mid) : undefined;
    const inLib = !!st?.libraryStatus;
    const inWl = !!st?.onWatchlist;
    const isRated = st?.rating != null;
    if (membership?.library === "only" && !inLib) continue;
    if (membership?.library === "exclude" && inLib) continue;
    if (membership?.wishlist === "only" && !inWl) continue;
    if (membership?.wishlist === "exclude" && inWl) continue;
    if (membership?.rated === "only" && !isRated) continue;
    if (membership?.rated === "exclude" && isRated) continue;

    out.push({
      id: mid ?? key, type: t.type, title: t.title, releaseDate: t.releaseDate, posterUrl: t.posterUrl,
      communityScore: t.vote != null ? Math.round(t.vote * 10) : null,
      platformSources: st?.platformSources ?? [], onWatchlist: inWl, libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null, sources: [{ source: t.source, sourceId: t.sourceId }],
    });
    if (mid) local.add(mid); // === the item's id, since id is `mid ?? key`
  }

  // SM45 — score the page. This is the half of advanced search a TAG filter
  // actually lands in, and it carried no fandex fields at all: 69 results for
  // Nils's `deckbuilding` + `tower defense` query came back with 0 scored and 0
  // pending, so 29 of them rendered a completely empty badge slot and the other
  // 40 silently showed a COMMUNITY score in the place the Fandex Score belongs.
  // SM43 fixed the local find() path beside this one and left this untouched.
  //
  // Only items with a real local row are eligible: `/api/discover/scores` heals
  // by media_items.id, so flagging a purely-external candidate pending would ask
  // a question that route can only answer "no" to — a guaranteed-wasted round
  // trip and a spinner that resolves to nothing. Since the thin write above, that
  // is nearly all of them; the exceptions are titles with no payload to store.
  const scoreable = out.filter((it) => local.has(it.id));
  const fandex = fandexForPage(
    scoreable.map((it) => ({
      id: it.id,
      type: it.type,
      ids: Object.fromEntries(it.sources.map((s) => [s.source, s.sourceId])),
    })),
    userId
  );
  for (const it of scoreable) {
    const fx = fandex.get(it.id);
    if (!fx) continue;
    it.fandexScore = fx.score;
    it.fandexCenter = fx.center;
    it.fandexPending = fx.pending;
  }
  return out;
}

// ── Merge the user's catalog (authoritative for YOUR avg) with the external
//    crowd set (authoritative for the CROWD avg + unseen discovery). ──────────
function assemble(
  userId: string, ref: FacetRefIn, person: PersonMeta | null, scope: FacetScope,
  catVectors: DiscoveryVector[], external: ExtTitle[] | null
): FacetDetailPayload {
  // State for every media id we touch (catalog + external titles that resolve locally).
  const extMap = external ? resolveMediaIdsBySource(external.map((t) => ({ source: t.source, sourceId: t.sourceId }))) : new Map<string, string>();
  const mediaIds = new Set<string>(catVectors.map((v) => v.id));
  for (const mid of extMap.values()) mediaIds.add(mid);
  const state = getUserStateMap(userId, [...mediaIds]);

  // Merged item map, keyed by media id when known (so a catalog item and its
  // external twin collapse into one), else by the external source id.
  const map = new Map<string, FacetDetailItem>();
  for (const v of catVectors) {
    const st = state.get(v.id);
    map.set(`mid:${v.id}`, {
      id: v.id, slug: v.slug, type: v.type, title: v.title, releaseDate: v.releaseDate, posterUrl: v.posterUrl,
      communityScore: v.communityScore,
      platformSources: st?.platformSources ?? [], onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null, rating: st?.rating ?? null, sources: v.sources,
    });
  }
  for (const t of external ?? []) {
    const mid = extMap.get(`${t.source}:${t.sourceId}`);
    const key = mid ? `mid:${mid}` : `${t.source}:${t.sourceId}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.communityScore == null && t.vote != null) existing.communityScore = Math.round(t.vote * 10);
      continue;
    }
    const st = mid ? state.get(mid) : undefined;
    map.set(key, {
      id: mid ?? `${t.source}-${t.type}-${t.sourceId}`,
      type: t.type, title: t.title, releaseDate: t.releaseDate, posterUrl: t.posterUrl,
      communityScore: t.vote != null ? Math.round(t.vote * 10) : null,
      platformSources: st?.platformSources ?? [], onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null, rating: st?.rating ?? null,
      sources: [{ source: t.source, sourceId: t.sourceId }],
    });
  }
  const items = [...map.values()];
  sortItems(items);

  // YOUR average — over every title you rated (from the full merged set).
  const rated = items.filter((i) => i.rating != null);
  const catalogCommunityAvg = mean(rated.filter((i) => i.communityScore != null).map((i) => (i.communityScore as number) / 10));

  // T11 (2026-07-29) — SM22's root cause: this used to be a PLAIN mean over
  // `rated`, while the item page and Insights show the Bayesian-shrunk BA
  // (profile.meta.get(id)?.BA / getLibraryFacetAnalysis's FacetStat.ba — the
  // SAME formula, since buildProfile's BA is literally re-derived from these
  // same facets). The two converge once a facet has many ratings (shrinkage
  // becomes negligible) but genuinely diverge for a thin one — exactly a
  // "different value" complaint. Read the SAME figure here instead of
  // recomputing a different one from whatever's in `rated`.
  const analysis = getLibraryFacetAnalysis(userId);
  const myStat = analysis.facets.find(
    (f) => f.kind === ref.kind && (f.role ?? "") === (ref.role ?? "") && f.key === ref.key
  );
  const userAvg = myStat ? myStat.ba : mean(rated.map((i) => i.rating as number));
  const userCount = myStat ? myStat.count : rated.length;

  // CROWD average — over the broad external set (well-rated only), else catalog.
  let communityAvg: number | null;
  let crowdCount: number;
  if (external) {
    const minVotes = (t: ExtTitle) => (t.source === "rawg" ? 5 : 10);
    let pool = external.filter((t) => t.vote != null && t.votes >= minVotes(t));
    if (pool.length < 3) pool = external.filter((t) => t.vote != null && t.votes > 0);
    communityAvg = mean(pool.map((t) => t.vote as number));
    crowdCount = pool.length;
  } else {
    const pool = items.filter((i) => i.communityScore != null);
    communityAvg = mean(pool.map((i) => (i.communityScore as number) / 10));
    crowdCount = pool.length;
  }

  const baseline = analysis.baseline;
  return {
    facet: ref,
    person,
    scope,
    stats: {
      userAvg: userAvg != null ? round1(userAvg) : null,
      userCount,
      totalCount: items.length,
      crowdCount,
      communityAvg: communityAvg != null ? round1(communityAvg) : null,
      catalogCommunityAvg: catalogCommunityAvg != null ? round1(catalogCommunityAvg) : null,
      baseline: round1(baseline),
      delta: userAvg != null && communityAvg != null ? round1(userAvg - communityAvg) : null,
    },
    items: items.slice(0, MAX_ITEMS),
    shown: Math.min(items.length, MAX_ITEMS),
  };
}
