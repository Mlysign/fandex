// TMDB genre-id → name maps. The `discover/movie` + `discover/tv` LIST endpoints
// return numeric `genre_ids` only (not names), but the catalog's tag facets are
// keyed by genre *name* (normalize.ts reads `genres[].name` from the detail
// payload). So to taste-pre-score a live list item before hydrating it, we map
// its genre ids back to the same names the facet layer uses.
//
// These id sets are stable TMDB reference data (movie and TV use DIFFERENT ids,
// e.g. movie 28 = Action vs TV 10759 = Action & Adventure).

import { MediaType } from "@/types";

const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
  37: "Western",
};

const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
  10766: "Soap", 10767: "Talk", 10768: "War & Politics", 37: "Western",
};

// Genre display names for a list item's `genre_ids` (TMDB movie/show only).
export function tmdbGenreNames(ids: number[] | undefined, type: MediaType): string[] {
  if (!ids?.length) return [];
  const map = type === "show" ? TV_GENRES : MOVIE_GENRES;
  return ids.map((id) => map[id]).filter((n): n is string => !!n);
}
