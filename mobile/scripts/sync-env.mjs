// Write mobile/.env from the repo's .env, without a value reaching the terminal.
//
//   node mobile/scripts/sync-env.mjs
//
// The app needs three values from there, and all are allowed in a client
// (docs/app-plan.md): the TMDB key, which TMDB's terms have no secrecy clause
// for, and the Trakt and Google CLIENT IDs, which are public by construction
// (each is in the address of its provider's consent page). They get the
// EXPO_PUBLIC_ prefix, which is what Expo inlines into the bundle.
//
// ⚠️ EXPO_PUBLIC_* is PUBLIC. Anything written here ends up readable in the
// app and in the web bundle. TRAKT_CLIENT_SECRET, the Twitch secret and the
// Steam key must never be added to this list. Trakt needs no secret from a
// client since 2026-10-01; the other two go through the Worker for that reason.
//
// mobile/.env is covered by the repo's `.env*` ignore rule and is never committed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.join(here, '..', '..', '.env');
const appEnv = path.join(here, '..', '.env');

/** .env key in the repo root -> the public name the app reads. */
const PUBLISHABLE = {
  TMDB_API_KEY: 'EXPO_PUBLIC_TMDB_API_KEY',
  TRAKT_CLIENT_ID: 'EXPO_PUBLIC_TRAKT_CLIENT_ID',
  // The Google OAuth client's id, under the name the old site gave it. Public
  // like Trakt's: it is in the address of Google's sign-in page. The Worker is
  // pushed the same value (worker/scripts/push-secrets.mjs), and the two have
  // to agree or every Google sign-in is refused.
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
  // The donations page (Profile's "Support Fandex"). A public address by design.
  NEXT_PUBLIC_SUPPORT_URL: 'EXPO_PUBLIC_SUPPORT_URL',
};

if (!fs.existsSync(rootEnv)) {
  console.error(`no .env at ${rootEnv}`);
  process.exit(1);
}

const source = {};
for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) continue;
  // Trimmed: a trailing space in .env (DISCORD_CLIENT_ID had one) is not part of the value.
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  source[m[1]] = v;
}

// Keep anything already in mobile/.env that this script does not own (a
// different EXPO_PUBLIC_API_URL for a local Worker, for example).
const kept = fs.existsSync(appEnv)
  ? fs.readFileSync(appEnv, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !Object.values(PUBLISHABLE).some((k) => l.startsWith(`${k}=`)))
  : [];

const lines = [...kept];
for (const [from, to] of Object.entries(PUBLISHABLE)) {
  if (source[from]) {
    lines.push(`${to}=${source[from]}`);
    console.log(`  set      ${to}  (${source[from].length} chars, from ${from})`);
  } else {
    console.log(`  MISSING  ${to}  (no ${from} in the repo's .env)`);
  }
}
// A trailing newline, always: appending to a file without one lands on the end
// of its last line.
fs.writeFileSync(appEnv, `${lines.join('\n')}\n`);
console.log(`wrote ${path.relative(path.join(here, '..', '..'), appEnv)}`);
