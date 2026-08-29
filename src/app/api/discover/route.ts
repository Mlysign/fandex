import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { httpFetch } from "@/lib/http";
import { sharedCache } from "@/lib/boundedCache";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";

import { searchLetterboxdFilms, posterFromFilm } from "@/lib/sources/letterboxd";
import { personalizedFeed, filterSectionPage, decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState, annotateAvailability } from "@/lib/annotateDiscover";
import type { Direction, RawPayload } from "@/lib/discoverFeed";
import type { MediaType } from "@/types";
import { fetchGamePageAllSources, fetchMoviePage, fetchShowPage } from "@/lib/discoverFeed";
import { withCatalogFallback, catalogSectionPage, catalogBrowseReady } from "@/lib/catalogFeed";
import { searchIgdbGames, igdbImageUrl, igdbReleaseDate } from "@/lib/sources/igdb";
import { normalizeName } from "@/lib/merge";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const RAWG_KEY = process.env.RAWG_API_KEY!;

// The shape EVERY provider block below must produce. `voteCount`/`voteAverage`
// are required, and that is the whole point of the type existing (2026-08-29):
// they are what lets the Popularity and Rating sorts order a search result at
// all, and a block that quietly omitted them is what put a 1959 show above a
// 2026 one. A new provider added here now fails `tsc` rather than the search.
// Structurally a `Decoratable` (src/lib/liveDiscover.ts).
interface SearchResult {
  id: string;
  rawId: number;
  source: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platforms?: string[];
  overview?: string;
  // `number | string` because Letterboxd film ids are alphanumeric ("2a9q").
  // FeedCandidate declares `Record<string, number>` and has always been wrong
  // about that; the search path only pushed a string past it because these
  // objects were untyped. `catalogFacets` String()s every id it reads, so the
  // runtime never cared — but the type should say what is actually here.
  ids: Record<string, number | string>;
  voteCount: number;
  voteAverage: number | null;
  raw: RawPayload;
}

async function searchAll(q: string, type: string | null): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  if (!type || type === "game") {
    try {
      const res = await httpFetch(
        `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(q)}&page_size=12&search_precise=true`,
        { appScopedAuth: true }
      );
      const data = await res.json();
      for (const g of data.results ?? []) {
        results.push({
          id: `rawg-${g.id}`, rawId: g.id, source: "rawg", type: "game",
          title: g.name, releaseDate: g.released ?? null,
          posterUrl: g.background_image ?? null,
          platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p.platform.name),
          ids: { rawg: g.id },
          voteCount: g.ratings_count ?? 0,
          voteAverage: typeof g.rating === "number" && g.rating > 0 ? g.rating * 2 : null, // 0–5 → 0–10
          raw: { source: "rawg", sourceId: String(g.id), data: g },
        });
      }
    } catch { /* continue */ }

    // IGDB game search — adds titles RAWG's index misses (deduped by title+year
    // against the RAWG hits above). No-ops when IGDB isn't configured.
    try {
      const existing = new Set(
        results.filter((r) => r.type === "game").map((r) => `${normalizeName(r.title)}|${(r.releaseDate ?? "").slice(0, 4)}`)
      );
      for (const g of await searchIgdbGames(q, 12)) {
        const date = igdbReleaseDate(g);
        const key = `${normalizeName(g.name ?? "")}|${(date ?? "").slice(0, 4)}`;
        if (existing.has(key)) continue;
        existing.add(key);
        results.push({
          id: `igdb-${g.id}`, rawId: g.id, source: "igdb", type: "game",
          title: g.name, releaseDate: date,
          posterUrl: igdbImageUrl(g.cover?.image_id, "t_cover_big"),
          platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p?.name).filter(Boolean),
          ids: { igdb: g.id },
          voteCount: g.total_rating_count ?? 0,
          voteAverage: typeof g.total_rating === "number" && g.total_rating > 0 ? g.total_rating / 10 : null, // 0–100 → 0–10
          raw: { source: "igdb", sourceId: String(g.id), data: g },
        });
      }
    } catch { /* continue */ }
  }

  if (!type || type === "movie") {
    try {
      const res = await httpFetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}`,
        { appScopedAuth: true }
      );
      const data = await res.json();
      for (const m of (data.results ?? []).slice(0, 10)) {
        results.push({
          id: `tmdb-movie-${m.id}`, rawId: m.id, source: "tmdb", type: "movie",
          title: m.title, releaseDate: m.release_date ?? null,
          posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
          overview: m.overview, ids: { tmdb: m.id },
          voteCount: m.vote_count ?? 0,
          voteAverage: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
          raw: { source: "tmdb", sourceId: String(m.id), data: m },
        });
      }
    } catch { /* continue */ }
  }

  if (!type || type === "show") {
    try {
      const res = await httpFetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}`,
        { appScopedAuth: true }
      );
      const data = await res.json();
      for (const s of (data.results ?? []).slice(0, 10)) {
        results.push({
          id: `tmdb-show-${s.id}`, rawId: s.id, source: "tmdb", type: "show",
          title: s.name, releaseDate: s.first_air_date ?? null,
          posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
          overview: s.overview, ids: { tmdb: s.id },
          voteCount: s.vote_count ?? 0,
          voteAverage: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
          raw: { source: "tmdb", sourceId: String(s.id), data: s },
        });
      }
    } catch { /* continue */ }
  }

  // Letterboxd film search (movies only — Letterboxd tracks films)
  if (!type || type === "movie") {
    try {
      const films = await searchLetterboxdFilms(q);
      // 2026-08-29 — was `results.map((r) => r.title?.toLowerCase())`: EVERY
      // result, of every type, keyed on title alone. So a GAME called "Lucky
      // Luke" suppressed a film of the same name, and any two films sharing a
      // title collapsed into whichever the earlier provider happened to return.
      // Same key shape as the IGDB dedupe above — normalized title + year, and
      // movies only. → src/lib/searchDedupe.ts for the same bug on the client.
      const existingFilms = new Set(
        results.filter((r) => r.type === "movie")
          .map((r) => `${normalizeName(r.title ?? "")}|${(r.releaseDate ?? "").slice(0, 4)}`)
      );
      for (const film of films.slice(0, 8)) {
        // Deduplicate against the TMDB films above by title + year
        const filmKey = `${normalizeName(film.name ?? "")}|${film.releaseYear ?? ""}`;
        if (existingFilms.has(filmKey)) continue;
        existingFilms.add(filmKey);
        const tmdbLink = film.links?.find((l: any) => l.type === "tmdb");
        results.push({
          id: `letterboxd-${film.id}`, rawId: 0, source: "letterboxd", type: "movie",
          title: film.name,
          releaseDate: film.releaseYear ? `${film.releaseYear}-01-01` : null,
          posterUrl: posterFromFilm(film),
          ids: {
            letterboxd: film.id,
            ...(tmdbLink ? { tmdb: parseInt(tmdbLink.id) } : {}),
          },
          // The Letterboxd film search payload carries no crowd stats at all
          // (its rating lives on a separate per-film endpoint), so these are an
          // honest "we hold none" rather than a zero we measured. Only reached
          // for films TMDB did not already return, which is where the votes
          // would have come from.
          voteCount: 0,
          voteAverage: null,
          raw: { source: "letterboxd", sourceId: String(film.id), data: film },
        });
      }
    } catch { /* continue */ }
  }

  return results;
}

// ── The search cache (2026-08-28) ────────────────────────────────────────────
// `searchAll` was the last provider boundary in the app with no cache at all,
// which AGENTS.md has required of every other one since August. Every query cost
// five live calls — RAWG, IGDB, TMDB movies, TMDB shows, Letterboxd — and on
// prod two of those (RAWG on its quota, Letterboxd with no valid key) return 401
// every single time. The client debounces at 300 ms, so refining a query walks
// through several prefixes and pays for each.
//
// ⚠️ NEVER CACHE AN EMPTY RESULT, the same rule discoverFeed's page cache keeps:
// `searchAll` swallows a per-provider failure and continues, so an outage looks
// exactly like "no such title", and storing that would pin the outage in place
// for the whole TTL. A genuinely empty query is re-asked, which is cheap.
//
// ⚠️ Keyed on (type, lowercased query) and nothing else — `searchAll` reads no
// region and no session, so there is nothing per-viewer to leak. Persisting and
// annotating still run per request, OUTSIDE the cache, and both build new
// objects rather than mutating these, so a cached array cannot be consumed once
// and come back stripped.
const SEARCH_TTL_MS = 15 * 60 * 1000;
// ⚠️ The bound comes from a MEASURED entry, not from a round number. An entry is
// a whole page of provider records INCLUDING each item's `raw` payload
// (persistDiscoverBatch needs it to create the row), and `GET
// /api/dev/dbsize?caches=1` over five real queries prices it at **51,003 bytes**
// — so 60 entries is ~3 MB serialised, against `facetCache.derived`'s 14 MB. The
// first draft said 150 on a guess of "tens of KB", which would have been a
// 7.7 MB ceiling for a cache that mostly serves repeats of the same few queries
// inside one 15-minute window. Re-price it before raising this.
const _searchCache = sharedCache<string, SearchResult[]>("discover.search", { max: 60, ttlMs: SEARCH_TTL_MS });

async function cachedSearchAll(q: string, type: string | null): Promise<SearchResult[]> {
  const key = `${type ?? "all"}|${q.toLowerCase()}`;
  const hit = _searchCache.get(key);
  if (hit) return hit;
  const fresh = await searchAll(q, type);
  if (fresh.length) _searchCache.set(key, fresh);
  return fresh;
}

function sortByDate<T extends { releaseDate?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return 0;
    if (!a.releaseDate) return 1;
    if (!b.releaseDate) return -1;
    return a.releaseDate.localeCompare(b.releaseDate);
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q")?.trim();
    const type = searchParams.get("type");
    // load-more: which source type to fetch next page from
    const section = searchParams.get("section") as "games" | "movies" | "shows" | null;
    const page = parseInt(searchParams.get("page") ?? "1");

    // Current user (if signed in) for canonical user-state annotation.
    let userId: string | null = null;
    try {
      userId = (await getSession())?.userId ?? null;
    } catch { /* continue unauthenticated */ }
    // Region for TMDB release-date filtering (T22): the user's country, else US.
    const region = userId ? getUserCountry(userId) : DEFAULT_COUNTRY;

    // H2b — give every item a row (and so a uuid) BEFORE it reaches the client,
    // then hand that uuid back as the item's `id`. This is what makes the item
    // url uuid-only: a discover result used to ship a composite id
    // (`tmdb-movie-693134`) that the url layer had to parse and resolve live.
    // Both helpers live in lib/annotateDiscover.ts (shared with /api/home and
    // the calendar's popular route since 2026-07-28); the `raw`-stripping and
    // session-gating rules and the incidents behind them are documented there.
    const persist = (items: any[]) => persistDiscoverBatch(items, userId);
    // Availability rides along with the user-state annotation: same batch, one
    // more query per response, no provider call. It is what makes the "Available
    // on" filter's streaming half count anything on this feed — the provider
    // LIST payloads these items are built from carry no watch providers at all.
    // → docs/catalog-growth.md phase 1.
    const annotate = (items: any[]) => annotateAvailability(annotateUserState(items, userId), region);

    // ── Search ────────────────────────────────────────────────────
    // 2026-08-29 — `decorateSection` is new here, and its absence is why a
    // popular NEW title could not be found by name. Every other branch of this
    // route decorates; the search branch returned raw provider records with no
    // `communityVotes` at all, so the client's Popularity sort
    // (`votesOf(i) = i.communityVotes ?? 0`) had every search result tied at
    // zero. Array.prototype.sort is stable, so what a user actually saw under
    // "Popularity" was the incoming order — `sortByDate` ASCENDING, i.e. oldest
    // first. Searching "Lucky" put a 1959 show in slot 1 and a 2026 one last.
    // The Rating and Fandex Score sorts were inert on this list for the same
    // reason.
    //
    // ⚠️ OUTSIDE `cachedSearchAll`, not inside it: the search cache is keyed on
    // (type, query) with no viewer in the key, and `decorateSection(_, userId)`
    // attaches a per-user Fandex Score. It maps to NEW objects, so the cached
    // array is not mutated — the same property `persist`/`annotate` rely on.
    //
    // ⚠️ `decorateSection`, not `filterSectionPage`: this is a search. Dropping
    // a title the user typed the name of is the failure being fixed, not a
    // ranking nicety to reapply.
    if (q && q.length >= 2) {
      const results = await cachedSearchAll(q, type ?? null);
      return NextResponse.json({ items: annotate(persist(decorateSection(sortByDate(results), userId))) });
    }

    // ── Load-more for a single section (pagination, either direction) ───
    // Cheap personalization: drop crowd-floor failures + actively-mismatched
    // items so deeper scrolling doesn't revert to a global-popularity flood
    // (no hydration → stays fast). Falls through unfiltered when no signal.
    if (section) {
      const direction: Direction = searchParams.get("direction") === "past" ? "past" : "future";
      const typeOfSection = { games: "game", movies: "movie", shows: "show" } as const;
      let results: any[] = [];

      // ── Phase 2: serve this section from our own catalog ────────────────
      // Once a (type, window) holds enough rows, load-more reads the database
      // and costs ZERO provider calls. Gated on breadth per section, because
      // the lanes fill at different rates — see catalogFeed.ts.
      if (catalogBrowseReady(typeOfSection[section], direction)) {
        const local = catalogSectionPage(typeOfSection[section], direction, page);
        const decorated = userId ? filterSectionPage(userId, local) : decorateSection(local, null);
        return NextResponse.json({ items: annotate(persist(decorated)), section, source: "catalog" });
      }

      // SM35: games come from RAWG *and* IGDB. This used to call fetchGamePage
      // (RAWG only), so a RAWG outage made "Load more" a silent dead control on
      // the games section while the initial browse above still showed IGDB games.
      if (section === "games")  results = await fetchGamePageAllSources(page, direction);
      if (section === "movies") results = await fetchMoviePage(page, direction, region);
      if (section === "shows")  results = await fetchShowPage(page, direction);

      // Nothing back from the providers → serve what we already hold for this
      // type and window. Measured 2026-08-27: with RAWG quota-latched and IGDB
      // failing, `?section=games` returned `{"items":[]}` on prod and the whole
      // category disappeared from Discover. → lib/catalogFeed.ts
      const fallback = withCatalogFallback(results, typeOfSection[section], direction, page);
      if (fallback.fellBack) {
        log.info("discover_catalog_fallback", { section, page, direction, items: fallback.items.length });
        results = fallback.items;
      }
      // Q15/Q16: always decorate with community stats (+ Fandex Score when
      // signed in) so a loaded-more page stays sortable by Popularity/Rating/
      // Fandex Score, not just the initial batch.
      results = userId ? filterSectionPage(userId, results) : decorateSection(results, null);
      return NextResponse.json({ items: annotate(persist(results)), section });
    }

    // ── Default browse ──
    // Signed-in users with any taste signal get a personalized, taste-ranked
    // selection of upcoming releases (date-sorted for the timeline). Cold-start
    // (no ratings/library/wishlist) or signed-out falls back to global
    // popularity — the original behavior.
    const personalized = userId ? await personalizedFeed(userId, region) : null;
    if (personalized) {
      return NextResponse.json({ items: annotate(persist(sortByDate(personalized))) });
    }

    // SM35 again, and this is the ANONYMOUS/cold-start path — the public one.
    // It had the same RAWG-only games pull, so a logged-in user with a taste
    // signal kept seeing IGDB games (personalizedFeed pulls both) while a
    // logged-out visitor's browse lost the whole category.
    // ── Phase 2: each section from the catalog once it is ready ─────────
    // Per SECTION, so a type with enough stored rows stops costing provider
    // calls while a thinner one keeps asking. A ready section makes NO provider
    // request at all, which is the whole point: this is the anonymous path, so
    // it is also the one a crawler and an outage both hit.
    const localOrLive = async (
      t: "game" | "movie" | "show", fetcher: () => Promise<any[]>
    ) => (catalogBrowseReady(t, "future") ? catalogSectionPage(t, "future", 1) : fetcher());

    const [games, movies, shows] = await Promise.all([
      localOrLive("game", () => fetchGamePageAllSources(1, "future")),
      localOrLive("movie", () => fetchMoviePage(1, "future", region)),
      localOrLive("show", () => fetchShowPage(1, "future")),
    ]);
    // Per SECTION, not for the batch: one dead provider must not be able to
    // take the other two categories down with it, and one healthy one must not
    // hide that a category is missing. This is the anonymous path, so it is
    // also what a crawler sees.
    const filled = [
      ...withCatalogFallback(games, "game", "future").items,
      ...withCatalogFallback(movies, "movie", "future").items,
      ...withCatalogFallback(shows, "show", "future").items,
    ];
    const all = sortByDate(decorateSection(filled, userId));
    return NextResponse.json({ items: annotate(persist(all)) });

  } catch (e: any) {
    log.error("discover_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
