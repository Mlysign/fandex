// The Worker's bindings. Written by hand rather than taken from `wrangler types`
// because that file only knows what is in wrangler.jsonc, and the secrets are
// deliberately not.
export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;

  // Secrets (see scripts/push-secrets.mjs).
  JWT_SECRET: string;
  TMDB_API_KEY: string;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  /** One or more Google OAuth client ids, comma-separated. Public values. */
  GOOGLE_CLIENT_ID: string;
  TRAKT_CLIENT_ID: string;

  // Plain vars (wrangler.jsonc).
  ALLOWED_ORIGINS: string;
  DAILY_FETCH_CAP: string;
  /** User-state row writes allowed per UTC day across everyone. Optional; me.ts has the default. */
  DAILY_USER_WRITE_CAP?: string;
  /** Calendar month builds allowed per UTC day. Optional; calendar.ts has the default. */
  DAILY_CALENDAR_CAP?: string;

  // Rate limiters (wrangler.jsonc `ratelimits`). Optional so a test or a local
  // run without them degrades to "allowed" rather than throwing.
  RL_RESOLVE?: RateLimit;
  RL_AUTH?: RateLimit;
  RL_WRITE?: RateLimit;
  /** "0" or "false" turns IGDB off everywhere. Default on. Read by src/lib/sources/igdb.ts. */
  IGDB_ENABLED?: string;
}
