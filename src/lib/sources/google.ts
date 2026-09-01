import { httpFetch } from "@/lib/http";

// Google Sign-In (2026-09-01) — an IDENTITY-ONLY provider.
//
// Every other entry in this folder is a MediaSource: it fetches titles, projects
// them, and has a sync adapter. Google has none of that and never will. It sits
// here because it is a third-party integration and this is where those live, but
// it is deliberately absent from `SOURCES` (lib/sources/registry.ts), which is
// what keeps it out of `providerQueue` and therefore out of every sync path.
//
// WHY IT EXISTS: the other four login options are Trakt, Steam, TMDB and RAWG.
// Two of those are accounts essentially only developers hold, one is games-only,
// and one asks a stranger to type a different site's password into fandex.org.
// A visitor who just likes films and games had no door at all.
//
// WHAT WE STORE: the Google `sub` (a stable, opaque per-app user id) and the
// display name. No email is requested and none is stored — see SCOPES below.

// ── Config, read at CALL time, never at module load ──────────────────────────
// AGENTS.md: "A SAFETY GATE read at module load is a gate nothing tests." Three
// shipped that way in one session and all three had a test asserting the default
// instead of the behaviour, because setting the env var in a test does nothing
// after the module has been loaded. The sibling modules here (trakt.ts) capture
// theirs in a module-level const; this one deliberately does not.
// NEXT_PUBLIC_, deliberately, and it is the ONE id — there is no server-only
// twin. A Google client id is public by construction: it rides in the query
// string of the consent URL every user's browser follows. Making it the same
// variable on both sides means the sign-in BUTTON and the sign-in ROUTE can
// never disagree about whether Google is configured, which two vars holding the
// same value would eventually do. Only the secret is server-only.
//
// ⚠️ Being NEXT_PUBLIC_ it must be declared as an `ARG` in the Dockerfile, or
// the client half reads it as undefined while the server half works fine — the
// exact half-live failure that bit NEXT_PUBLIC_SUPPORT_URL.
// → memory: next-public-env-needs-dockerfile-arg
function clientId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null;
}

function clientSecret(): string | null {
  return process.env.GOOGLE_CLIENT_SECRET || null;
}

/** Both halves present. The auth routes 404 rather than half-start a flow. */
export function googleConfigured(): boolean {
  return !!clientId() && !!clientSecret();
}

// Derived from the public origin rather than carried in its own env var, so
// there is no second value to keep in sync with the Google Cloud console (the
// TMDB route derives its callback the same way). Google requires an EXACT match
// against the "Authorized redirect URI" registered there, so whatever
// NEXT_PUBLIC_BASE_URL is at runtime must be the origin registered with Google.
//
// ⚠️ Read at request time from the passed-in base, NOT from process.env at module
// load: Railway's build-phase env differs from its runtime env, and a value
// baked in at build time is wrong permanently and silently.
// → memory: railway-build-vs-runtime-env
export function googleRedirectUri(base: string): string {
  return new URL("/api/auth/google/callback", base).toString();
}

// `openid profile` and NOT `email`, on purpose.
//
// The `sub` claim is what identifies the account, and it is stable and unique
// per app without the email. Requesting the email would mean holding a new
// category of personal data (a GDPR question, a line in the privacy policy, and
// a hand-written block in /api/account/export, whose column lists are explicit)
// in exchange for nothing this app does. It also keeps the `users` table
// identity-less, which is how db.ts describes it.
//
// This is one string away from reversing if a future feature needs the address.
const SCOPES = "openid profile";

/**
 * The consent-screen URL to send the browser to.
 *
 * `state` is a pure CSRF nonce, verified against an httpOnly cookie on callback
 * (see lib/oauthState.ts). The link target is derived from the SESSION at
 * callback time and is deliberately not encoded here, because a client-supplied
 * userId cannot be trusted.
 */
export function getGoogleAuthUrl(state: string, base: string): string {
  const p = new URLSearchParams({
    client_id: clientId() ?? "",
    redirect_uri: googleRedirectUri(base),
    response_type: "code",
    scope: SCOPES,
    state,
    // Show the account chooser instead of silently reusing whichever Google
    // account the browser happens to be signed into. On a shared or
    // multi-account browser, being logged in as the wrong person without being
    // asked is worse than one extra click.
    prompt: "select_account",
    // Online, so Google issues NO refresh token. We never call a Google API
    // after login, so a long-lived credential at rest would be a liability with
    // no corresponding benefit. See the empty accessToken in the callback.
    access_type: "online",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

/**
 * Exchange the one-time code for an access token.
 *
 * Deliberately NOT `appScopedAuth: true`, though it carries the client secret.
 * A 401/403 here is far more likely to mean the user's code was expired, reused
 * or cancelled than that our credentials died, and the latch's own rule is that
 * counting a user-scoped failure would let one bad code open the breaker for
 * everybody. Same reasoning that keeps TMDB's /authentication/ handshake out of
 * it. → AGENTS.md, "Providers, caching, and cost"
 */
export async function exchangeGoogleCode(code: string, base: string): Promise<GoogleTokenResponse> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("Google sign-in is not configured");

  const res = await httpFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: googleRedirectUri(base),
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${b}`);
  }
  return res.json();
}

export interface GoogleUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  picture?: string;
}

/**
 * Read the profile behind an access token.
 *
 * The token response also carries an `id_token` holding these same claims, but
 * trusting that would mean verifying a JWT against Google's rotating JWKS. This
 * is one server-to-server TLS call to Google with a token we just received from
 * Google over another one, so it needs no signature checking to be sound, and it
 * has no key rotation to get wrong.
 */
export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await httpFetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  const info = (await res.json()) as GoogleUserInfo;
  // `sub` is the whole identity. Without it there is nothing to key the
  // user_identities row on, and a blank provider_user_id would collide with
  // every other blank one under the UNIQUE(provider, provider_user_id) index —
  // which would silently hand the first such account to every later visitor.
  if (!info?.sub) throw new Error("Google userinfo returned no subject id");
  return info;
}
