import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { httpFetch } from "@/lib/http";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";

import { searchLetterboxdFilms, posterFromFilm } from "@/lib/sources/letterboxd";
import { personalizedFeed, filterSectionPage, decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState, annotateAvailability } from "@/lib/annotateDiscover";
import type { Direction } from "@/lib/discoverFeed";
import { fetchGamePageAllSources, fetchMoviePage, fetchShowPage } from "@/lib/discoverFeed";
import { searchIgdbGames, igdbImageUrl, igdbReleaseDate } from "@/lib/sources/igdb";
import { normalizeName } from "@/lib/merge";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const RAWG_KEY = process.env.RAWG_API_KEY!;

async function searchAll(q: string, type: string | null) {
  const results: any[] = [];

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
          raw: { source: "tmdb", sourceId: String(s.id), data: s },
        });
      }
    } catch { /* continue */ }
  }

  // Letterboxd film search (movies only — Letterboxd tracks films)
  if (!type || type === "movie") {
    try {
      const films = await searchLetterboxdFilms(q);
      const existingTitles = new Set(results.map((r) => r.title?.toLowerCase()));
      for (const film of films.slice(0, 8)) {
        // Deduplicate against TMDB results by title
        if (existingTitles.has(film.name?.toLowerCase())) continue;
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
          raw: { source: "letterboxd", sourceId: String(film.id), data: film },
        });
      }
    } catch { /* continue */ }
  }

  return results;
}

function sortByDate(items: any[]) {
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
    if (q && q.length >= 2) {
      const results = await searchAll(q, type ?? null);
      return NextResponse.json({ items: annotate(persist(sortByDate(results))) });
    }

    // ── Load-more for a single section (pagination, either direction) ───
    // Cheap personalization: drop crowd-floor failures + actively-mismatched
    // items so deeper scrolling doesn't revert to a global-popularity flood
    // (no hydration → stays fast). Falls through unfiltered when no signal.
    if (section) {
      const direction: Direction = searchParams.get("direction") === "past" ? "past" : "future";
      let results: any[] = [];
      // SM35: games come from RAWG *and* IGDB. This used to call fetchGamePage
      // (RAWG only), so a RAWG outage made "Load more" a silent dead control on
      // the games section while the initial browse above still showed IGDB games.
      if (section === "games")  results = await fetchGamePageAllSources(page, direction);
      if (section === "movies") results = await fetchMoviePage(page, direction, region);
      if (section === "shows")  results = await fetchShowPage(page, direction);
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
    const [games, movies, shows] = await Promise.all([
      fetchGamePageAllSources(1, "future"),
      fetchMoviePage(1, "future", region),
      fetchShowPage(1, "future"),
    ]);
    const all = sortByDate(decorateSection([...games, ...movies, ...shows], userId));
    return NextResponse.json({ items: annotate(persist(all)) });

  } catch (e: any) {
    log.error("discover_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
