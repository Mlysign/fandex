import { FacetKind, FacetRole, tagKey, personKey, companyKey } from "@/lib/facets";

// P17 — public, shareable, readable facet URLs: `/{prefix}/{slug}`
//
//   /person/christopher-nolan
//   /tag/sci-fi
//   /studio/naughty-dog
//
// Unlike item URLs (`/{type}/{uuid}/{slug}`), a facet has no database identity —
// its identity IS its normalized name (the facet `key`). That's why NO uuid, id
// lookup or redirect table is needed here: the slug losslessly round-trips to the
// key.
//
// WHY IT'S LOSSLESS: every key normalizer in facets.ts (tagKey / personKey /
// companyKey) collapses input to `[a-z0-9]` plus single spaces, and NEVER emits a
// hyphen (tagKey turns `-_\s` runs into a space; person/company turn every
// non-alphanumeric run into a space). So `key <-> slug` is just spaces <-> hyphens,
// bijective. `keyToSlug(k)` then `slugToKey` returns `k` unchanged.
//
// ROLE IS DROPPED FROM THE URL ON PURPOSE. A person who is both director and
// writer used to be two role-scoped facets; the public page instead shows their
// FULL body of work with a per-title role badge, so one url per person/tag/studio
// is the whole story. `/studio` likewise folds every company role (studio /
// developer / publisher / network) into one page that unions the providers.

// kind → URL prefix. All company roles share `/studio`.
const KIND_PREFIX: Record<FacetKind, FacetPrefix> = {
  person: "person",
  tag: "tag",
  company: "studio",
};

// prefix → the facet kind the route resolves. `studio` maps back to `company`.
const PREFIX_KIND: Record<FacetPrefix, FacetKind> = {
  person: "person",
  tag: "tag",
  studio: "company",
};

export const FACET_PREFIXES = ["person", "tag", "studio"] as const;
export type FacetPrefix = (typeof FACET_PREFIXES)[number];

export function isFacetPrefix(s: string): s is FacetPrefix {
  return (FACET_PREFIXES as readonly string[]).includes(s);
}

export function prefixToKind(p: FacetPrefix): FacetKind {
  return PREFIX_KIND[p];
}

// The right key normalizer for a kind — so a caller can turn a raw display label
// into the canonical key without knowing which normalizer applies.
export function keyFor(kind: FacetKind, label: string): string {
  return kind === "person" ? personKey(label) : kind === "company" ? companyKey(label) : tagKey(label);
}

// key -> url slug. Keys carry no hyphens, so spaces -> hyphens is reversible.
// Then percent-encode: person/company keys are already `[a-z0-9 ]` so this is a
// no-op and the slug stays fully readable, but a TAG key can keep punctuation
// (`tagKey` only collapses separators — "point & click", "c#"), and a raw `&`/`#`
// in a path segment is unsafe. encodeURIComponent leaves `-` alone, so hyphens
// stay visible; slugToKey's decode inverts it. Guaranteed non-empty is the
// caller's concern: a facet with an empty key is not addressable and never
// reaches here (extractFacets drops `!f.key`).
export function keyToSlug(key: string): string {
  return encodeURIComponent(key.trim().replace(/\s+/g, "-"));
}

// url slug -> key. Inverse of keyToSlug: decode, lowercase, hyphen runs -> single
// space, trim. Lowercasing + collapsing means a hand-typed `/person/Christopher--Nolan`
// still resolves to the canonical key `christopher nolan`.
export function slugToKey(slug: string): string {
  let s = slug;
  try { s = decodeURIComponent(slug); } catch { /* malformed %-escape: use as-is */ }
  return s.toLowerCase().replace(/-+/g, " ").replace(/\s+/g, " ").trim();
}

// Build the public href for a facet. `role`/`label` are accepted so existing call
// sites (which carry the full facet) pass straight through, but only kind + key
// shape the url — the page always renders the combined, role-badged view.
export function publicFacetHref(f: { kind: FacetKind; role?: FacetRole; key: string; label?: string | null }): string {
  return `/${KIND_PREFIX[f.kind]}/${keyToSlug(f.key)}`;
}
