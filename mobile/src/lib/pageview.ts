// The pageview beacon, from the app's web build on fandex.org. One small POST
// per page opened: the path and where the visit came from. The Worker keeps a
// daily total per KIND of page and nothing that identifies anybody
// (worker/src/telemetry.ts, and the privacy policy's "Usage statistics").
//
// ⚠️ The website only. The Android app sends nothing: its requests carry no
// Origin, the Worker would file each one under "crawler", and the policy says
// the app is not counted. A local dev server is not the website either.

import { Platform } from 'react-native';
import { api } from '~/lib/api';
import { API_URL } from '~/lib/config';

/** The website build is the one whose API address is its own origin. */
const onWebsite = Platform.OS === 'web' && API_URL === '';

let last: string | null = null;

export function sendPageview(pathname: string): void {
  if (!onWebsite || typeof window === 'undefined' || pathname === last) return;
  const first = last === null;
  const previous = last;
  last = pathname;
  // A static title page counts itself before the app starts on it (mobile/web/
  // build.mjs). The app's first view of that same address is the same visit.
  const counted = (window as unknown as { __fxpv?: string }).__fxpv;
  if (first && counted === pathname) return;
  // After the first page, the referrer is the page you came from, inside Fandex.
  const ref = first ? document.referrer : `${window.location.origin}${previous}`;
  void api.pageview(pathname, ref).catch(() => { /* a count that did not arrive is not worth a word */ });
}
