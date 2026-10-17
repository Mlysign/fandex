// Prepare a Worker and a database on THIS machine, for testing what cannot be
// tested on the live one: ratings, hides, settings, disconnecting, deleting an
// account, the admin pages' writes.
//
//   node worker/scripts/dev-stack.mjs            prepare (safe to run again)
//   node worker/scripts/dev-stack.mjs --reseed   throw the local database away and load it again
//
// It does three things and touches nothing that is deployed:
//
//   1. Writes worker/.dev.vars, which `wrangler dev` reads and `wrangler deploy`
//      never does. It turns the test accounts on (DEV_LOGIN=1, src/devLogin.ts),
//      makes the first of them an admin, generates a session secret of its own,
//      and copies the provider keys from the repo's .env so search and the
//      calendar work. Values are never printed, only names and lengths.
//   2. Applies the migrations to the LOCAL D1 (worker/.wrangler/state).
//   3. Loads the catalog from data/d1-seed, the files the live database was
//      seeded from. The catalog only: nobody's library is loaded, so the test
//      accounts start empty and the real account does not exist here.
//
// Then, in two terminals (or the two launch configurations of the same names):
//
//   worker-local    npm --prefix worker run dev:local      the Worker, on :8787
//   app-web-local   npm --prefix mobile run web:local      the app, on :8081, talking to it
//
// and "Test account" on any sign-in card.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.join(here, "..");
const repo = path.join(workerDir, "..");
const varsPath = path.join(workerDir, ".dev.vars");
const seedDir = path.join(repo, "data", "d1-seed");
const reseed = process.argv.includes("--reseed");

/** The first test account (src/devLogin.ts). An admin here, so the admin pages can be written to. */
const TEST_ADMIN = "d0d0d0d0-0000-4000-8000-000000000001";

/** Worker variable -> the .env key it comes from. The same table push-secrets.mjs uses. */
const FROM_ENV = {
  TMDB_API_KEY: "TMDB_API_KEY",
  TWITCH_CLIENT_ID: "TWITCH_CLIENT_ID",
  TWITCH_CLIENT_SECRET: "TWITCH_CLIENT_SECRET",
  GOOGLE_CLIENT_ID: "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  TRAKT_CLIENT_ID: "TRAKT_CLIENT_ID",
  DISCORD_CLIENT_ID: "DISCORD_CLIENT_ID",
};

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    // Trimmed: a trailing space in .env (DISCORD_CLIENT_ID had one) is not part of the value.
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function wrangler(args) {
  // The wrangler binary by path, so no shell sees an argument.
  return execFileSync(process.execPath, [path.join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js"), ...args], {
    cwd: workerDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
  });
}

// ── 1. .dev.vars ─────────────────────────────────────────────────────────────

const env = parseEnv(path.join(repo, ".env"));
const had = parseEnv(varsPath);
const vars = {
  DEV_LOGIN: "1",
  ADMIN_USER_IDS: TEST_ADMIN,
  // Kept from run to run, so a session in a browser tab survives a second prepare.
  JWT_SECRET: had.JWT_SECRET && had.JWT_SECRET.length >= 16 ? had.JWT_SECRET : randomBytes(48).toString("base64url"),
};
const report = ["  set      DEV_LOGIN", "  set      ADMIN_USER_IDS  (the first test account)", `  ${had.JWT_SECRET ? "kept    " : "set     "} JWT_SECRET  (${vars.JWT_SECRET.length} chars, this machine's own)`];
for (const [name, envKey] of Object.entries(FROM_ENV)) {
  const value = env[envKey];
  if (!value) { report.push(`  MISSING  ${name}  (no ${envKey} in .env: what needs it will answer 502)`); continue; }
  vars[name] = value;
  report.push(`  set      ${name}  (${value.length} chars, from ${envKey})`);
}
fs.writeFileSync(varsPath, `${Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n")}\n`);
console.log(`worker/.dev.vars\n${report.join("\n")}`);

// ── 2. The local database ────────────────────────────────────────────────────

if (reseed) {
  fs.rmSync(path.join(workerDir, ".wrangler", "state"), { recursive: true, force: true });
  console.log("\nlocal database removed");
}
wrangler(["d1", "migrations", "apply", "fandex", "--local"]);
console.log("\nmigrations applied to the local database");

// ── 3. The catalog ───────────────────────────────────────────────────────────

const count = (table) => {
  const out = wrangler(["d1", "execute", "fandex", "--local", "--json", "--command", `SELECT COUNT(*) n FROM ${table}`]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results[0].n;
};

if (count("media_items") > 0) {
  console.log(`the local catalog is already loaded: ${count("media_items")} titles`);
} else if (!fs.existsSync(seedDir)) {
  console.log("no data/d1-seed here, so the local catalog is EMPTY. Build it with worker/scripts/build-seed.mjs.");
} else {
  // Everything that is the catalog, nothing that is somebody's. The deferred
  // file is the franchise members, which the live database does not hold either.
  const files = fs.readdirSync(seedDir)
    .filter((f) => f.endsWith(".sql") && !f.includes(".deferred.") && !/^(07_users|08_user_state|09_user_episodes|10_telemetry)/.test(f))
    .sort();
  for (const file of files) {
    process.stdout.write(`loading ${file} … `);
    wrangler(["d1", "execute", "fandex", "--local", "--file", path.join(seedDir, file), "--yes"]);
    console.log("done");
  }
  console.log(`the local catalog holds ${count("media_items")} titles, ${count("users")} users`);
}

console.log(`
Ready. Start both, then press "Test account" on a sign-in card:

  npm --prefix worker run dev:local
  npm --prefix mobile run web:local
`);
