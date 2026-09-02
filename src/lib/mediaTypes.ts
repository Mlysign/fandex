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
 * The types a list should actually show: the chip selection where there is one,
 * the account's DEFAULT where there isn't.
 *
 * This is the single place the two ideas meet, and every list surface should use
 * it rather than re-deriving. `activeTypes.length === 0` has always meant "not
 * narrowed" across Home, Discover, Calendar and MyStuff (they share one
 * `rr_type_filter` key), and the setting decides what "not narrowed" resolves to.
 *
 * ⚠️ **The setting is a DEFAULT, not a scope** (Nils, 2026-09-02: "i dont want to
 * hide the games filter here, just set the default to my pref"). An explicit chip
 * selection WINS OUTRIGHT, including one naming a type the setting turns off:
 * tapping Games has to show games, or the chip is a control that lies.
 *
 * That is a reversal, and deleting `narrowTypeFilter` is what makes the old
 * shape unrepresentable rather than merely unused. Its job was guarding a stale
 * chip selection naming a now-hidden type, which could filter a list to nothing
 * with no visible control to undo it. **That trap is gone because the chip row
 * now renders every type**, so the control to undo it is always on screen. The
 * guard and the hiding were two halves of one design; removing one without the
 * other would leave a list that cannot be un-emptied.
 *
 * ⚠️ `rr_type_filter` is **sessionStorage**, so an explicit selection lasts the
 * browser session and a genuinely new visit falls back to the default. That is
 * what makes "every new visit has games off" true without freezing the chip.
 */
export function visibleTypes(
  active: readonly string[],
  stored: readonly string[] | null | undefined
): MediaType[] {
  const explicit = sanitizeMediaTypes(active);
  return explicit.length > 0 ? explicit : enabledMediaTypes(stored);
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
