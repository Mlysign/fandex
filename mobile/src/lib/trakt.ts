// Trakt, from the device. Sign-in here, and later the library sync.
//
// Two flows, neither needing the client secret (optional for clients since
// 2026-10-01):
//
//   the BROWSER flow   the Android app's default. Trakt's consent page opens in
//                      a browser tab and hands a code back to the app through
//                      its own address (fandex://auth/trakt). One tap for
//                      somebody already signed in to Trakt. That address has to
//                      be listed as a redirect URI on the Trakt app.
//   the DEVICE flow    the fallback, and what the web build uses. The app shows
//                      a short code, the person confirms it at trakt.tv, and
//                      the app polls until Trakt says yes. It needs no redirect.
//
// Probed against the live API with this app's client id on 2026-10-04:
// /oauth/device/code answers 200 with an 8-character code, a 600 s lifetime and
// a 6 s poll interval; /oauth/device/token without a secret answers 400 while
// the code is unapproved, which is "pending" and not a refusal; and a browser on
// another origin is allowed to make both calls.
//
// The tokens stay on this device (docs/decisions.md, 2026-10-04). The Worker
// sees the access token once, to learn whose it is, and does not keep it.

import * as Crypto from 'expo-crypto';
import { TRAKT_CLIENT_ID } from '~/lib/config';
import { secretDelete, secretGet, secretSet } from '~/lib/storage';

const BASE = 'https://api.trakt.tv';
const TOKENS_KEY = 'fandex.trakt.tokens';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds until the code stops working. */
  expiresIn: number;
  /** Seconds to wait between polls. Polling faster gets a 429. */
  interval: number;
}

export interface TraktTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds. */
  expiresAt: number;
}

export type PollResult =
  | { state: 'approved'; tokens: TraktTokens }
  | { state: 'pending' }
  | { state: 'slow-down' }
  | { state: 'denied' }
  | { state: 'expired' };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Where Trakt sends the person back to. Must match a redirect URI on the Trakt app exactly. */
export const TRAKT_REDIRECT_URI = 'fandex://auth/trakt';

function tokensFrom(d: Record<string, unknown>): TraktTokens {
  if (typeof d.access_token !== 'string') throw new Error('Trakt approved the sign-in but sent no token.');
  const created = typeof d.created_at === 'number' ? d.created_at : Math.floor(Date.now() / 1000);
  const lifetime = typeof d.expires_in === 'number' ? d.expires_in : 86_400;
  return {
    accessToken: d.access_token,
    refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : null,
    expiresAt: created + lifetime,
  };
}

const base64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomToken(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BrowserSignIn {
  /** The Trakt consent page to open. */
  url: string;
  /** Echoed back by Trakt. A redirect carrying a different one was not started here. */
  state: string;
  /** PKCE: proves at the exchange that the app that asked is the app that came back. */
  verifier: string;
}

export async function startBrowserSignIn(): Promise<BrowserSignIn> {
  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = base64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }),
  );
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: TRAKT_CLIENT_ID,
    redirect_uri: TRAKT_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `https://trakt.tv/oauth/authorize?${q.toString()}`, state, verifier };
}

/**
 * Read the address Trakt sent the person back to. Null means the redirect is
 * not one this sign-in started, or carries no code: nothing is exchanged.
 */
export function codeFromRedirect(url: string, state: string): string | null {
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  if (params.get('state') !== state) return null;
  return params.get('code');
}

export async function exchangeCode(code: string, verifier: string): Promise<TraktTokens> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      code,
      client_id: TRAKT_CLIENT_ID,
      redirect_uri: TRAKT_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Trakt would not finish the sign-in (${res.status}).`);
  return tokensFrom((await res.json()) as Record<string, unknown>);
}

/** The activation page with the code already filled in, so nobody has to type it. */
export function activationUrl(code: { verificationUrl: string; userCode: string }): string {
  return `${code.verificationUrl.replace(/\/+$/, '')}/${encodeURIComponent(code.userCode)}`;
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch(`${BASE}/oauth/device/code`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ client_id: TRAKT_CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`Trakt would not start a sign-in (${res.status}).`);
  const d = (await res.json()) as Record<string, unknown>;
  if (typeof d.device_code !== 'string' || typeof d.user_code !== 'string') {
    throw new Error('Trakt answered without a code.');
  }
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUrl: typeof d.verification_url === 'string' ? d.verification_url : 'https://trakt.tv/activate',
    expiresIn: typeof d.expires_in === 'number' ? d.expires_in : 600,
    interval: typeof d.interval === 'number' ? d.interval : 5,
  };
}

/**
 * Ask once whether the code has been approved. Trakt says which with the
 * status code alone: 200 yes, 400 not yet, 429 too fast, 418 the person said
 * no, 404 / 409 / 410 the code is unknown, used or expired.
 */
export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  const res = await fetch(`${BASE}/oauth/device/token`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ code: deviceCode, client_id: TRAKT_CLIENT_ID }),
  });
  if (res.status === 200) {
    return { state: 'approved', tokens: tokensFrom((await res.json()) as Record<string, unknown>) };
  }
  if (res.status === 400) return { state: 'pending' };
  if (res.status === 429) return { state: 'slow-down' };
  if (res.status === 418) return { state: 'denied' };
  if (res.status === 404 || res.status === 409 || res.status === 410) return { state: 'expired' };
  throw new Error(`Trakt answered ${res.status} while waiting for the sign-in.`);
}

export async function saveTraktTokens(tokens: TraktTokens): Promise<void> {
  await secretSet(TOKENS_KEY, JSON.stringify(tokens));
}

export async function loadTraktTokens(): Promise<TraktTokens | null> {
  const raw = await secretGet(TOKENS_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as TraktTokens;
    return typeof t.accessToken === 'string' && typeof t.expiresAt === 'number' ? t : null;
  } catch {
    return null;
  }
}

export async function clearTraktTokens(): Promise<void> {
  await secretDelete(TOKENS_KEY);
}
