import { get, run } from "@/lib/db";
import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";

// T22 — server-side read/write of the user's country (users.country, migration
// v5). The curated list + validation are client-safe in countries.ts.

// The raw stored country, or null when the user hasn't set one (the client uses
// null to mean "auto-detect from the browser and persist on first visit").
export function getStoredCountry(userId: string): string | null {
  const row = get<{ country: string | null }>("SELECT country FROM users WHERE id = ?", [userId]);
  return normalizeCountry(row?.country);
}

// The user's effective country for region-aware merges (stored value, else US).
export function getUserCountry(userId: string): string {
  return getStoredCountry(userId) ?? DEFAULT_COUNTRY;
}

// Persist the user's country (validated). Returns the stored code, or null on an
// unknown code (caller should reject).
export function setUserCountry(userId: string, code: string): string | null {
  const c = normalizeCountry(code);
  if (!c) return null;
  run("UPDATE users SET country = ? WHERE id = ?", [c, userId]);
  return c;
}
