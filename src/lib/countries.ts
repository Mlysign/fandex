// Client-safe country data (no DB / server imports) so it can be used in client
// components (settings picker, browser auto-detect) AND server code. The DB-backed
// get/set live in userCountry.ts (server-only). T22.

export const DEFAULT_COUNTRY = "US";

// Curated common list (code → display name). Covers the vast majority of users +
// the regions TMDB actually has provider/release data for.
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "FR", name: "France" },
  { code: "BE", name: "Belgium" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "IT", name: "Italy" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czechia" },
  { code: "GR", name: "Greece" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "IN", name: "India" },
  { code: "ZA", name: "South Africa" },
];

const VALID = new Set(COUNTRIES.map((c) => c.code));

export function isSupportedCountry(code: string): boolean {
  return VALID.has(code);
}

// Normalize/validate an incoming code against the curated list. Returns null when
// it isn't one we offer (so callers can fall back rather than store junk).
export function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  return VALID.has(up) ? up : null;
}

// A browser whose language names no region ("de", not "de-DE") said nothing
// about its country, and the app fell back to the US (2026-10-23). The device's
// time zone names one for nearly everyone; mobile/src/lib/region.ts asks it next.
/** IANA time zone → the supported country it means. Only zones of countries in `COUNTRIES`. */
const ZONE_COUNTRY: Record<string, string> = {
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Busingen": "DE", "Europe/Vienna": "AT",
  "Europe/Zurich": "CH", "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Amsterdam": "NL", "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES", "Europe/Lisbon": "PT", "Europe/Rome": "IT", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Athens": "GR",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Halifax": "CA",
  "America/St_Johns": "CA", "America/Regina": "CA", "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Australia/Hobart": "AU", "Australia/Darwin": "AU", "Pacific/Auckland": "NZ",
  "America/Sao_Paulo": "BR", "America/Mexico_City": "MX", "America/Argentina/Buenos_Aires": "AR", "America/Buenos_Aires": "AR",
  "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Africa/Johannesburg": "ZA",
};

/** The country a time zone names, or null for one that names none we hold data for. */
export function countryOfTimeZone(zone: string | undefined | null): string | null {
  if (!zone) return null;
  if (ZONE_COUNTRY[zone]) return ZONE_COUNTRY[zone];
  // Every other US zone: America/Chicago, America/Denver, America/Los_Angeles, Pacific/Honolulu…
  if (/^(America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Detroit|Boise|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/Honolulu)$/.test(zone)) return "US";
  return null;
}
