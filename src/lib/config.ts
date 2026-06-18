// Centralized environment validation (P10). Run once at server boot from
// instrumentation.ts. Required vars FAIL-FAST in production (so a misconfigured
// deploy refuses to start with a clear list, instead of throwing deep inside the
// first request); provider keys that only gate one integration are warned, not
// fatal. In development everything is a warning so `npm run dev` still works.
//
// Note: session.ts independently fail-fasts on JWT_SECRET (P3) — that stays as
// defense-in-depth; this module just surfaces ALL missing vars together at boot.

interface EnvSpec {
  name: string;
  required: boolean;
  note?: string;
}

const ENV: EnvSpec[] = [
  { name: "JWT_SECRET", required: true, note: "session signing — generate with `openssl rand -hex 32`" },
  { name: "TMDB_API_KEY", required: true, note: "movies & TV (core)" },
  { name: "RAWG_API_KEY", required: true, note: "games (core)" },
  { name: "NEXT_PUBLIC_BASE_URL", required: true, note: "public origin for OAuth redirects" },
  // Provider keys: missing one only disables that integration.
  { name: "STEAM_API_KEY", required: false, note: "Steam integration" },
  { name: "TRAKT_CLIENT_ID", required: false, note: "Trakt integration" },
  { name: "TRAKT_CLIENT_SECRET", required: false, note: "Trakt integration" },
  { name: "TRAKT_REDIRECT_URI", required: false, note: "Trakt OAuth callback URL" },
  { name: "TWITCH_CLIENT_ID", required: false, note: "IGDB game metadata" },
  { name: "TWITCH_CLIENT_SECRET", required: false, note: "IGDB game metadata" },
  { name: "OMDB_API_KEY", required: false, note: "Rotten Tomatoes / IMDb scores" },
];

function fmt(specs: EnvSpec[]): string {
  return specs.map((s) => `  - ${s.name}${s.note ? ` (${s.note})` : ""}`).join("\n");
}

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  const missingRequired: EnvSpec[] = [];
  const missingOptional: EnvSpec[] = [];

  for (const spec of ENV) {
    if (process.env[spec.name]) continue;
    (spec.required ? missingRequired : missingOptional).push(spec);
  }

  if (missingOptional.length) {
    console.warn(
      `[config] Optional env vars unset (related features disabled):\n${fmt(missingOptional)}`
    );
  }

  if (missingRequired.length) {
    const msg = `[config] Missing required environment variable(s):\n${fmt(missingRequired)}`;
    if (isProd) throw new Error(msg);
    console.warn(`${msg}\n(continuing because NODE_ENV !== "production")`);
  }
}
