import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";

// Best-effort country from browser signals — no geolocation permission prompt.
// Tries the locale region subtag first (en-US → US, de-DE → DE), then a coarse
// timezone → country map, then falls back to US. Used to pre-set users.country on
// first visit (the user can override it in settings). T22.

const TZ_COUNTRY: Record<string, string> = {
  "Europe/Berlin": "DE", "Europe/Vienna": "AT", "Europe/Zurich": "CH",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR",
  "Europe/Brussels": "BE", "Europe/Amsterdam": "NL", "Europe/Madrid": "ES",
  "Europe/Lisbon": "PT", "Europe/Rome": "IT", "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI",
  "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Athens": "GR",
  "America/Toronto": "CA", "America/Vancouver": "CA",
  "America/Sao_Paulo": "BR", "America/Mexico_City": "MX",
  "America/Argentina/Buenos_Aires": "AR",
  "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Kolkata": "IN",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "Pacific/Auckland": "NZ", "Africa/Johannesburg": "ZA",
};

export function detectCountry(): string {
  // 1. Locale region subtag(s).
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const region = lang?.split("-")[1];
      const c = normalizeCountry(region);
      if (c) return c;
    }
  } catch { /* SSR / no navigator */ }
  // 2. Timezone → country.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const c = normalizeCountry(TZ_COUNTRY[tz]);
    if (c) return c;
  } catch { /* no Intl */ }
  return DEFAULT_COUNTRY;
}
