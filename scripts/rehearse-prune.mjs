// PR16 rehearsal — run the REAL prune against a COPY of a real database.
//
// Usage: node scripts/rehearse-prune.mjs <source-db-path> [--vacuum]
//
// Why this exists: every DB test in this repo starts from a fresh in-memory
// schema (see the fresh-db-tests-hide-upgrade-bugs note), so green tests prove
// nothing about how the prune behaves on a database with real history — real
// browsed rows, real library rows, real cascades. This copies a live DB aside
// and runs the actual exported functions from src/lib/dbPrune.ts against it, so
// what gets rehearsed is what will run in production, not a restatement of it.
//
// It NEVER touches the source file: everything happens on the copy.
//
// alias-hooks.mjs + dynamic import, same pattern and same ordering constraint as
// scripts/migrate.mjs — hooks only affect later imports, and DB_PATH must be set
// before db.ts is imported because it reads the path at module load.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Load-bearing, same as in migrate.mjs: this static import is HOISTED, so
// better-sqlite3 (and its CJS internals) resolve and cache BEFORE the hook below
// is active. Without it, alias-hooks' extensionless-specifier rewriting reaches
// inside better-sqlite3's own `require("./database")` and hands the CJS loader a
// file:// URL it can't resolve — "Cannot find module 'file:///…/database.js'".
// Verified on Node v26.3.0; do not "tidy" this into a dynamic import.
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const sourcePath = process.argv[2];
const doVacuum = process.argv.includes("--vacuum");
if (!sourcePath) {
  console.error("usage: node scripts/rehearse-prune.mjs <source-db-path> [--vacuum]");
  process.exit(1);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`No such database: ${sourcePath}`);
  process.exit(1);
}

// Copy the DB and its WAL/SHM sidecars — without the -wal, recent commits that
// haven't been checkpointed yet would simply be missing from the rehearsal.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearse-prune-"));
const copyPath = path.join(workDir, "rehearsal.db");
for (const [suffix, dest] of [["", copyPath], ["-wal", `${copyPath}-wal`], ["-shm", `${copyPath}-shm`]]) {
  const src = `${sourcePath}${suffix}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}
console.log(`Rehearsing against a copy at ${copyPath}`);
console.log(`(source ${sourcePath} is never written to)\n`);

process.env.DB_PATH = copyPath;

const { previewPrune, runPrune, orphanCheck, volumeInfo, runVacuum } = await import("../src/lib/dbPrune.ts");
const { query, get, getDb } = await import("../src/lib/db.ts");

const mb = (p) => { try { return (fs.statSync(p).size / 1048576).toFixed(1); } catch { return "?"; } };
const pragma = (k) => getDb().pragma(k, { simple: true });

// ── Snapshot everything a cascade could plausibly reach ─────────────────────
// Full row content, not just counts: a count would still match if a cascade
// deleted one library row and something else inserted another.
const snapshot = () => ({
  library: query("SELECT id, media_item_id, status, rating, review FROM user_library ORDER BY id"),
  watchlist: query("SELECT id, media_item_id FROM user_watchlist ORDER BY id"),
  itemState: query("SELECT id, media_item_id, relation, rating FROM user_item_state ORDER BY id"),
  users: query("SELECT id FROM users ORDER BY id"),
  identities: query("SELECT id, provider FROM user_identities ORDER BY id"),
  syncLog: get("SELECT COUNT(*) n FROM sync_log").n,
  tagOverrides: get("SELECT COUNT(*) n FROM tag_category_override").n,
});

const before = snapshot();
const sizeBefore = mb(copyPath);

console.log("── Before ─────────────────────────────────────────");
console.log(`file            : ${sizeBefore} MB`);
console.log(`page_count      : ${pragma("page_count")}`);
console.log(`freelist_count  : ${pragma("freelist_count")}`);
console.log(`library rows    : ${before.library.length}`);
console.log(`watchlist rows  : ${before.watchlist.length}`);
console.log(`item_state rows : ${before.itemState.length}`);
console.log("");

const preview = previewPrune();
console.log("── previewPrune() ─────────────────────────────────");
for (const [k, v] of Object.entries(preview)) console.log(`${k.padEnd(26)}: ${v}`);
console.log("");

if (preview.wouldHaveLostLibraryRows > 0 || preview.wouldHaveLostWatchlistRows > 0) {
  console.log("!! NOTE: the plan's narrower predicate WOULD have deleted user rows here.");
  console.log("!! The extra library/watchlist clauses in PRUNABLE_WHERE are load-bearing on this data.\n");
}

// ── Run it, exactly the way the route does ──────────────────────────────────
let totalDeleted = 0;
let passes = 0;
const startedAt = Date.now();
for (;;) {
  const r = runPrune({ batchSize: 5000, budgetMs: 20000 });
  totalDeleted += r.deleted;
  passes++;
  console.log(`pass ${String(passes).padStart(2)}: deleted ${String(r.deleted).padStart(7)}  remaining ${r.remaining}`);
  if (r.deleted === 0 || r.remaining === 0) break;
  if (passes > 500) { console.log("!! too many passes, aborting"); break; }
}
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\ndeleted ${totalDeleted} media_items in ${passes} pass(es), ${elapsed}s\n`);

// ── Verify nothing user-owned moved ─────────────────────────────────────────
const after = snapshot();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = [
  ["user_library rows identical", same(before.library, after.library)],
  ["user_watchlist rows identical", same(before.watchlist, after.watchlist)],
  ["user_item_state rows identical", same(before.itemState, after.itemState)],
  ["users identical", same(before.users, after.users)],
  ["user_identities identical", same(before.identities, after.identities)],
  ["sync_log count identical", before.syncLog === after.syncLog],
  ["tag overrides identical", before.tagOverrides === after.tagOverrides],
];
const orphans = orphanCheck();
checks.push(["no orphaned media_links", orphans.orphanLinks === 0]);
checks.push(["no orphaned media_external_ids", orphans.orphanExternalIds === 0]);

console.log("── Safety checks ──────────────────────────────────");
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
console.log("");

console.log("── After prune ────────────────────────────────────");
console.log(`file            : ${mb(copyPath)} MB (was ${sizeBefore} MB — unchanged until VACUUM)`);
console.log(`page_count      : ${pragma("page_count")}`);
console.log(`freelist_count  : ${pragma("freelist_count")}  <- freed pages, reused by future writes`);
console.log(`media_items     : ${get("SELECT COUNT(*) n FROM media_items").n}`);
console.log(`media_links     : ${get("SELECT COUNT(*) n FROM media_links").n}`);
console.log("");

if (doVacuum) {
  console.log("── VACUUM ─────────────────────────────────────────");
  console.log("volume:", JSON.stringify(volumeInfo()));
  const t = Date.now();
  const v = runVacuum();
  console.log(`result: ${JSON.stringify(v)} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log(`file            : ${mb(copyPath)} MB`);
  console.log(`freelist_count  : ${pragma("freelist_count")}`);
  console.log("");
}

console.log(failed === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED (${failed} check(s))`);
console.log(`Copy left at ${copyPath} for inspection.`);
process.exit(failed === 0 ? 0 : 1);
