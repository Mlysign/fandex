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
  /** Hardcover Personal Access Token (hardcover.app/account/api, read scopes). Unset leaves books on Open Library alone. */
  HARDCOVER_TOKEN?: string;
  /** Steam Web API key (steamcommunity.com/dev/apikey). Unset: Steam libraries do not sync. Never in the app. */
  STEAM_API_KEY?: string;
  /** Steam calls allowed per UTC day across everyone. Optional; src/steam.ts has the default. */
  DAILY_STEAM_CAP?: string;

  /** Copied book covers (src/covers.ts). R2 `fandex-covers`. */
  COVERS: R2Bucket;

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
  /** Baseline titles the walk may fetch per UTC day. Optional; baseline.ts has the default. */
  DAILY_BASELINE_CAP?: string;

  // Rate limiters (wrangler.jsonc `ratelimits`). Optional so a test or a local
  // run without them degrades to "allowed" rather than throwing.
  RL_RESOLVE?: RateLimit;
  RL_AUTH?: RateLimit;
  RL_WRITE?: RateLimit;
  /** The open read routes that cost many rows a call: the catalog delta and lookup. */
  RL_READ?: RateLimit;
  /** Catalog delta pages served per UTC day. Optional; index.ts has the default. */
  DAILY_DELTA_CAP?: string;
  /** Refs /v1/lookup may answer per UTC day. Optional; index.ts has the default. */
  DAILY_LOOKUP_CAP?: string;
  /** User-state row writes one account may make per UTC day. Optional; me.ts has the default. */
  DAILY_USER_WRITE_CAP_PER_USER?: string;
  /**
   * "1" lets a Worker on a loopback host sign in as a test account (src/devLogin.ts).
   * ⚠️ Only ever in `.dev.vars`. Never in wrangler.jsonc, never pushed as a secret.
   */
  DEV_LOGIN?: string;
  /** "0" or "false" turns IGDB off everywhere. Default on. Read by src/lib/sources/igdb.ts. */
  IGDB_ENABLED?: string;
  /** "0" or "false" turns Hardcover off with the token in place. Default on. Read by src/lib/sources/hardcover.ts. */
  HARDCOVER_ENABLED?: string;
  /** Hardcover requests allowed per UTC day across every route. Optional; src/hardcover.ts has the default (their free plan allows 5,000). */
  HARDCOVER_DAILY_CAP?: string;
  /** Cover copies allowed per UTC day (one per cover, ever). Optional; src/covers.ts has the default. */
  DAILY_COVER_CAP?: string;
  /** Where a copied cover is served from, in a card and in a stored record. Unset: the public site. */
  COVER_ORIGIN?: string;
}
