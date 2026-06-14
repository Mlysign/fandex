import { MediaType, Source } from "@/types";

export const TYPE_COLORS: Record<MediaType | string, string> = {
  game: "#4ade80",
  movie: "#f59e0b",
  show: "#a78bfa",
};

export const SOURCE_COLORS: Record<Source | string, string> = {
  steam: "#1b9af7",
  rawg: "#4ade80",
  trakt: "#ed1c24",
  tmdb: "#01b4e4",
  letterboxd: "#00c030",
  igdb: "#9147ff",
  // External rating sources surfaced in the unified community-ratings row.
  imdb: "#f5c518",
  rt: "#fa320a",
  metacritic: "#ffcc33",
  "igdb-critics": "#9147ff",
};

// Per-role accent colors + labels for people/company facets on the Insights page
// (tags use CATEGORY_COLORS from tags.ts).
export const ROLE_COLORS: Record<string, string> = {
  director: "#f472b6",
  writer: "#c084fc",
  creator: "#818cf8",
  cast: "#22d3ee",
  developer: "#4ade80",
  publisher: "#facc15",
  studio: "#fb923c",
  network: "#38bdf8",
};

export const ROLE_LABELS: Record<string, string> = {
  director: "Directors",
  writer: "Writers",
  creator: "Creators",
  cast: "Cast",
  developer: "Developers",
  publisher: "Publishers",
  studio: "Studios",
  network: "Networks",
};

export const SOURCE_LABELS: Record<Source | string, string> = {
  steam: "Steam",
  rawg: "RAWG",
  trakt: "Trakt",
  tmdb: "TMDB",
  letterboxd: "Letterboxd",
  igdb: "IGDB",
  imdb: "IMDb",
  rt: "Rotten Tomatoes",
  metacritic: "Metacritic",
  "igdb-critics": "IGDB Critics",
};
