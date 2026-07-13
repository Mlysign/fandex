// P5 restore-drill verifier. Open a SQLite DB produced by `litestream restore`
// and confirm it's a complete, uncorrupted copy: run PRAGMA integrity_check and
// print row counts for the key tables. Exits non-zero if the DB is corrupt or the
// core tables are empty.
//
//   node scripts/verify-restore.mjs <path-to-restored.db>
//
// Use after restoring the Litestream replica to a scratch file (see the P5 drill).
import Database from "better-sqlite3";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-restore.mjs <db-file>");
  process.exit(2);
}

const db = new Database(file, { readonly: true, fileMustExist: true });

// Core tables must be non-empty; the rest are informational.
const CORE = new Set(["media_items", "user_library"]);
const tables = [
  "users", "user_identities",
  "media_items", "media_links", "media_external_ids",
  "user_library", "user_watchlist", "user_item_state",
];

let ok = true;
console.log(`Restore verification — ${file}\n`);

// 1) Structural integrity: the strongest single signal the restore is intact.
try {
  const row = db.prepare("PRAGMA integrity_check").get();
  const result = row.integrity_check ?? Object.values(row)[0];
  console.log(`  integrity_check : ${result}`);
  if (result !== "ok") ok = false;
} catch (e) {
  console.log(`  integrity_check : ERROR ${e.message}`);
  ok = false;
}

// 2) Row counts — sanity-check the data actually came back.
console.log("");
for (const t of tables) {
  try {
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
    console.log(`  ${t.padEnd(20)} ${c}`);
    if (CORE.has(t) && c === 0) ok = false;
  } catch (e) {
    console.log(`  ${t.padEnd(20)} ERROR ${e.message}`);
    ok = false;
  }
}

console.log(`\n${ok ? "✅ Restore looks intact." : "❌ Restore looks incomplete/corrupt — investigate."}`);
process.exit(ok ? 0 : 1);
