// Create, reset or delete the throwaway account a smoke test signs in as.
//
//   node scripts/smoketest-account.mjs data/rr.db            # create (idempotent)
//   node scripts/smoketest-account.mjs data/rr.db --reset    # keep it, wipe its state
//   node scripts/smoketest-account.mjs data/rr.db --delete   # remove it entirely
//   node scripts/smoketest-account.mjs data/rr.db --status   # what it currently holds
//
// Then sign in at http://localhost:3000/api/dev/login?as=smoketest
//
// ── Why this exists ─────────────────────────────────────────────────────────
// `DEV_LOGIN_USER_ID` points at Nils's real account. Rating a movie from it is a
// genuine write-back to Trakt and TMDB, so every destructive check had to be
// undone by hand, which made destructive checks rare — and that is why "you can
// no longer rate games" survived a full session of verification on 2026-09-03.
// This account can be wrecked freely.
//
// ⚠️ It has NO tokens on its identity, on purpose. `google` is identity-only
// (IDENTITY_ONLY_PROVIDERS), so nothing tries to pull a library for it and no
// write-back ever leaves the machine. A smoke test's ratings stay local.
//
// ⚠️ --reset is SCHEMA-DERIVED, exactly like deleteAccount(): it finds the
// tables to clear by reading sqlite_master for a literal `user_id` column,
// rather than listing them. A table added later is cleared without anyone
// remembering to come back here, which is the same reason erasure works.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read the ids out of the shared leaf module rather than restating them, so the
// script and the route cannot drift. A plain regex read, not an import: this is
// the one value both a `.ts` module and a standalone `.mjs` need, and parsing
// two constants is cheaper than dragging the alias hooks in for them.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "lib", "smoketestAccount.ts"), "utf8");
const constant = (name) => {
  const m = src.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (!m) throw new Error(`smoketestAccount.ts no longer exports ${name}`);
  return m[1];
};
const USER_ID = constant("SMOKETEST_USER_ID");
const PROVIDER = constant("SMOKETEST_PROVIDER");
const DISPLAY_NAME = constant("SMOKETEST_DISPLAY_NAME");

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node scripts/smoketest-account.mjs <db-path> [--reset|--delete|--status]");
  process.exit(1);
}
const mode =
  process.argv.includes("--delete") ? "delete"
  : process.argv.includes("--reset") ? "reset"
  : process.argv.includes("--status") ? "status"
  : "create";

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

/** Every table with a literal `user_id` column. The same rule erasure runs on. */
function userScopedTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .filter((name) => {
      // A VIEW would throw on DELETE (user_library and user_watchlist are views
      // since migration 16), and sqlite_master already excludes them above; this
      // guards the case of a view that somehow reports as a table.
      try {
        return db.prepare(`PRAGMA table_info(${name})`).all().some((c) => c.name === "user_id");
      } catch {
        return false;
      }
    })
    // The account row itself is handled separately: clearing it is --delete, not
    // --reset, and it is what every other table cascades from.
    .filter((name) => name !== "users");
}

function footprint() {
  const out = {};
  for (const t of userScopedTables()) {
    const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(USER_ID)?.n ?? 0;
    if (n > 0) out[t] = n;
  }
  return out;
}

const exists = !!db.prepare("SELECT id FROM users WHERE id = ?").get(USER_ID);

if (mode === "status") {
  console.log(JSON.stringify({ userId: USER_ID, exists, holds: exists ? footprint() : null }, null, 2));
  process.exit(0);
}

if (mode === "delete") {
  if (!exists) { console.log(JSON.stringify({ userId: USER_ID, deleted: false, reason: "did not exist" })); process.exit(0); }
  const before = footprint();
  db.prepare("DELETE FROM users WHERE id = ?").run(USER_ID);
  console.log(JSON.stringify({ userId: USER_ID, deleted: true, cascaded: before }, null, 2));
  process.exit(0);
}

if (mode === "reset") {
  if (!exists) { console.error(`No ${USER_ID} account. Run without --reset first.`); process.exit(1); }
  const before = footprint();
  const cleared = {};
  db.transaction(() => {
    for (const t of userScopedTables()) {
      const info = db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(USER_ID);
      if (info.changes > 0) cleared[t] = info.changes;
    }
    // The identity is state too, but deleting it would lock the account out of
    // /api/dev/login (which requires one). Put it straight back.
    ensureIdentity();
  })();
  console.log(JSON.stringify({ userId: USER_ID, reset: true, was: before, cleared, now: footprint() }, null, 2));
  process.exit(0);
}

// ── create ───────────────────────────────────────────────────────────────────
db.transaction(() => {
  if (!exists) db.prepare("INSERT INTO users (id) VALUES (?)").run(USER_ID);
  ensureIdentity();
})();

console.log(JSON.stringify({
  userId: USER_ID,
  created: !exists,
  provider: PROVIDER,
  signInAt: "http://localhost:3000/api/dev/login?as=smoketest",
  holds: footprint(),
}, null, 2));

function ensureIdentity() {
  const existing = db
    .prepare("SELECT id FROM user_identities WHERE user_id = ? AND provider = ?")
    .get(USER_ID, PROVIDER);
  if (existing) return;
  // ⚠️ No access_token and no refresh_token. An identity carrying credentials
  // would make this account able to write to somebody's real platform.
  db.prepare(
    `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`${USER_ID}-identity`, USER_ID, PROVIDER, USER_ID, DISPLAY_NAME);
}
