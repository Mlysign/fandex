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
  /**
   * Optional AND expected to be absent — registered here for documentation, but
   * never warned about. The monetization vars (H3) are the case this exists
   * for: unset is the CORRECT production state until H4.2's Impressum ships, so
   * warning about all eleven on every boot would be noise pointing the wrong
   * way and would train the reader to skip the block that also reports a
   * genuinely missing provider key.
   */
  quiet?: boolean;
}

const ENV: EnvSpec[] = [
  { name: "JWT_SECRET", required: true, note: "session signing. Generate with `openssl rand -hex 32`" },
  { name: "TOKEN_ENCRYPTION_KEY", required: true, note: "OAuth-token encryption at rest (S2). Generate with `openssl rand -hex 32`; MUST differ from JWT_SECRET" },
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
  // Google sign-in (2026-09-01) — identity only, no library, nothing to sync.
  // Both halves must be set or the flow stays hidden: the button gates on the
  // id, the route refuses without both. NOT quiet, because unlike the
  // monetization vars the intended production state here is PRESENT, so a boot
  // warning is pointing the right way.
  { name: "NEXT_PUBLIC_GOOGLE_CLIENT_ID", required: false, note: "Google sign-in; also needs a Dockerfile ARG (client component reads it)" },
  { name: "GOOGLE_CLIENT_SECRET", required: false, note: "Google sign-in; server-only, never NEXT_PUBLIC_" },
  // P15 — Android TWA Digital Asset Links (only needed once you ship the Android app).
  { name: "TWA_PACKAGE_NAME", required: false, note: "Android TWA package name for /.well-known/assetlinks.json (P15)" },
  { name: "TWA_CERT_FINGERPRINT", required: false, note: "Android signing-cert SHA-256(s) for assetlinks.json (P15); comma-separate multiple" },
  // The IGDB kill switch (2026-08-28). Unlike MONETIZATION_ENABLED above, the
  // correct production value here is ABSENT-meaning-ON: it exists to be thrown
  // if IGDB answers that a stored mirror is not covered by their free tier.
  // → src/lib/sources/igdb.ts, docs/catalog-growth.md §17
  { name: "IGDB_ENABLED", required: false, quiet: true, note: "kill switch; set to 0 to stop all IGDB calls. Default ON" },
  // Catalog growth (docs/catalog-growth.md phases 2, 4 and 5). All three are
  // OFF unless set, and all three deliberately: one grows the database, one
  // changes where browse comes from, and one deletes bytes.
  { name: "BACKFILL_ENABLED", required: false, quiet: true, note: "phase 4: 1 = run the seeded backfill. Default OFF" },
  { name: "BACKFILL_PAGES", required: false, quiet: true, note: "provider pages per backfill pass; default 2. The pacing IS the safety feature" },
  { name: "BACKFILL_MAX_ITEMS", required: false, quiet: true, note: "stop growing at this catalog size; default 50000" },
  { name: "CATALOG_BROWSE", required: false, quiet: true, note: "phase 2: 1 = serve browse from our own DB once a window is deep enough. Default OFF" },
  { name: "CATALOG_BROWSE_MIN", required: false, quiet: true, note: "stored rows in a window before browse goes local; default 200" },
  { name: "HOUSEKEEPING_START_MB", required: false, quiet: true, note: "phase 5: reclaim raw_data blobs above this file size; default 1200" },
  // H3 — monetization. All optional and all inert by default; see lib/affiliate.ts.
  // MONETIZATION_ENABLED is the master switch and MUST stay unset until H4.2's
  // Impressum is live (the first affiliate link makes the site commercial under
  // §5 DDG). Deliberately NOT listed as "required" — the correct production
  // value is "absent", so a boot warning about it would be noise pointing the
  // wrong way.
  { name: "MONETIZATION_ENABLED", required: false, quiet: true, note: "H3 master kill switch; leave UNSET until H4.2's Impressum is live" },
  { name: "AFFILIATE_AMAZON_TAG", required: false, quiet: true, note: "Amazon PartnerNet associate tag (marketplace-specific)" },
  { name: "AFFILIATE_AMAZON_HOST", required: false, quiet: true, note: "Amazon marketplace host; defaults to amazon.de" },
  { name: "AFFILIATE_HUMBLE_PARTNER", required: false, quiet: true, note: "Humble Store partner id" },
  { name: "AFFILIATE_GOG_LINK", required: false, quiet: true, note: "GOG network deep-link template; must contain {url}" },
  { name: "AFFILIATE_GMG_LINK", required: false, quiet: true, note: "Green Man Gaming deep-link template; must contain {url}" },
  { name: "AFFILIATE_FANATICAL_LINK", required: false, quiet: true, note: "Fanatical deep-link template; must contain {url}" },
  { name: "AFFILIATE_ENEBA_LINK", required: false, quiet: true, note: "Eneba deep-link template (gray market); must contain {url}" },
  { name: "AFFILIATE_INSTANT_GAMING_LINK", required: false, quiet: true, note: "Instant Gaming deep-link template (gray market); must contain {url}" },
  { name: "AFFILIATE_KINGUIN_LINK", required: false, quiet: true, note: "Kinguin deep-link template (gray market); must contain {url}" },
  { name: "NEXT_PUBLIC_SUPPORT_URL", required: false, quiet: true, note: "H3.3 donations link (Ko-fi / GitHub Sponsors); build-time inlined" },
  { name: "NEXT_PUBLIC_SUPPORT_LABEL", required: false, quiet: true, note: "H3.3 donations link label; defaults to 'Support Fandex'" },
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
    if (spec.quiet) continue;
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
