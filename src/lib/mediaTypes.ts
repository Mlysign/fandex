import type { MediaType } from "@/types";

// The media types Fandex knows about, and which ones a given account uses.
//
// A LEAF module: one `import type`, which is erased, so a client component can
// use this without pulling `db.ts` into the browser bundle and standalone
// scripts can load it under plain node. Same rule as platformKeys.ts.
//
// ── Why the LABELS record is the source of truth, not the array ─────────────
// AGENTS.md records the cost of adding a media type: "`tsc` won't help you —
// only one `Record<MediaType, …>` exists, so adding a union member compiles
// clean while silently doing nothing at the other ~9 enumeration points."
//
// So the array is DERIVED from a `Record<MediaType, string>`. Adding "book" to
// the union now fails the build right here, at a place whose whole job is to
// enumerate types, instead of being discovered later as an empty filter chip.
// Every consumer that iterates types should read MEDIA_TYPES rather than
// writing `["game", "movie", "show"]` again.
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  game: "Games",
  movie: "Movies",
  show: "Shows",
};

/** Every type Fandex supports, in display order. */
export const MEDIA_TYPES = Object.keys(MEDIA_TYPE_LABELS) as MediaType[];

export function isMediaType(v: unknown): v is MediaType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MEDIA_TYPE_LABELS, v);
}

/** Clean a list arriving from a client: drop unknown and duplicate entries, keep order. */
export function sanitizeMediaTypes(input: unknown): MediaType[] {
  if (!Array.isArray(input)) return [];
  const out: MediaType[] = [];
  for (const v of input) {
    if (isMediaType(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The types this account actually uses.
 *
 * ⚠️ An EMPTY stored list means NOT CONFIGURED and yields ALL types, exactly as
 * `users.platforms` does. "Uses none of them" is deliberately not expressible:
 * it is indistinguishable from the default in the column, and it would leave a
 * user staring at an app with every list empty and no way to tell why.
 *
 * ⚠️ The UI must also refuse to save an empty selection for the same reason —
 * see the picker. This function is the second line of defence, not the first.
 */
export function enabledMediaTypes(stored: readonly string[] | null | undefined): MediaType[] {
  const clean = sanitizeMediaTypes(stored ?? []);
  return clean.length > 0 ? clean : [...MEDIA_TYPES];
}

/** Is this type one the account uses? Unknown types are never enabled. */
export function isTypeEnabled(type: string, stored: readonly string[] | null | undefined): boolean {
  return enabledMediaTypes(stored).includes(type as MediaType);
}

/**
 * Narrow an already-chosen type FILTER to the enabled set.
 *
 * The filter chips and this setting are two different things: the chips are
 * "show me only games right now", the setting is "I do not use Fandex for
 * games". A stale chip selection naming a now-disabled type would otherwise
 * filter every list to nothing with no visible control to undo it — the same
 * hidden-active-filter trap as the platform chips.
 */
export function narrowTypeFilter(
  active: readonly string[],
  stored: readonly string[] | null | undefined
): MediaType[] {
  const enabled = enabledMediaTypes(stored);
  return active.filter((t): t is MediaType => enabled.includes(t as MediaType));
}

/**
 * The types a list should actually show: the chip selection where there is one,
 * the enabled set where there isn't.
 *
 * This is the single place the two ideas meet, and every list surface should use
 * it rather than re-deriving. `activeTypes.length === 0` has always meant "all
 * types" across Home, Discover, Calendar and MyStuff (they share one
 * `rr_type_filter` key), and the setting redefines "all" as "all the ones you
 * use" without changing that convention.
 *
 * ⚠️ A selection consisting ENTIRELY of now-disabled types falls back to the
 * enabled set rather than to nothing. Turning games off while "games only" was
 * selected should leave you looking at your movies and shows, not at an empty
 * page whose only visible control is a chip row that no longer contains the
 * culprit.
 */
export function visibleTypes(
  active: readonly string[],
  stored: readonly string[] | null | undefined
): MediaType[] {
  const narrowed = narrowTypeFilter(active, stored);
  return narrowed.length > 0 ? narrowed : enabledMediaTypes(stored);
}

/**
 * Does this item's type belong on screen? The predicate every list filter wants.
 *
 * Cheap enough to call per item, and it keeps the "empty means all" rule in one
 * place instead of at each of the four call sites that used to spell it out.
 */
export function typeIsVisible(
  type: string,
  active: readonly string[],
  stored: readonly string[] | null | undefined
): boolean {
  return visibleTypes(active, stored).includes(type as MediaType);
}
