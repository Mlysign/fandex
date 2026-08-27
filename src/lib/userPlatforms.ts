import { get, run } from "@/lib/db";
import { sanitizePlatformKeys } from "@/lib/platformKeys";

// Server-side read/write of "the platforms and services this account owns"
// (users.platforms, migration 24). Mirrors userCountry.ts's three-function
// shape: raw stored value, effective value, validated writer.
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

/** Persist the list (validated). Returns what was actually stored. */
export function setUserPlatforms(userId: string, keys: unknown): string[] {
  const clean = sanitizePlatformKeys(keys);
  // Store NULL rather than "[]" for the empty case so the column's two
  // "not configured" spellings collapse to one, and a row that was never
  // written looks the same as one that was cleared.
  run("UPDATE users SET platforms = ? WHERE id = ?", [clean.length ? JSON.stringify(clean) : null, userId]);
  return clean;
}
