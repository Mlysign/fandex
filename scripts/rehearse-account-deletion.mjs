// H4.6/H4.7 rehearsal — run the REAL export + deletion against a COPY of a real
// database.
//
// Usage: node scripts/rehearse-account-deletion.mjs <source-db-path> [userId]
//
// Why this exists: every DB test in this repo starts from a fresh schema (see
// the fresh-db-tests-hide-upgrade-bugs note), so green tests say nothing about
// how erasure behaves on a database with real history — 1,900 library rows,
// real cascades, whatever tables past migrations actually left behind. This
// copies a live DB aside and calls the exported functions from src/lib/account.ts
// against it, so what gets rehearsed is what will run in production.
//
// It NEVER touches the source file: everything happens on the copy.
//
// Same hook/import ordering constraints as scripts/rehearse-prune.mjs — read the
// header there before rearranging the imports.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  console.error("usage: node scripts/rehearse-account-deletion.mjs <source-db-path> [userId]");
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearse-account-"));
const copyPath = path.join(workDir, "rehearsal.db");
for (const [suffix, dest] of [["", copyPath], ["-wal", `${copyPath}-wal`], ["-shm", `${copyPath}-shm`]]) {
  const src = `${sourcePath}${suffix}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}
console.log(`Rehearsing against a copy at ${copyPath}`);
console.log(`(source ${sourcePath} is never written to)\n`);

process.env.DB_PATH = copyPath;

const { userScopedTables, accountFootprint, deleteAccount, buildAccountExport } =
  await import("../src/lib/account.ts");
const { query, get } = await import("../src/lib/db.ts");

const userId = process.argv[3] ?? get("SELECT id FROM users ORDER BY created_at LIMIT 1")?.id;
if (!userId) {
  console.error("No users in this database.");
  process.exit(1);
}

const count = (sql, params = []) => get(sql, params)?.n ?? 0;

console.log("── Schema discovery ───────────────────────────────");
console.log(`user-scoped tables: ${userScopedTables().join(", ")}\n`);

console.log(`── Footprint for ${userId} ────────────────────────`);
const footprint = accountFootprint(userId);
for (const [k, v] of Object.entries(footprint.perTable)) console.log(`${k.padEnd(24)}: ${v}`);
console.log(`${"TOTAL".padEnd(24)}: ${footprint.total}\n`);

// ── Export first (Art. 20 before Art. 17, same order a user would do it) ────
console.log("── buildAccountExport() ───────────────────────────");
const exported = buildAccountExport(userId);
const serialized = JSON.stringify(exported);
console.log(`identities : ${exported.identities.length}`);
console.log(`library    : ${exported.library.length}`);
console.log(`watchlist  : ${exported.watchlist.length}`);
console.log(`itemState  : ${exported.itemState.length}`);
console.log(`syncLog    : ${exported.syncLog.length}`);
console.log(`size       : ${(serialized.length / 1048576).toFixed(2)} MB`);

// The leak check against REAL stored tokens, not planted test ones.
const realSecrets = query(
  "SELECT access_token, refresh_token FROM user_identities WHERE user_id = ?",
  [userId],
).flatMap((r) => [r.access_token, r.refresh_token]).filter(Boolean);
const leaked = realSecrets.filter((s) => serialized.includes(s));
console.log(`stored credentials on this account : ${realSecrets.length}`);
console.log(`…appearing in the export           : ${leaked.length} ${leaked.length === 0 ? "✓" : "✗ LEAK"}`);
for (const key of ["access_token", "refresh_token", "token_expires_at"]) {
  console.log(`column name "${key}" in export      : ${serialized.includes(key) ? "✗ PRESENT" : "absent ✓"}`);
}
console.log("");

// ── Then delete ─────────────────────────────────────────────────────────────
const catalogBefore = {
  items: count("SELECT COUNT(*) n FROM media_items"),
  links: count("SELECT COUNT(*) n FROM media_links"),
};
const otherUsers = query("SELECT id FROM users WHERE id != ?", [userId]).map((r) => r.id);
const otherBefore = Object.fromEntries(
  otherUsers.map((u) => [u, userScopedTables().map((t) => count(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`, [u]))]),
);

console.log("── deleteAccount() ────────────────────────────────");
const started = Date.now();
const result = deleteAccount(userId);
console.log(`elapsed        : ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`rows deleted   : ${result.total}`);
console.log(`users row gone : ${result.userRowDeleted}`);
console.log("");

console.log("── Verification ───────────────────────────────────");
let ok = true;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
};

check("users row removed", count("SELECT COUNT(*) n FROM users WHERE id = ?", [userId]) === 0);
for (const t of userScopedTables()) {
  const left = count(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`, [userId]);
  check(`${t} emptied for this user`, left === 0, `${left} left`);
}
for (const t of userScopedTables()) {
  const orphans = count(`SELECT COUNT(*) n FROM "${t}" WHERE user_id NOT IN (SELECT id FROM users)`);
  check(`${t} has no orphaned user_id`, orphans === 0, `${orphans} orphans`);
}
check(
  "shared catalog untouched",
  count("SELECT COUNT(*) n FROM media_items") === catalogBefore.items &&
    count("SELECT COUNT(*) n FROM media_links") === catalogBefore.links,
  `${catalogBefore.items} items / ${catalogBefore.links} links before`,
);
for (const u of otherUsers) {
  const after = userScopedTables().map((t) => count(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`, [u]));
  check(`other user ${u} untouched`, JSON.stringify(after) === JSON.stringify(otherBefore[u]));
}
console.log("");
console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
console.log(`\nCopy left at ${copyPath} for inspection; delete it when done.`);
process.exit(ok ? 0 : 1);
