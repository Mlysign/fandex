import type { MediaType, Source } from "@/types";
import { CATALOG } from "@/lib/sources/catalog";

export const TYPE_COLORS: Record<MediaType | string, string> = {
  game: "#4ade80",
  movie: "#f59e0b",
  show: "#a78bfa",
};

// Connectable-platform presentation (color/label) is declared once in catalog.ts
// (A5); the maps below derive from it and add the display-only sources — IGDB
// (metadata) and the external rating providers in the community-ratings row,
// which aren't connectable accounts.
const CATALOG_COLORS = Object.fromEntries(Object.values(CATALOG).map((m) => [m.id, m.color]));
const CATALOG_LABELS = Object.fromEntries(Object.values(CATALOG).map((m) => [m.id, m.shortLabel ?? m.label]));

export const SOURCE_COLORS: Record<Source | string, string> = {
  ...CATALOG_COLORS,
  igdb: "#9147ff",
  // External rating sources surfaced in the unified community-ratings row.
  imdb: "#f5c518",
  rt: "#fa320a",
  metacritic: "#ffcc33",
  "igdb-critics": "#9147ff",
};

// Per-role LABELS for people/company facets on the Insights page.
//
// The matching per-role COLOUR map (ROLE_COLORS: pink / purple / indigo / cyan /
// green / yellow / orange / blue) was deleted 2026-07-30. Those 8 hues plus
// tags.ts's 9 per-category ones were the "colour scheme is a bit messy" problem;
// facets now take one of four gold-family colours by facet CLASS — see
// src/lib/facetPalette.ts. Don't reintroduce a per-role or per-category palette.
export const ROLE_LABELS: Record<string, string> = {
  director: "Directors",
  writer: "Writers",
  creator: "Creators",
  cast: "Cast",
  developer: "Developers",
  publisher: "Publishers",
  studio: "Studios",
  network: "Networks",
  // Singular on purpose: an item belongs to ONE franchise, so this label reads
  // as a row heading in the score breakdown ("Franchise — Star Wars"), unlike
  // the plural group headings above.
  ip: "Franchise",
};

export const SOURCE_LABELS: Record<Source | string, string> = {
  ...CATALOG_LABELS,
  igdb: "IGDB",
  imdb: "IMDb",
  rt: "Rotten Tomatoes",
  metacritic: "Metacritic",
  "igdb-critics": "IGDB Critics",
};
