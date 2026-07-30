// The facet palette — FOUR colours for the entire facet taxonomy (2026-07-30).
//
// Before this, a facet's colour came from one of two unrelated 8-and-9-entry hex
// maps (constants.ts's ROLE_COLORS, tags.ts's CATEGORIES) totalling 17 hues,
// none of them related to the brand gold. This module is the ONE mapping from a
// facet to its colour, and the four values are CSS custom properties (see
// globals.css) so they retheme with light mode instead of being baked in.
//
// WHY THE AXIS IS THE FACET CLASS, NOT THE CATEGORY: tag categories are runtime
// data — /dev/scoring's taxonomy editor can create one at any time — so a
// per-category palette would always be one admin action away from having no
// entry for a live category. (That exact class of bug already bit the tag
// display: a static 9-entry CATEGORIES const iterated against a live 10-row
// table made a tag *vanish*.) Four classes are fixed by the schema and can't
// drift: people, companies, genre, everything-else-tag-shaped.
//
// `genre` is split out of the other tag categories on purpose — it's the facet
// people actually browse by, and Nils asked for it to read distinctly.

import type { FacetKind, FacetRole } from "@/lib/facets";

export type FacetClass = "person" | "genre" | "tag" | "company";

const PERSON_ROLES = new Set(["director", "writer", "creator", "cast"]);
const COMPANY_ROLES = new Set(["developer", "publisher", "studio", "network"]);

/** The category id that gets its own colour; every other tag category shares one. */
export const GENRE_CATEGORY_ID = "genre";

export interface FacetLike {
  kind?: FacetKind | string | null;
  role?: FacetRole | string | null;
  category?: string | null;
}

/**
 * Which of the four classes a facet belongs to.
 *
 * `kind` is authoritative when present; `role` is the fallback for the callers
 * that only carry a role (Insights' per-role groups, a Fandex Score reason).
 * Anything unrecognised lands on `tag`, which is the neutral of the four — the
 * same fail-soft direction groupTagsByCategory takes with an unknown category.
 */
export function facetClassOf(f: FacetLike): FacetClass {
  const role = f.role ?? "";
  if (f.kind === "person" || PERSON_ROLES.has(role)) return "person";
  if (f.kind === "company" || COMPANY_ROLES.has(role)) return "company";
  if (f.kind === "tag" || !f.kind) return f.category === GENRE_CATEGORY_ID ? "genre" : "tag";
  return "tag";
}

/** The CSS value for a facet's colour — a var(), so it follows the theme. */
export function facetColorVar(f: FacetLike): string {
  return `var(--color-facet-${facetClassOf(f)})`;
}

/**
 * The DARK-theme hex for each class. Use `facetColorVar`/`facetChipStyle` for
 * anything rendered — those retheme; this does not.
 *
 * This exists for the places a CSS variable can't reach: a value being STORED
 * (tag_category.color, which the schema requires as #rrggbb), an OG image, a
 * canvas. Must stay in sync with globals.css's dark `--color-facet-*` block.
 */
export const FACET_HEX: Record<FacetClass, string> = {
  person: "#E0B15C",
  genre: "#C8A24B",
  tag: "#AC9A72",
  company: "#C08152",
};

/** The stored-value hex for a tag category (genre gets its own; the rest share). */
export function tagCategoryHex(categoryId: string): string {
  return categoryId === GENRE_CATEGORY_ID ? FACET_HEX.genre : FACET_HEX.tag;
}

/** Same, from a class you already resolved. */
export function facetClassColor(cls: FacetClass): string {
  return `var(--color-facet-${cls})`;
}

/**
 * Chip style: a tinted fill plus the colour as text.
 *
 * Every call site used to build the fill by string-concatenating an alpha suffix
 * onto a hex literal (`${color}22`), which is exactly why the colours couldn't
 * become tokens — a `var(...)` has no hex to append to. `color-mix()` does the
 * same job on any colour value, so the tint follows the theme too.
 *
 * `tint` is the fill's percentage (13% ≈ the old `22` suffix, 12% ≈ `1f`).
 */
export function facetChipStyle(f: FacetLike, tint = 13): { background: string; color: string } {
  const c = facetColorVar(f);
  return { background: `color-mix(in srgb, ${c} ${tint}%, transparent)`, color: c };
}

/** Chip style from an already-resolved class (grouped renderers). */
export function facetClassChipStyle(cls: FacetClass, tint = 13): { background: string; color: string } {
  const c = facetClassColor(cls);
  return { background: `color-mix(in srgb, ${c} ${tint}%, transparent)`, color: c };
}

/**
 * Neutral colour for the non-facet chip groups that render alongside tags
 * (Platforms, Modes & perspective). Not a facet class — these aren't scored and
 * aren't navigable — so they stay on secondary text rather than taking a fifth
 * colour.
 */
export const NON_FACET_COLOR = "var(--color-text-secondary)";
export function nonFacetChipStyle(tint = 12): { background: string; color: string } {
  return { background: `color-mix(in srgb, ${NON_FACET_COLOR} ${tint}%, transparent)`, color: NON_FACET_COLOR };
}
