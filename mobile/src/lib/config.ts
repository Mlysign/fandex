// Where the app talks to. Read through EXPO_PUBLIC_* so a build can point at a
// different Worker without a code change.
//
// The TMDB key ships in the app on purpose. TMDB's terms have no secrecy clause
// and its staff say client-side use is fine; the rate limit is per IP, so each
// device spends its own (docs/app-plan.md). The IGDB and Steam credentials are
// the ones that may never be here, which is why games go through the Worker.

//
// The website's build sets EXPO_PUBLIC_API_URL to "/", which leaves this empty:
// every request is then relative, and fandex.org hands /v1/* to the API Worker
// itself (mobile/web/worker.ts). Same origin, so no preflight per request.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://fandex-api.fandex-worker.workers.dev').replace(/\/+$/, '');

/**
 * Where the catalog is kept as files, or null where it is not: the website the
 * app is served from (""), fandex.org for the Android app, and nowhere for an
 * app pointed at any other API. ⚠️ The files are the PRODUCTION catalog. An app
 * talking to a developer's Worker must not start from them: its ids and cursor
 * would be another database's.
 */
//
// ⚠️ "Production" is spelled "no address was configured", not by comparing with
// the API's address. The website's build refuses a bundle that contains that
// address (web/build.mjs: it means the bundle was not built for the website),
// and a comparison here put it in every bundle.
export const CATALOG_FILES_URL: string | null =
  API_URL === '' ? '' : process.env.EXPO_PUBLIC_API_URL == null ? 'https://fandex.org' : null;

/**
 * True when the app talks to a Worker on this machine. It is what shows the
 * test accounts on the sign-in card. The Worker decides for itself whether
 * they exist (two gates of its own); this only keeps the buttons out of
 * everybody else's sight.
 */
export const LOCAL_API = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_URL);

export const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '';

/** The donations page behind Profile's "Support Fandex". Empty: no row. */
export const SUPPORT_URL = (process.env.EXPO_PUBLIC_SUPPORT_URL ?? '').trim();

export function tmdbConfigured(): boolean {
  return TMDB_API_KEY.length > 0;
}

/**
 * The Trakt app's client id. Public: it is in the address of every Trakt
 * consent page. The client SECRET is not here and is not needed; Trakt made it
 * optional for clients on 2026-10-01, which is what lets a device sign in to
 * Trakt on its own.
 */
export const TRAKT_CLIENT_ID = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID ?? '';

export function traktConfigured(): boolean {
  return TRAKT_CLIENT_ID.length > 0;
}

/**
 * The Google OAuth client's id. Public for the same reason: it is in the
 * address of Google's sign-in page. There is no secret on this side at all.
 * The Worker holds the same id and refuses a token issued to any other.
 */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
