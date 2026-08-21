import type { MediaType } from "@/types";
import { transliterate } from "@/lib/translit";

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
// `transliterate` covers the letters NFKD does NOT decompose ("ø" "ß" "ł"),
// which the `[^a-z0-9]` replace below would otherwise turn into a hyphen —
// "Tønne" → "t-nne". It only maps Latin stroked/ligature letters, so the
// non-Latin behaviour documented below is unchanged. → translit.ts
//
// Always returns a non-empty string: a title that is pure punctuation or
// non-Latin script (e.g. "君の名は。") would otherwise slugify to "", producing
// a `//` path that no longer matches the 3-segment route. The slug is cosmetic
// — the UUID resolves the page — so "untitled" is a safe floor.
export function slugify(title: string): string {
  const s = transliterate(
    title
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase(),
  )
    .replace(/['’]/g, "")  // keep contractions whole: "don't" → "dont"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");       // re-trim: the length cut can leave a trailing "-"
  return s || "untitled";
}

// ── The address: a stored, unique-per-type SLUG (2026-08-21) ────────────────
//
// `/movie/spider-man-brand-new-day`, not `/movie/<uuid>/spider-man-brand-new-day`.
//
// Nils: "does the url change? isnt that bad for SEO? can we get rid of the long
// random string?" Yes to the first, and that answer is why this changed rather
// than being prettified: the uuid is a ROW id, and a browsed-only row is deleted
// by the boot prune on every deploy. Re-opening the title minted a NEW row with a
// NEW uuid, so one film had two dead urls in a single afternoon.
//
// A title-derived slug survives that, because it names the WORK rather than our
// storage: prune the row, browse it again, and the recreated row lands on the
// same address. That is the fix for the 404 churn, not just a shorter url.
//
// The slug is STORED (media_items.slug, unique per type) rather than computed at
// read time, because of the collision the old note below is right about: 40 of
// 2,530 titles collide within a type on the real catalog, all genuine remakes
// (Dracula, Nosferatu, Godzilla, The Lion King). Computing it would send both
// Draculas to one page. Stored, first-come keeps the bare slug and the newcomer
// takes `-{year}` — see pickSlug.
//
// It is also IMMUTABLE once assigned, the opposite of the old cosmetic slug
// (which re-derived from the current title and canonical-redirected on drift). A
// url that moves when a provider retitles a film is a url you cannot share.

/** Bounded so a pathological title can't spin. Not reached in practice. */
const MAX_SLUG_ATTEMPTS = 50;

/**
 * The n-th candidate slug for a title. Deterministic, which is what makes a
 * pruned-then-recreated row land back on its own address.
 *
 *   0 → `dracula`
 *   1 → `dracula-1992`   (release year, when there is one)
 *   n → `dracula-1992-2` (same title AND same year: vanishingly rare)
 */
export function slugCandidate(title: string, releaseDate: string | null | undefined, attempt: number): string {
  const base = slugify(title ?? "untitled");
  if (attempt === 0) return base;
  const year = (releaseDate ?? "").slice(0, 4);
  const dated = /^[0-9]{4}$/.test(year) ? base + "-" + year : null;
  if (attempt === 1 && dated) return dated;
  return (dated ?? base) + "-" + attempt;
}

/**
 * The first candidate `isTaken` says is free. The lookup is injected so this
 * stays pure — the migration's backfill and the runtime insert path call the
 * same function against different db handles.
 */
export function pickSlug(
  title: string,
  releaseDate: string | null | undefined,
  isTaken: (slug: string) => boolean
): string {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = slugCandidate(title, releaseDate, attempt);
    if (!isTaken(candidate)) return candidate;
  }
  return slugify(title ?? "untitled") + "-" + Date.now().toString(36);
}

// ── The LEGACY id segment: a UUID. ───────────────────────────────────────────
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
export function publicItemHref(item: { id: string; type: string; title?: string | null; slug?: string | null }): string {
  // The uuid form is still a live route and 308s to the slug, so an item whose
  // slug hasn't been threaded through a payload yet still links correctly — it
  // just costs a redirect hop. Never emit it when a slug is present.
  return item.slug
    ? `/${item.type}/${item.slug}`
    : `/${item.type}/${item.id}/${slugify(item.title ?? "untitled")}`;
}
