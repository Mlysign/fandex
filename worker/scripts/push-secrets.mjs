// Set the Worker's secrets from the repo's .env, without a value ever reaching
// the terminal.
//
//   node worker/scripts/push-secrets.mjs            # set what is missing or changed
//   node worker/scripts/push-secrets.mjs --rotate-jwt   # also mint a new JWT_SECRET (signs everyone out)
//
// The values are read from ../.env, handed to `wrangler secret bulk` on stdin,
// and never printed, logged or written anywhere else. The script reports names
// and lengths only. AGENTS.md: a secret that reaches a transcript is burned.
//
// JWT_SECRET is the exception to "from .env": it is generated here, once. The
// Worker's sessions are a different system from the Railway site's, so sharing
// that secret would only widen what a leak of either could forge.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.join(here, "..");
const envPath = path.join(workerDir, "..", ".env");

/** Worker secret name -> the .env key it comes from. */
const FROM_ENV = {
  TMDB_API_KEY: "TMDB_API_KEY",
  TWITCH_CLIENT_ID: "TWITCH_CLIENT_ID",
  TWITCH_CLIENT_SECRET: "TWITCH_CLIENT_SECRET",
  GOOGLE_CLIENT_ID: "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  TRAKT_CLIENT_ID: "TRAKT_CLIENT_ID",
};

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function wrangler(args, input) {
  // shell: true so `npx` resolves on Windows. No secret is ever in `args`.
  return spawnSync("npx", ["wrangler", ...args], { cwd: workerDir, input, encoding: "utf8", shell: true });
}

if (!fs.existsSync(envPath)) {
  console.error(`no .env at ${envPath}`);
  process.exit(1);
}
const env = parseEnv(envPath);

const listed = wrangler(["secret", "list", "--format", "json"]);
let existing = new Set();
try {
  existing = new Set(JSON.parse(listed.stdout).map((s) => s.name));
} catch {
  console.error("could not list the Worker's secrets. Is it deployed, and is wrangler logged in?");
  process.exit(1);
}

const payload = {};
const report = [];
for (const [name, envKey] of Object.entries(FROM_ENV)) {
  const value = env[envKey];
  if (!value) {
    report.push(`  MISSING  ${name}  (no ${envKey} in .env)`);
    continue;
  }
  payload[name] = value;
  report.push(`  set      ${name}  (${value.length} chars, from ${envKey})`);
}

const rotate = process.argv.includes("--rotate-jwt");
if (!existing.has("JWT_SECRET") || rotate) {
  payload.JWT_SECRET = randomBytes(48).toString("base64url");
  report.push(`  set      JWT_SECRET  (${payload.JWT_SECRET.length} chars, generated${rotate ? ", ROTATED: every session is now invalid" : ""})`);
} else {
  report.push("  kept     JWT_SECRET  (already set; pass --rotate-jwt to replace it)");
}

const res = wrangler(["secret", "bulk"], JSON.stringify(payload));
console.log(report.join("\n"));
if (res.status !== 0) {
  // wrangler's own output names secrets, never values, so it is safe to show.
  console.error((res.stderr || res.stdout || "").split("\n").filter((l) => l.trim()).slice(-6).join("\n"));
  process.exit(res.status ?? 1);
}
console.log(`${Object.keys(payload).length} secrets written to the Worker.`);
