import { httpFetch } from "@/lib/http";

// Discord sign-in (2026-09-02) — the SECOND identity-only provider.
//
// Same shape as google.ts, and read that file's header first: Discord holds no
// library, has no sync adapter, and is deliberately absent from `SOURCES`
// (lib/sources/registry.ts), which is what keeps it out of `providerQueue` and
// therefore out of every sync path.
//
// WHY IT EXISTS: Nils asked for it (2026-09-02). The existing doors are Trakt,
// Steam, TMDB and Google. Discord is the account this app's audience — people
// who follow games, films and shows — is most likely to already have, and it
// asks for no password on our page.
//
// WHAT WE STORE: the Discord user id (a stable snowflake) and a display name.
// No email is requested and none is stored — see SCOPES.

// ── Config, read at CALL time, never at module load ──────────────────────────
// AGENTS.md: "A SAFETY GATE read at module load is a gate nothing tests."
//
// NEXT_PUBLIC_, matching Google and for the same reason: a Discord client id is
// public by construction (it rides in the query string of the authorize URL every
// user's browser follows), and making it ONE variable means the sign-in BUTTON
// and the sign-in ROUTE can never disagree about whether Discord is configured.
// Two vars holding the same value eventually drift. Only the secret is
// server-only.
//
// ⚠️ Being NEXT_PUBLIC_ it must be declared as an `ARG` in the Dockerfile, or the
// client half reads it as undefined while the server half works fine — the exact
// half-live failure that bit NEXT_PUBLIC_SUPPORT_URL.
// → memory: next-public-env-needs-dockerfile-arg
function clientId(): string | null {
  return process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || null;
}

function clientSecret(): string | null {
  return process.env.DISCORD_CLIENT_SECRET || null;
}

/** Both halves present. The auth routes 404 rather than half-start a flow. */
export function discordConfigured(): boolean {
  return !!clientId() && !!clientSecret();
}

// Derived from the public origin rather than its own env var, so there is no
// second value to keep in sync with the Discord developer portal. Discord matches
// `redirect_uri` EXACTLY against the URIs registered there, so whatever
// NEXT_PUBLIC_BASE_URL is at runtime must be one of them.
//
// ⚠️ Read at request time from the passed-in base, NOT from process.env at module
// load: Railway's build-phase env differs from its runtime env, and a value baked
// in at build time is wrong permanently and silently.
// → memory: railway-build-vs-runtime-env
export function discordRedirectUri(base: string): string {
  return new URL("/api/auth/discord/callback", base).toString();
}

// `identify` and NOT `email`, on purpose — the same call google.ts makes.
//
// `identify` returns the id, username, global_name and avatar. The id is what
// keys the `user_identities` row, and it is stable and unique without the
// address. Requesting `email` would mean holding a new category of personal data
// (a GDPR question, a line in the privacy policy, and a hand-written block in
// /api/account/export, whose column lists are explicit) in exchange for nothing
// this app does.
//
// ⚠️ `guilds` is NOT requested and should stay that way. It is the scope people
// look at hardest before approving, and reading someone's server list to
// personalize recommendations is a much bigger promise than this app makes.
const SCOPES = "identify";

/**
 * The authorize-screen URL to send the browser to.
 *
 * `state` is a pure CSRF nonce, verified against an httpOnly cookie on callback
 * (see lib/oauthState.ts). The link target is derived from the SESSION at
 * callback time and is deliberately not encoded here, because a client-supplied
 * userId cannot be trusted.
 *
 * ⚠️ No `prompt` parameter, unlike Google's `select_account`. Discord has no
 * account chooser; `prompt=none` would SKIP the screen for an already-authorized
 * user and `prompt=consent` (the default) shows it. The default is what we want:
 * the authorize screen names the account it is about to use and offers a "not
 * you?" switch, so the shared-browser case Google's parameter guards against is
 * already visible here.
 */
export function getDiscordAuthUrl(state: string, base: string): string {
  const p = new URLSearchParams({
    client_id: clientId() ?? "",
    redirect_uri: discordRedirectUri(base),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

interface DiscordTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

/**
 * Exchange the one-time code for an access token.
 *
 * Deliberately NOT `appScopedAuth: true`, though it carries the client secret.
 * A 401/403 here is far more likely to mean the user's code was expired, reused
 * or cancelled than that our credentials died, and the latch's own rule is that
 * counting a user-scoped failure would let one bad code open the breaker for
 * everybody. Same call google.ts makes, same reasoning.
 * → AGENTS.md, "Providers, caching, and cost"
 */
export async function exchangeDiscordCode(code: string, base: string): Promise<DiscordTokenResponse> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("Discord sign-in is not configured");

  const res = await httpFetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: discordRedirectUri(base),
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Discord token exchange failed: ${res.status} ${b}`);
  }
  return res.json();
}

export interface DiscordUserInfo {
  id: string;
  username: string;
  /** The new display name. Null for accounts that never set one. */
  global_name?: string | null;
  /** Avatar HASH, not a url — see avatarUrl below. */
  avatar?: string | null;
}

/**
 * Read the profile behind an access token.
 *
 * One server-to-server TLS call to Discord with a token we just received from
 * Discord over another one, so there is nothing to verify cryptographically.
 */
export async function getDiscordUserInfo(accessToken: string): Promise<DiscordUserInfo> {
  const res = await httpFetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord userinfo failed: ${res.status}`);
  const info = (await res.json()) as DiscordUserInfo;
  // `id` is the whole identity. Without it there is nothing to key the
  // user_identities row on, and a blank provider_user_id would collide with
  // every other blank one under the UNIQUE(provider, provider_user_id) index —
  // which would silently hand the first such account to every later visitor.
  // Same guard, same reason, as google.ts's `sub` check.
  if (!info?.id) throw new Error("Discord userinfo returned no user id");
  return info;
}

/**
 * Absolute CDN url for a Discord avatar, or null.
 *
 * ⚠️ `avatar` is a HASH, not a url, and it is null for an account on a default
 * avatar. Building the url unconditionally would produce a 404 image on every
 * such account, which renders as a broken portrait rather than the initials
 * fallback the cards already handle.
 */
export function discordAvatarUrl(info: DiscordUserInfo): string | null {
  if (!info.avatar) return null;
  // `.png` rather than `.webp`: animated avatars start `a_` and are served as
  // .gif, but .png is valid for every hash including those, and asking for one
  // format keeps this from needing to branch.
  return `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png`;
}

/**
 * The name to show, preferring the display name over the handle.
 *
 * `global_name` is Discord's post-2023 display name and is what the app itself
 * shows. `username` is the unique handle and is the fallback for accounts that
 * never set a display name — never blank, so this always returns something.
 */
export function discordDisplayName(info: DiscordUserInfo): string | null {
  return info.global_name || info.username || null;
}
