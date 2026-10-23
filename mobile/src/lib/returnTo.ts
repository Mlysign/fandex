// Where to go back to after signing in. A signed-out tap on Rate or Save sends
// you to You to sign in; this brings you back to the title afterwards, as the
// site did (H2c). In a browser it is kept for the tab, because Google's
// sign-in leaves the page and comes back to a fresh one; in the app a module
// variable lasts, since Trakt's sign-in returns to the running app.
//
// It lapses after fifteen minutes: somebody who wandered off and signs in an
// hour later should land where they are, not on a title from before.

import { Platform } from 'react-native';

const KEY = 'fandex.returnTo';
const TTL_MS = 15 * 60 * 1000;
let held: string | null = null;

// A browser reads "/\" as "//", another host, so no backslash anywhere (as google.ts's safeReturnPath).
const safe = (path: string | null | undefined) =>
  (path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : null);

/** Remember an address inside the app (it must start with "/"). */
export function setReturnTo(path: string): void {
  if (!safe(path)) return;
  held = `${Date.now()}|${path}`;
  if (Platform.OS === 'web') { try { globalThis.sessionStorage?.setItem(KEY, held); } catch { /* the module copy still works in this page */ } }
}

/** The address to go back to, once, if it is recent. */
export function takeReturnTo(now = Date.now()): string | null {
  let raw = held;
  if (Platform.OS === 'web') {
    try { raw = globalThis.sessionStorage?.getItem(KEY) ?? raw; globalThis.sessionStorage?.removeItem(KEY); } catch { /* use the module copy */ }
  }
  held = null;
  if (!raw) return null;
  const bar = raw.indexOf('|');
  const at = Number(raw.slice(0, bar));
  return Number.isFinite(at) && now - at < TTL_MS ? safe(raw.slice(bar + 1)) : null;
}
