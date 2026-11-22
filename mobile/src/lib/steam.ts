// Connecting a Steam account.
//
// Steam signs people in with OpenID 2.0: the browser goes to Steam, the person
// says yes, and Steam sends the browser back to OUR page with a set of
// `openid.*` values in the address. This file builds the address to leave for,
// and reads what came back. The values are handed to the Worker unchanged,
// which asks Steam whether it issued them (worker/src/auth/verify.ts). There is
// no client id, no secret and no token anywhere in this.
//
// Steam is a connection, never a way in: the Worker refuses it without a
// session, so this is only ever offered to somebody who is signed in.
//
// The `state` is what ties an answer to the window that asked. It rides in the
// return address, which Steam signs, and it is compared twice: with the value
// in the address the page was opened with, and with the one inside the signed
// `openid.return_to`. An answer made for another window, or another person's
// answer pasted into a link, fails one of the two.

import * as Crypto from 'expo-crypto';
import { safeReturnPath } from '~/lib/google';

export const STEAM_RETURN_PATH = '/auth/steam';
/** Where the phone's browser sheet returns to in the end. */
export const STEAM_APP_REDIRECT = 'fandex://auth/steam';
/** The phone's sign-in comes back to the site, which passes it on to the app (as Discord's does). */
export const STEAM_SITE_ORIGIN = 'https://fandex.org';
/** A phone's `state` starts with this, which is how the site knows to pass the answer on. */
export const STEAM_APP_STATE_PREFIX = 'app.';
const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const PENDING_KEY = 'fandex.steam.pending';

export interface PendingSteamConnect {
  state: string;
  returnTo: string;
}

export type SteamReturn =
  | { ok: true; params: Record<string, string>; returnTo: string }
  | { ok: false; reason: 'declined' | 'unknown'; returnTo: string };

/** Steam's sign-in page, set to come back to `origin`'s return page. */
export function steamOpenIdUrl(opts: { origin: string; state: string }): string {
  const q = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${opts.origin}${STEAM_RETURN_PATH}?state=${encodeURIComponent(opts.state)}`,
    'openid.realm': opts.origin,
    // "Whoever signs in": Steam fills in the account.
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
  });
  return `${OPENID_ENDPOINT}?${q.toString()}`;
}

/** Read what Steam sent back. `query` is the part of the address after `?`. */
export function readSteamReturn(query: string, pending: PendingSteamConnect | null): SteamReturn {
  const returnTo = safeReturnPath(pending?.returnTo);
  const all = new URLSearchParams(query.replace(/^\?/, ''));
  const unknown: SteamReturn = { ok: false, reason: 'unknown', returnTo };
  if (!pending || !pending.state || all.get('state') !== pending.state) return unknown;
  const mode = all.get('openid.mode');
  if (mode === 'cancel') return { ok: false, reason: 'declined', returnTo };
  if (mode !== 'id_res') return unknown;
  // The state inside the address Steam signed, not only the one beside it.
  let signedState: string | null = null;
  try { signedState = new URL(all.get('openid.return_to') ?? '').searchParams.get('state'); } catch { return unknown; }
  if (signedState !== pending.state) return unknown;
  const params: Record<string, string> = {};
  all.forEach((value, key) => { if (key.startsWith('openid.')) params[key] = value; });
  return { ok: true, params, returnTo };
}

/** The app address a return to the site belongs to, query and all, or null when it is the site's own. */
export function appReturnUrl(query: string): string | null {
  const bare = query.replace(/^\?/, '');
  const state = new URLSearchParams(bare).get('state');
  return state?.startsWith(STEAM_APP_STATE_PREFIX) ? `${STEAM_APP_REDIRECT}?${bare}` : null;
}

export function newState(): string {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── The browser's side ───────────────────────────────────────────────────────

/** The query this page was opened with, read before anything else runs (as lib/discord.ts does). */
const OPENED_WITH = typeof window !== 'undefined' && window.location?.pathname === STEAM_RETURN_PATH ? window.location.search : '';

/**
 * A phone's connect that came back to the site: handed on to the app at once,
 * and kept for the page's "Open the app" button in case the browser wants a
 * tap before it leaves for another app.
 */
export const APP_RETURN = OPENED_WITH ? appReturnUrl(OPENED_WITH) : null;
if (APP_RETURN) window.location.replace(APP_RETURN);

/** Leave for Steam. The page unloads, so this only returns if something went wrong first. */
export function startSteamWebConnect(returnTo: string): void {
  const pending: PendingSteamConnect = { state: newState(), returnTo: safeReturnPath(returnTo) };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(steamOpenIdUrl({ origin: window.location.origin, state: pending.state }));
}

/** What came back, read once. Steam's answer is taken out of the address bar and history before anything is sent. */
export function takeSteamReturn(): SteamReturn {
  let pending: PendingSteamConnect | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && typeof (parsed as PendingSteamConnect).state === 'string') {
      const p = parsed as PendingSteamConnect;
      pending = { state: p.state, returnTo: typeof p.returnTo === 'string' ? p.returnTo : '' };
    }
  } catch { /* No storage, or not ours: "nothing was started here". */ }
  const query = OPENED_WITH || window.location.search;
  if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
  return readSteamReturn(query, pending);
}
