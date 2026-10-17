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
  /** Discord application id. Public: it is in every Discord sign-in address. Unset turns Discord sign-in off. */
  DISCORD_CLIENT_ID?: string;
  /** BoardGameGeek application token (boardgamegeek.com/applications). Unset switches board games off. */
  BGG_TOKEN?: string;

  // Plain vars (wrangler.jsonc).
  ALLOWED_ORIGINS: string;
  DAILY_FETCH_CAP: string;
  /** Counted pageviews allowed per UTC day. Optional; telemetry.ts has the default. */
  DAILY_PAGEVIEW_CAP?: string;
  /** Fandex user ids that may call /v1/admin/*, comma separated. Unset means nobody. */
  ADMIN_USER_IDS?: string;
  /** User-state row writes allowed per UTC day across everyone. Optional; me.ts has the default. */
  DAILY_USER_WRITE_CAP?: string;
  /** Calendar month builds allowed per UTC day. Optional; calendar.ts has the default. */
  DAILY_CALENDAR_CAP?: string;

  // Rate limiters (wrangler.jsonc `ratelimits`). Optional so a test or a local
  // run without them degrades to "allowed" rather than throwing.
  RL_RESOLVE?: RateLimit;
  RL_AUTH?: RateLimit;
  RL_WRITE?: RateLimit;
  /**
   * "1" lets a Worker on a loopback host sign in as a test account (src/devLogin.ts).
   * ⚠️ Only ever in `.dev.vars`. Never in wrangler.jsonc, never pushed as a secret.
   */
  DEV_LOGIN?: string;
  /** "0" or "false" turns IGDB off everywhere. Default on. Read by src/lib/sources/igdb.ts. */
  IGDB_ENABLED?: string;
}
