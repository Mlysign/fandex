// Where the app talks to. Read through EXPO_PUBLIC_* so a build can point at a
// different Worker without a code change.
//
// The TMDB key ships in the app on purpose. TMDB's terms have no secrecy clause
// and its staff say client-side use is fine; the rate limit is per IP, so each
// device spends its own (docs/app-plan.md). The IGDB and Steam credentials are
// the ones that may never be here, which is why games go through the Worker.

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://fandex-api.fandex-worker.workers.dev').replace(/\/+$/, '');

export const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '';

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
