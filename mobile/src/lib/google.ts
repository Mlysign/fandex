// Google, from a browser. Sign-in only: Google holds no library.
//
// The whole page goes to Google and comes back, with no script of Google's on
// fandex.org and nothing sent to Google before the button is pressed:
//
//   1. The browser makes a secret and keeps it in this tab. Its SHA-256 goes to
//      Google as the `nonce`.
//   2. Google signs the person in and sends the tab back to /auth/google with
//      an ID token in the address, after the `#`. That part of an address is
//      never sent to a server. The token carries the nonce.
//   3. The return screen hands the token AND the secret to the Worker, which
//      checks Google's signature, that the token was issued to this app, and
//      that the secret hashes to the nonce (worker/src/auth/verify.ts).
//
// The secret is what makes step 2 safe. A token read out of the address by
// anything else is refused without it, and so is a token planted in this
// browser by somebody who wants it signed in to their account.
//
// The address Google sends back to has to be listed on the OAuth client, per
// origin: https://fandex.org/auth/google, and http://localhost:8081/auth/google
// for a developer's machine.
//
// Android is not here yet (docs/app.md): Google does not send a "Web" client
// back to an app's own address, so the phone needs its own client and a native
// module.

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { GOOGLE_CLIENT_ID } from '~/lib/config';

export const GOOGLE_RETURN_PATH = '/auth/google';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const PENDING_KEY = 'fandex.google.pending';

/** What the tab remembers while the person is at Google. */
export interface PendingGoogleSignIn {
  /** Echoed back by Google. A return carrying a different one was not started here. */
  state: string;
  /** The secret. Google is given its hash; the Worker is given this. */
  secret: string;
  /** The page to go back to afterwards. */
  returnTo: string;
}

export type GoogleReturn =
  | { ok: true; idToken: string; secret: string; returnTo: string }
  /** The person said no at Google, or closed the question. Not an error. */
  | { ok: false; reason: 'declined'; returnTo: string }
  /** Nothing in this tab started the sign-in that came back, or Google sent no token. */
  | { ok: false; reason: 'unknown'; returnTo: string };

/** Is there a Google button to show? Only in a browser, and only in a build that was given the client id. */
export function googleAvailable(): boolean {
  return Platform.OS === 'web' && GOOGLE_CLIENT_ID.length > 0;
}

/**
 * A page of this site to return to, or `/profile` for anything else. The value
 * sat in the tab's storage across a trip to another site, so it is read as
 * untrusted: one leading slash, no second one, no backslash, and never the
 * return screen itself.
 */
export function safeReturnPath(path: unknown): string {
  if (typeof path !== 'string' || !/^\/(?![/\\])/.test(path) || path.includes('\\')) return '/profile';
  if (path === GOOGLE_RETURN_PATH || path.startsWith(`${GOOGLE_RETURN_PATH}?`) || path.startsWith(`${GOOGLE_RETURN_PATH}#`)) return '/profile';
  return path;
}

/** Google's sign-in page for this app. `nonce` is the secret's hash, never the secret. */
export function googleAuthorizeUrl(opts: { clientId: string; origin: string; state: string; nonce: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: `${opts.origin}${GOOGLE_RETURN_PATH}`,
    // An ID token and nothing else: no access token, so nothing that can call a Google API.
    response_type: 'id_token',
    // No `email`. The token's subject is the identity (docs/decisions.md).
    scope: 'openid profile',
    state: opts.state,
    nonce: opts.nonce,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/**
 * Read what Google sent back. `fragment` is the part of the address after `#`.
 * `pending` is what this tab stored before leaving, or null if it stored nothing.
 */
export function readGoogleReturn(fragment: string, pending: PendingGoogleSignIn | null): GoogleReturn {
  const returnTo = safeReturnPath(pending?.returnTo);
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  if (!pending || !pending.state || params.get('state') !== pending.state) return { ok: false, reason: 'unknown', returnTo };
  if (params.get('error')) return { ok: false, reason: params.get('error') === 'access_denied' ? 'declined' : 'unknown', returnTo };
  const idToken = params.get('id_token');
  if (!idToken) return { ok: false, reason: 'unknown', returnTo };
  return { ok: true, idToken, secret: pending.secret, returnTo };
}

const base64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomToken(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── The browser's side ───────────────────────────────────────────────────────

/**
 * The fragment this page was opened with, read before anything else runs. The
 * return screen waits for the session to load first, and the address must not
 * be trusted to still carry the token by then.
 */
const OPENED_WITH = typeof window !== 'undefined' && window.location?.pathname === GOOGLE_RETURN_PATH ? window.location.hash : '';

/** Leave for Google. The page unloads, so this only returns if something went wrong first. */
export async function startGoogleSignIn(returnTo: string): Promise<void> {
  if (!googleAvailable()) throw new Error('Google sign-in is not set up in this build.');
  const pending: PendingGoogleSignIn = { state: randomToken(16), secret: randomToken(32), returnTo: safeReturnPath(returnTo) };
  const nonce = base64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pending.secret, { encoding: Crypto.CryptoEncoding.BASE64 }),
  );
  // sessionStorage: this tab only, and gone when it closes. A private window
  // that refuses storage cannot sign in this way, and says so here.
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(googleAuthorizeUrl({ clientId: GOOGLE_CLIENT_ID, origin: window.location.origin, state: pending.state, nonce }));
}

/**
 * What came back, read once. The stored secret is removed and the token is
 * taken out of the address bar and the tab's history before anything is sent.
 */
export function takeGoogleReturn(): GoogleReturn {
  let pending: PendingGoogleSignIn | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (typeof p.state === 'string' && typeof p.secret === 'string') {
        pending = { state: p.state, secret: p.secret, returnTo: typeof p.returnTo === 'string' ? p.returnTo : '' };
      }
    }
  } catch { /* No storage, or not ours: handled as "nothing was started here". */ }
  const fragment = OPENED_WITH || window.location.hash;
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
  return readGoogleReturn(fragment, pending);
}
