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
