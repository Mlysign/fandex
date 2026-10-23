// Which country's release dates and streaming services to show.
//
// Until there is a signed-in preference to read, this is the device's own
// region, checked against the list of countries the catalog actually holds data
// for (the site's `countries.ts`, shared). A region outside that list falls
// back to the default rather than asking the Worker for one it will ignore.
//
// A browser set to a language with no region ("de", not "de-DE") names no
// country at all, and fell back to the US: US stores, next to an FSK rating
// (2026-10-23). The time zone is asked next. It names a country for nearly
// everyone, and a zone shared by several (Europe/Berlin is only Germany's;
// America/New_York is the US and Canada's) is read as its main one.

import { getLocales } from 'expo-localization';
import { countryOfTimeZone, DEFAULT_COUNTRY, normalizeCountry } from '@/lib/countries';

export function deviceRegion(): string {
  try {
    const locales = getLocales();
    for (const l of locales) {
      const code = normalizeCountry(l?.regionCode);
      if (code) return code;
    }
    return countryOfTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}
