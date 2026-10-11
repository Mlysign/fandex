// Turning "the client says it is somebody" into a provider user id we trust.
//
// The Next app did this with a server-side code exchange: it held each
// provider's client secret and traded an authorization code for a profile. The
// app and the web client hold no secret, so here the client signs in with the
// provider ITSELF and hands over the result, and this file's whole job is to
// check that result with the provider before believing it.
//
//   Google  the client sends an ID token. It is a JWT signed by Google, so it is
//           verified against Google's published keys, with the audience pinned
//           to OUR client id. No call to Google beyond fetching the keys. The
//           client also sends the secret whose hash it had Google write into
//           the token, which is what ties the token to the browser that asked.
//   Trakt   the client sends its access token. It is opaque, so the only way to
//           learn whose it is is to ask Trakt. The token is used for that one
//           request and is never stored: Trakt tokens live on the device
//           (docs/decisions.md, 2026-10-04).

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env";

/** What a provider vouched for. `providerUserId` is the identity; the rest is display. */
export interface VerifiedIdentity {
  provider: "google" | "trakt";
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class IdentityRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityRejected";
  }
}

// ── Google ───────────────────────────────────────────────────────────────────

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// jose caches the fetched key set inside this closure and refetches on an
// unknown key id, which is how Google's rotation is followed. Per isolate.
let googleKeys: JWTVerifyGetKey | null = null;
function googleKeySet(): JWTVerifyGetKey {
  return (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));
}

export function googleClientIds(env: Env): string[] {
  return (env.GOOGLE_CLIENT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** What a client may send as its secret: long enough to be unguessable, and nothing that needs escaping. */
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43,128}$/;

/** base64url(SHA-256(secret)): what the client asked Google to write into the token. */
export async function nonceHash(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Verify a Google ID token.
 *
 * ⚠️ The AUDIENCE check is the one that matters. A Google ID token is a valid,
 * Google-signed statement about a user for whichever app requested it. Without
 * pinning `aud` to our own client id, a token a user gave to ANY other site
 * using Google sign-in would log that site's operator into the user's Fandex
 * account. An empty configured list therefore rejects everything rather than
 * accepting anything.
 *
 * ⚠️ The NONCE check is the second one, and it is not optional. The token comes
 * back from Google in the address the browser is sent to, so it can be read by
 * whatever else sees that address, and a token is good for an hour. The client
 * therefore makes a secret before it leaves, has Google put the secret's
 * SHA-256 in the token (`nonce`), and sends the secret itself here. A token
 * without its secret is refused, which also covers a token planted in
 * somebody's browser to sign them in to the wrong account: that browser holds
 * no secret for it.
 *
 * `keys` is injectable so the tests can sign with a local key instead of
 * needing Google.
 */
export async function verifyGoogleIdToken(
  env: Env,
  idToken: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeySet(),
): Promise<VerifiedIdentity> {
  const audience = googleClientIds(env);
  if (!audience.length) throw new IdentityRejected("Google sign-in is not configured");
  if (!NONCE_SHAPE.test(nonce)) throw new IdentityRejected("Google sign-in carries no usable nonce");
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience,
      algorithms: ["RS256"],
    }));
  } catch (e) {
    throw new IdentityRejected(`Google ID token rejected: ${e instanceof Error ? e.message : "invalid"}`);
  }
  if (typeof payload.nonce !== "string" || payload.nonce !== (await nonceHash(nonce))) {
    throw new IdentityRejected("Google ID token was not issued for this sign-in");
  }
  // `sub` is the whole identity. A blank one would collide with every other
  // blank one under the identity table's primary key and hand the first such
  // account to every later visitor.
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) throw new IdentityRejected("Google ID token carries no subject");
  return {
    provider: "google",
    providerUserId: sub,
    displayName: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}

// ── Trakt ────────────────────────────────────────────────────────────────────

const TRAKT_ME_URL = "https://api.trakt.tv/users/me";

/**
 * Ask Trakt whose access token this is.
 *
 * The request carries OUR client id in `trakt-api-key`. That header is half of
 * the check: Trakt ties a token to the app it was issued to, so a token minted
 * for some other Trakt app is refused here rather than accepted as a login.
 *
 * The identity is the Trakt USERNAME, because that is what the Railway site
 * stored (`/users/me` → `username`) and the seeded identity row has to keep
 * matching the same person.
 */
export async function verifyTraktToken(
  env: Env,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedIdentity> {
  if (!env.TRAKT_CLIENT_ID) throw new IdentityRejected("Trakt sign-in is not configured");
  if (!accessToken || accessToken.length > 512 || /\s/.test(accessToken)) {
    throw new IdentityRejected("Trakt token is malformed");
  }
  let res: Response;
  try {
    res = await fetchImpl(TRAKT_ME_URL, {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": env.TRAKT_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Fandex/1.0 (+https://fandex.org)",
      },
    });
  } catch (e) {
    throw new Error(`Trakt is unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401 || res.status === 403) throw new IdentityRejected(`Trakt refused the token (${res.status})`);
  if (!res.ok) throw new Error(`Trakt answered ${res.status}`);
  const me = (await res.json()) as { username?: unknown; name?: unknown; images?: { avatar?: { full?: unknown } } };
  const username = typeof me?.username === "string" ? me.username.trim() : "";
  if (!username) throw new IdentityRejected("Trakt returned no username");
  return {
    provider: "trakt",
    providerUserId: username,
    displayName: typeof me.name === "string" && me.name.trim() ? me.name : username,
    avatarUrl: typeof me.images?.avatar?.full === "string" ? me.images.avatar.full : null,
  };
}
