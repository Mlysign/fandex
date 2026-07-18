import { MediaType } from "@/types";

// P13 — public, shareable, crawlable item URLs: `/{type}/{uuid}/{slug}`
//
//   /movie/3f9a2b1c-77d4-4e21-9c3a-8b1e5d2f6a04/dune-part-two
//
// The UUID is the ONLY identity — the slug is cosmetic. That split is the whole
// point of the shape: titles change and collide (remakes, same-named games), so
// resolving on a slug would either break shared links or need a redirect table.
// Here a stale or wrong slug still resolves; the page just canonical-redirects
// to the current one, so old links keep working forever.
//
// Only 3-segment paths match this route, so it cannot collide with the 1-segment
// app routes (/dashboard, /library, …) or 2-segment ones (/insights/facet).

// ── The index switch ────────────────────────────────────────────────────────
// FALSE = soft launch: item pages are publicly READABLE and unfurl correctly
// when shared (WhatsApp/Discord/Slack read the OG tags), but they are NOT
// indexed — every page sends `noindex`, and sitemap.xml lists only "/". So the
// catalog is reachable by link without handing Google an enumeration of the
// owner's library.
//
// Flipped to TRUE 2026-07-19 (P13b, decision locked 2026-07-18): drops the
// noindex and puts the whole library back in the sitemap. robots.txt already
// allowed /movie/ /show/ /game/ while this was false, because a crawler has to
// be able to FETCH a page to see its noindex (a robots.txt Disallow would hide
// the tag and could leave URL-only entries indexed from external links).
export const PUBLIC_ITEMS_INDEXABLE = true;

export const PUBLIC_TYPES: MediaType[] = ["movie", "show", "game"];

export function isPublicType(t: string): t is MediaType {
  return (PUBLIC_TYPES as string[]).includes(t);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// Combining diacritical marks (U+0300–U+036F), left behind by NFKD decomposition.
// Built via RegExp so the source carries readable escapes instead of invisible
// combining characters, which editors and tooling love to mangle.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

// Title → URL slug. Decomposes then strips accents so "Amélie" → "amelie"
// rather than "amlie".
//
// Always returns a non-empty string: a title that is pure punctuation or
// non-Latin script (e.g. "君の名は。") would otherwise slugify to "", producing
// a `//` path that no longer matches the 3-segment route. The slug is cosmetic
// — the UUID resolves the page — so "untitled" is a safe floor.
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/['’]/g, "")  // keep contractions whole: "don't" → "dont"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");       // re-trim: the length cut can leave a trailing "-"
  return s || "untitled";
}

// ── The id segment: a UUID. That's the whole rule. ───────────────────────────
//
// It used to also accept `{source}-{sourceId}` (`tmdb-693134`), because
// /discover rendered LIVE provider results with no media_items row and so no
// uuid, and every page had to be able to link SOMEWHERE. That form dragged a
// parser, a live-resolution branch in resolvePublicDetail, create-on-view and
// its auth gate, and a second (non-canonical, unindexable) url per item behind
// it — all of it working around one gap: discover didn't persist.
//
// H2b closed the gap at the source. /api/discover writes a row for every item it
// returns and hands back the uuid, so an item HAS a uuid before anyone can click
// it, and all of that machinery was deleted. One url form, always canonical.
export function publicItemHref(item: { id: string; type: string; title?: string | null }): string {
  return `/${item.type}/${item.id}/${slugify(item.title ?? "untitled")}`;
}
