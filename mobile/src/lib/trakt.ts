// Trakt, from the device. Sign-in here, and later the library sync.
//
// The flow is Trakt's DEVICE flow: the app asks for a short code, the person
// types it at trakt.tv/activate on any browser, and the app polls until Trakt
// says yes. It needs no redirect back into the app, so it works the same in the
// Android build and in a browser tab, and it needs no client secret (optional
// for clients since 2026-10-01).
//
// Probed against the live API with this app's client id on 2026-10-04:
// /oauth/device/code answers 200 with an 8-character code, a 600 s lifetime and
// a 6 s poll interval; /oauth/device/token without a secret answers 400 while
// the code is unapproved, which is "pending" and not a refusal; and a browser on
// another origin is allowed to make both calls.
//
// The tokens stay on this device (docs/decisions.md, 2026-10-04). The Worker
// sees the access token once, to learn whose it is, and does not keep it.

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
    const d = (await res.json()) as Record<string, unknown>;
    if (typeof d.access_token !== 'string') throw new Error('Trakt approved the sign-in but sent no token.');
    const created = typeof d.created_at === 'number' ? d.created_at : Math.floor(Date.now() / 1000);
    const lifetime = typeof d.expires_in === 'number' ? d.expires_in : 86_400;
    return {
      state: 'approved',
      tokens: {
        accessToken: d.access_token,
        refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : null,
        expiresAt: created + lifetime,
      },
    };
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
