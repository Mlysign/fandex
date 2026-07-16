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
// Flipping this to TRUE is the whole "turn on SEO" step (TASKS.md P13b): it
// drops the noindex and puts all ~2,500 items back in the sitemap. Nothing else
// needs to change — robots.txt already allows /movie/ /show/ /game/, which it
// MUST even while this is false, because a crawler has to be able to FETCH a
// page to see its noindex (a robots.txt Disallow would hide the tag and could
// leave URL-only entries indexed from external links).
export const PUBLIC_ITEMS_INDEXABLE = false;

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

// ── The id segment: a UUID, or a source id for an item not in the DB yet ─────
//
// `/discover` renders LIVE provider results that have no media_items row (and so
// no UUID) — the row is only created when the item is wishlisted/rated/viewed by
// a logged-in user. For every page to link to the SAME url, the id slot must
// also accept `{source}-{sourceId}` (e.g. `tmdb-693134`).
//
// The UUID form stays canonical: once the item exists in the DB, the source-id
// url 308s to it, so an item still has exactly one indexable url.

export type ParsedItemId =
  | { kind: "uuid"; id: string }
  | { kind: "source"; source: string; sourceId: string };

// Sources an id can be addressed by. `igdb` is metadata-only (no MediaSource
// adapter) but discover surfaces igdb-keyed games, so it must resolve here.
const ID_SOURCES = ["tmdb", "rawg", "igdb", "trakt", "steam", "letterboxd"] as const;

export function parseItemId(seg: string): ParsedItemId | null {
  if (isUuid(seg)) return { kind: "uuid", id: seg };
  // `tmdb-693134`, `rawg-12345`, `igdb-99`. Discover also emits type-qualified
  // ids (`tmdb-movie-693134`); the type is already the first path segment, so
  // the middle part is dropped rather than trusted.
  const m = /^([a-z]+)-(?:movie-|show-|game-)?(\d+)$/.exec(seg);
  if (!m) return null;
  const [, source, sourceId] = m;
  if (!(ID_SOURCES as readonly string[]).includes(source)) return null;
  return { kind: "source", source, sourceId };
}

// The canonical href for an item that IS in the DB (has a UUID).
export function publicItemHref(item: { id: string; type: string; title?: string | null }): string {
  return `/${item.type}/${item.id}/${slugify(item.title ?? "untitled")}`;
}

// Href for anything linkable — a DB item (UUID) or a live discover result. Given
// a discover item, prefers its strongest source id. Falls back to the item's own
// id when it already parses (discover ids like `tmdb-movie-693134` do).
export function anyItemHref(item: {
  id: string;
  type: string;
  title?: string | null;
  ids?: Record<string, number | string | null | undefined>;
}): string {
  const slug = slugify(item.title ?? "untitled");
  if (isUuid(item.id)) return `/${item.type}/${item.id}/${slug}`;

  // Prefer a canonical, id-resolvable source over a title-searched one.
  for (const s of ID_SOURCES) {
    const v = item.ids?.[s];
    if (v != null && String(v).length) return `/${item.type}/${s}-${v}/${slug}`;
  }
  // Discover's own composite id (`tmdb-movie-693134`) already parses.
  return `/${item.type}/${item.id}/${slug}`;
}
