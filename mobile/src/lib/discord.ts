// Discord. Sign-in only: Discord holds no library. Back since 2026-10-17 (the
// Railway site had it; the new stack did not).
//
// Discord's implicit grant, scope `identify`: the page (or, on a phone, a
// browser sheet) goes to Discord, the person says yes, and Discord sends it back
// with an access token after the `#`. The Worker asks Discord whose token it is
// and which app it was issued to, and refuses one issued to any other app
// (worker/src/auth/verify.ts). No client secret exists on either side.
//
// The token in the address is what `state` protects: it is made here, kept in
// this tab (or this sign-in, on a phone), and a return carrying another is not
// used. That stops a token planted in somebody's browser from signing them in to
// the planter's account.
//
// Discord sends back only to addresses listed on the application, exactly:
// https://fandex.org/auth/discord, http://localhost:8081/auth/discord and
// fandex://auth/discord. Until those are listed the button stays hidden: a
// build without EXPO_PUBLIC_DISCORD_CLIENT_ID has none (docs/app.md).

import * as Crypto from 'expo-crypto';
import { DISCORD_CLIENT_ID } from '~/lib/config';
import { safeReturnPath } from '~/lib/google';

export const DISCORD_RETURN_PATH = '/auth/discord';
/** Where the phone's browser sheet returns to in the end. */
export const DISCORD_APP_REDIRECT = 'fandex://auth/discord';
/**
 * Where Discord sends the PHONE's sign-in: the site, which passes it on to the
 * app. Discord gives an implicit-grant token only to an https address: sent to
 * fandex://auth/discord it answered "Redirect URI is not supported by client"
 * after the person had said yes (Nils, 2026-10-24), though the address is listed.
 */
export const DISCORD_SITE_REDIRECT = `https://fandex.org${DISCORD_RETURN_PATH}`;
/** A phone's `state` starts with this, which is how the site knows to pass the answer on. */
export const DISCORD_APP_STATE_PREFIX = 'app.';

/** The app address a return to the site belongs to, fragment and all, or null when it is the site's own. */
export function appReturnUrl(fragment: string): string | null {
  const bare = fragment.replace(/^#/, '');
  const state = new URLSearchParams(bare).get('state');
  return state?.startsWith(DISCORD_APP_STATE_PREFIX) ? `${DISCORD_APP_REDIRECT}#${bare}` : null;
}
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const PENDING_KEY = 'fandex.discord.pending';

export interface PendingDiscordSignIn {
  state: string;
  returnTo: string;
}

export type DiscordReturn =
  | { ok: true; accessToken: string; returnTo: string }
  | { ok: false; reason: 'declined' | 'unknown'; returnTo: string };

export function discordAvailable(): boolean {
  return DISCORD_CLIENT_ID.length > 0;
}

/** Discord's sign-in page for this app. */
export function discordAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'token',
    // Who you are, nothing else: no email, no servers, no messages.
    scope: 'identify',
    state: opts.state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/** Read what Discord sent back. `fragment` is the part of the address after `#`. */
export function readDiscordReturn(fragment: string, pending: PendingDiscordSignIn | null): DiscordReturn {
  const returnTo = safeReturnPath(pending?.returnTo);
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  if (!pending || !pending.state || params.get('state') !== pending.state) return { ok: false, reason: 'unknown', returnTo };
  if (params.get('error')) return { ok: false, reason: params.get('error') === 'access_denied' ? 'declined' : 'unknown', returnTo };
  const accessToken = params.get('access_token');
  if (!accessToken) return { ok: false, reason: 'unknown', returnTo };
  return { ok: true, accessToken, returnTo };
}

export function newState(): string {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── The browser's side ───────────────────────────────────────────────────────

/** The fragment this page was opened with, read before anything else runs (as lib/google.ts does). */
const OPENED_WITH = typeof window !== 'undefined' && window.location?.pathname === DISCORD_RETURN_PATH ? window.location.hash : '';

/**
 * A phone's sign-in that came back to the site: handed on to the app at once,
 * before anything else runs, and kept for the page's "Open the app" button in
 * case the browser wants a tap before it leaves for another app.
 */
export const APP_RETURN = OPENED_WITH ? appReturnUrl(OPENED_WITH) : null;
if (APP_RETURN) window.location.replace(APP_RETURN);

/** Leave for Discord. The page unloads, so this only returns if something went wrong first. */
export function startDiscordWebSignIn(returnTo: string): void {
  if (!discordAvailable()) throw new Error('Discord sign-in is not set up in this build.');
  const pending: PendingDiscordSignIn = { state: newState(), returnTo: safeReturnPath(returnTo) };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(discordAuthorizeUrl({ clientId: DISCORD_CLIENT_ID, redirectUri: `${window.location.origin}${DISCORD_RETURN_PATH}`, state: pending.state }));
}

/** What came back, read once. The token is taken out of the address bar and history before anything is sent. */
export function takeDiscordReturn(): DiscordReturn {
  let pending: PendingDiscordSignIn | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && typeof (parsed as PendingDiscordSignIn).state === 'string') {
      const p = parsed as PendingDiscordSignIn;
      pending = { state: p.state, returnTo: typeof p.returnTo === 'string' ? p.returnTo : '' };
    }
  } catch { /* No storage, or not ours: "nothing was started here". */ }
  const fragment = OPENED_WITH || window.location.hash;
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
  return readDiscordReturn(fragment, pending);
}
