import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserStateMap, resolveMediaIdsBySource } from "@/lib/userState";

import { searchLetterboxdFilms, posterFromFilm } from "@/lib/sources/letterboxd";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const RAWG_KEY = process.env.RAWG_API_KEY!;

// Browse window: ~18 months forward for upcoming, ~18 months back for past.
const DAYS_WINDOW = 550;
const todayISO  = () => new Date().toISOString().split("T")[0];
const offsetISO = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

type Direction = "future" | "past";

// Date range for a direction. Past = [today-window, today]; future = [today, today+window].
function dateWindow(direction: Direction): { gte: string; lte: string } {
  return direction === "past"
    ? { gte: offsetISO(-DAYS_WINDOW), lte: todayISO() }
    : { gte: todayISO(), lte: offsetISO(DAYS_WINDOW) };
}

async function getUpcomingGames(page = 1, direction: Direction = "future") {
  // Order by popularity (`-added`) within the window so notable games surface
  // first; the client date-sorts the merged feed afterwards.
  const { gte, lte } = dateWindow(direction);
  const res = await fetch(
    `https://api.rawg.io/api/games?key=${RAWG_KEY}` +
      `&dates=${gte},${lte}&ordering=-added&page_size=20&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((g: any) => ({
    id: `rawg-${g.id}`, rawId: g.id, source: "rawg", type: "game",
    title: g.name, releaseDate: g.released ?? null,
    posterUrl: g.background_image ?? null,
    platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p.platform.name),
    ids: { rawg: g.id },
  }));
}

async function getUpcomingMovies(page = 1, direction: Direction = "future") {
  // `discover` with a release-date window sorted by popularity gives notable
  // releases across the whole window (the client date-sorts for display).
  const { gte, lte } = dateWindow(direction);
  const res = await fetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&include_adult=false&with_release_type=2|3` +
      `&primary_release_date.gte=${gte}&primary_release_date.lte=${lte}&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((m: any) => ({
    id: `tmdb-movie-${m.id}`, rawId: m.id, source: "tmdb", type: "movie",
    title: m.title, releaseDate: m.release_date ?? null,
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    overview: m.overview, ids: { tmdb: m.id },
  }));
}

async function getUpcomingShows(page = 1, direction: Direction = "future") {
  // `discover/tv` over a date window, popularity-sorted, for real coverage.
  const { gte, lte } = dateWindow(direction);
  const res = await fetch(
    `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&first_air_date.gte=${gte}` +
      `&first_air_date.lte=${lte}&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((s: any) => ({
    id: `tmdb-show-${s.id}`, rawId: s.id, source: "tmdb", type: "show",
    title: s.name, releaseDate: s.first_air_date ?? null,
    posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
    overview: s.overview, ids: { tmdb: s.id },
  }));
}

async function searchAll(q: string, type: string | null) {
  const results: any[] = [];

  if (!type || type === "game") {
    try {
      const res = await fetch(
        `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(q)}&page_size=12&search_precise=true`
      );
      const data = await res.json();
      for (const g of data.results ?? []) {
        results.push({
          id: `rawg-${g.id}`, rawId: g.id, source: "rawg", type: "game",
          title: g.name, releaseDate: g.released ?? null,
          posterUrl: g.background_image ?? null,
          platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p.platform.name),
          ids: { rawg: g.id },
        });
      }
    } catch { /* continue */ }
  }

  if (!type || type === "movie") {
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      for (const m of (data.results ?? []).slice(0, 10)) {
        results.push({
          id: `tmdb-movie-${m.id}`, rawId: m.id, source: "tmdb", type: "movie",
          title: m.title, releaseDate: m.release_date ?? null,
          posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
          overview: m.overview, ids: { tmdb: m.id },
        });
      }
    } catch { /* continue */ }
  }

  if (!type || type === "show") {
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      for (const s of (data.results ?? []).slice(0, 10)) {
        results.push({
          id: `tmdb-show-${s.id}`, rawId: s.id, source: "tmdb", type: "show",
          title: s.name, releaseDate: s.first_air_date ?? null,
          posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
          overview: s.overview, ids: { tmdb: s.id },
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

    // Attach canonical user-state (wishlist providers + watched/played + rating)
    // to a batch of live discover items, resolved against the local DB. DB-only
    // (no extra external calls) so it stays fast with infinite scroll.
    const annotate = (items: any[]) => {
      if (!userId) return items.map((it) => ({ ...it, platformSources: [], onWatchlist: false, libraryStatus: null, rating: null }));

      const pairs: { source: string; sourceId: string }[] = [];
      for (const it of items) {
        for (const [source, sid] of Object.entries(it.ids ?? {})) {
          if (sid != null) pairs.push({ source, sourceId: String(sid) });
        }
      }
      const idMap = resolveMediaIdsBySource(pairs);
      const stateMap = getUserStateMap(userId, [...new Set(idMap.values())]);

      return items.map((it) => {
        let mediaItemId: string | undefined;
        for (const [source, sid] of Object.entries(it.ids ?? {})) {
          if (sid == null) continue;
          const mid = idMap.get(`${source}:${sid}`);
          if (mid) { mediaItemId = mid; break; }
        }
        const st = mediaItemId ? stateMap.get(mediaItemId) : undefined;
        return {
          ...it,
          platformSources: st?.platformSources ?? [],
          onWatchlist: st?.onWatchlist ?? false,
          libraryStatus: st?.libraryStatus ?? null,
          rating: st?.rating ?? null,
        };
      });
    };

    // ── Search ────────────────────────────────────────────────────
    if (q && q.length >= 2) {
      const results = await searchAll(q, type ?? null);
      return NextResponse.json({ items: annotate(sortByDate(results)) });
    }

    // ── Load-more for a single section (pagination, either direction) ───
    if (section) {
      const direction: Direction = searchParams.get("direction") === "past" ? "past" : "future";
      let results: any[] = [];
      if (section === "games")  results = await getUpcomingGames(page, direction);
      if (section === "movies") results = await getUpcomingMovies(page, direction);
      if (section === "shows")  results = await getUpcomingShows(page, direction);
      return NextResponse.json({ items: annotate(results), section });
    }

    // ── Default browse: all three sources merged and date-sorted ──
    const [games, movies, shows] = await Promise.all([
      getUpcomingGames(),
      getUpcomingMovies(),
      getUpcomingShows(),
    ]);
    const all = sortByDate([...games, ...movies, ...shows]);
    return NextResponse.json({ items: annotate(all) });

  } catch (e: any) {
    console.error("[discover]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
