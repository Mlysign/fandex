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
  provider: "google" | "trakt" | "discord";
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * The id this identity was stored under before a stable one was used: Trakt
   * identities were keyed by username until 2026-10-23. Sign-in moves a row
   * still keyed that way to `providerUserId` (signin.ts).
   */
  legacyProviderUserId?: string;
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

const TRAKT_ME_URL = "https://api.trakt.tv/users/settings";
const TRAKT_UUID = /^[0-9a-f-]{8,64}$/i;

/**
 * Ask Trakt whose access token this is.
 *
 * The request carries OUR client id in `trakt-api-key`. That header is half of
 * the check: Trakt ties a token to the app it was issued to, so a token minted
 * for some other Trakt app is refused here rather than accepted as a login.
 * ⚠️ That binding is Trakt's documented behaviour, not something a test here
 * can prove; it was never tried with another app's token.
 *
 * The identity is Trakt's `ids.uuid` from /users/settings. A username can
 * change, and a deleted account's username can be taken by somebody else, so
 * keying on it could sign a stranger into an old account. The Railway site
 * stored the USERNAME, so `legacyProviderUserId` carries it and sign-in moves
 * such a row to the uuid the first time its owner signs in. Without a uuid in
 * the answer the username is used, as before.
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
  type TraktUser = { username?: unknown; name?: unknown; ids?: { uuid?: unknown }; images?: { avatar?: { full?: unknown } } };
  const body = (await res.json()) as { user?: TraktUser } & TraktUser;
  // /users/settings nests the profile under `user`; /users/me does not.
  const me: TraktUser = body?.user ?? body;
  const username = typeof me?.username === "string" ? me.username.trim() : "";
  if (!username) throw new IdentityRejected("Trakt returned no username");
  const uuid = typeof me.ids?.uuid === "string" && TRAKT_UUID.test(me.ids.uuid) ? me.ids.uuid.toLowerCase() : null;
  return {
    provider: "trakt",
    providerUserId: uuid ?? username,
    ...(uuid ? { legacyProviderUserId: username } : {}),
    displayName: typeof me.name === "string" && me.name.trim() ? me.name : username,
    avatarUrl: typeof me.images?.avatar?.full === "string" ? me.images.avatar.full : null,
  };
}

// ── Discord ──────────────────────────────────────────────────────────────────

const DISCORD_AUTH_URL = "https://discord.com/api/v10/oauth2/@me";

/**
 * Ask Discord whose access token this is, and for which app it was issued.
 *
 * The client signs in with Discord's implicit grant (scope `identify`) and sends
 * the access token. `/oauth2/@me` answers with the application the token belongs
 * to as well as the user, and the APPLICATION check is the one that matters, as
 * the audience is for Google: a token somebody gave to another site that uses
 * Discord sign-in would otherwise sign that site's operator in as them here. No
 * client secret is involved anywhere (the Railway site's code exchange needed
 * one; this does not).
 *
 * The identity is Discord's user id, the snowflake, which is what the Railway
 * site stored. The token is used for this one request and never stored.
 */
export async function verifyDiscordToken(
  env: Env,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedIdentity> {
  const appId = (env.DISCORD_CLIENT_ID ?? "").trim();
  if (!appId) throw new IdentityRejected("Discord sign-in is not configured");
  if (!accessToken || accessToken.length > 512 || /\s/.test(accessToken)) {
    throw new IdentityRejected("Discord token is malformed");
  }
  let res: Response;
  try {
    res = await fetchImpl(DISCORD_AUTH_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Fandex/1.0 (+https://fandex.org)" },
    });
  } catch (e) {
    throw new Error(`Discord is unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401 || res.status === 403) throw new IdentityRejected(`Discord refused the token (${res.status})`);
  if (!res.ok) throw new Error(`Discord answered ${res.status}`);
  const info = (await res.json()) as {
    application?: { id?: unknown };
    scopes?: unknown;
    user?: { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown };
  };
  if (info?.application?.id !== appId) throw new IdentityRejected("Discord token was issued to another app");
  const id = typeof info.user?.id === "string" ? info.user.id.trim() : "";
  // A snowflake is digits. A blank or odd one must never become an identity.
  if (!/^\d{5,25}$/.test(id)) throw new IdentityRejected("Discord returned no user");
  const user = info.user!;
  const name = typeof user.global_name === "string" && user.global_name.trim()
    ? user.global_name
    : typeof user.username === "string" ? user.username : null;
  const avatar = typeof user.avatar === "string" && /^[a-z0-9_]+$/i.test(user.avatar)
    ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128`
    : null;
  return { provider: "discord", providerUserId: id, displayName: name, avatarUrl: avatar };
}
