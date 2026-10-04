// Which country's release dates and streaming services to show.
//
// Until there is a signed-in preference to read, this is the device's own
// region, checked against the list of countries the catalog actually holds data
// for (the site's `countries.ts`, shared). A region outside that list falls
// back to the default rather than asking the Worker for one it will ignore.

import { getLocales } from 'expo-localization';
import { DEFAULT_COUNTRY, normalizeCountry } from '@/lib/countries';

export function deviceRegion(): string {
  try {
    const code = getLocales()[0]?.regionCode;
    return normalizeCountry(code) ?? DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}
