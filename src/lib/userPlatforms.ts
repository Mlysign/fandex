import { get, run } from "@/lib/db";
import { sanitizePlatformKeys } from "@/lib/platformKeys";
import { sanitizeMediaTypes, MEDIA_TYPES } from "@/lib/mediaTypes";

// Server-side read/write of the two "what do you actually use" preferences that
// live on the users row: the platforms and services you own (users.platforms,
// migration 24) and the media types you use Fandex for (users.media_types,
// migration 25). Both mirror userCountry.ts's shape: raw stored value, a
// validated writer, and the interpretation of the default left to a leaf module.
//
// ⚠️ Both are DISPLAY preferences. Neither may reach a sync pull —
// `pruneWatchlist`/`pruneLibrary` read "absent from the pull" as "removed
// upstream", so filtering either one there deletes the user's rows.
//
// The keys themselves and their validation live in platformKeys.ts, which is a
// LEAF module with no imports so the client can use the same definitions. This
// file is the server-only half; keep the split (see countries.ts / userCountry.ts
// for the same pair).

/**
 * The stored list, or [] when the user has never set one.
 *
 * ⚠️ [] means NOT CONFIGURED and every consumer must read it that way — the
 * filter offers everything. "Owns nothing" is deliberately not expressible: it
 * is indistinguishable from the default in this column, and reading it as
 * "owns nothing" would empty the control for every user who never opens
 * settings. If it ever needs saying, it needs its own flag. See narrowToOwned().
 */
export function getUserPlatforms(userId: string): string[] {
  const row = get<{ platforms: string | null }>("SELECT platforms FROM users WHERE id = ?", [userId]);
  if (!row?.platforms) return [];
  try {
    // Sanitized on the way OUT as well as in: the column is plain TEXT, and a
    // hand-edited or half-migrated row should degrade to "not configured"
    // rather than putting a malformed key on the filter's hot path.
    return sanitizePlatformKeys(JSON.parse(row.platforms));
  } catch {
    return [];
  }
}

/**
 * The media types this account uses Fandex for, as stored ([] = not configured).
 *
 * ⚠️ Read it through `enabledMediaTypes()` before acting on it — [] means every
 * type, not none. This returns the raw stored value so the settings page can
 * tell "never configured" from "configured to everything".
 *
 * ⚠️ DISPLAY ONLY. Never let this reach a sync pull: `pruneWatchlist` and
 * `pruneLibrary` treat "absent from the pull" as "removed upstream", so
 * filtering a type out of a pull deletes every row of that type.
 */
export function getUserMediaTypes(userId: string): string[] {
  const row = get<{ media_types: string | null }>("SELECT media_types FROM users WHERE id = ?", [userId]);
  if (!row?.media_types) return [];
  try {
    return sanitizeMediaTypes(JSON.parse(row.media_types));
  } catch {
    return [];
  }
}

/**
 * Persist the media types (validated). Returns what was actually stored.
 *
 * ⚠️ Storing EVERY type is normalised to NULL, i.e. "not configured". They mean
 * the same thing to every reader, and collapsing them keeps one spelling of the
 * default rather than two that drift.
 */
export function setUserMediaTypes(userId: string, types: unknown): string[] {
  const clean = sanitizeMediaTypes(types);
  const store = clean.length > 0 && clean.length < MEDIA_TYPES.length ? JSON.stringify(clean) : null;
  run("UPDATE users SET media_types = ? WHERE id = ?", [store, userId]);
  return store ? clean : [];
}

/** Persist the list (validated). Returns what was actually stored. */
export function setUserPlatforms(userId: string, keys: unknown): string[] {
  const clean = sanitizePlatformKeys(keys);
  // Store NULL rather than "[]" for the empty case so the column's two
  // "not configured" spellings collapse to one, and a row that was never
  // written looks the same as one that was cleared.
  run("UPDATE users SET platforms = ? WHERE id = ?", [clean.length ? JSON.stringify(clean) : null, userId]);
  return clean;
}
