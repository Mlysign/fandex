// Prove the derived user_library / user_watchlist VIEWS reproduce the cache
// TABLES exactly, on a real database.
//
// Why this exists: every DB test in the suite starts from a fresh database, so
// none of them exercise the shape production actually has. Dropping the two
// cache tables is only safe if the views that replace them return byte-equal
// rows for the data that is really there — 1,900+ library rows with real
// ratings, multi-source metadata blobs and years of drift-shaped history.
// Run this against a copy of the live DB before and after the migration.
//
//   node scripts/verify-cache-views.mjs data/rr.db
//   node scripts/verify-cache-views.mjs data/rr.db --keep out.db
//
// Exits non-zero on any mismatch. `ADDED_AT_TOL=2` allows an added_at skew of
// N seconds (the cache row and its user_item_state row were inserted moments
// apart, so a 1s difference is expected and harmless — it is only an export
// sort key). Any tolerated rows are reported, never hidden.
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
// The SAME definitions migration 16 installs — imported, never copied, so the
// thing being verified is the thing that ships. A relative .ts specifier works
// under plain `node` via native type-stripping; cacheViews.ts deliberately has
// no runtime imports and no `@/*` alias, which is what keeps that true.
import { WATCHLIST_VIEW_BODY, LIBRARY_VIEW_BODY } from "../src/lib/cacheViews.ts";

const args = process.argv.slice(2);
const src = args[0];
if (!src) {
  console.error("usage: node scripts/verify-cache-views.mjs <db> [--keep <out.db>]");
  process.exit(1);
}
const keepIdx = args.indexOf("--keep");
const workPath = keepIdx >= 0 ? args[keepIdx + 1] : path.join(os.tmpdir(), `rr-viewcheck-${process.pid}.db`);
fs.rmSync(workPath, { force: true });

// A consistent single-file snapshot, WAL included.
new Database(src, { readonly: true }).exec(`VACUUM INTO '${workPath.replace(/\\/g, "/")}'`);
const db = new Database(workPath, { readonly: true });

db.exec(`CREATE TEMP VIEW v_watchlist AS ${WATCHLIST_VIEW_BODY};`);
db.exec(`CREATE TEMP VIEW v_library   AS ${LIBRARY_VIEW_BODY};`);

// ── Diff ─────────────────────────────────────────────────────────────────────
const jsonEq = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); }
  catch { return a === b; }
};

const TOL = Number(process.env.ADDED_AT_TOL ?? 0);

function compare(label, realTable, viewName, columns) {
  const key = "user_id || ':' || media_item_id";
  const real = db.prepare(`SELECT ${key} AS k, * FROM ${realTable}`).all();
  const view = db.prepare(`SELECT * FROM (SELECT ${key} AS k, * FROM ${viewName})`).all();
  const realBy = new Map(real.map((r) => [r.k, r]));
  const viewBy = new Map(view.map((r) => [r.k, r]));

  const onlyReal = [...realBy.keys()].filter((k) => !viewBy.has(k));
  const onlyView = [...viewBy.keys()].filter((k) => !realBy.has(k));

  const mismatches = new Map();
  const tolerated = new Map();
  for (const [k, rr] of realBy) {
    const vr = viewBy.get(k);
    if (!vr) continue;
    for (const c of columns) {
      const a = rr[c], b = vr[c];
      const isJson = c === "platform_sources" || c === "metadata";
      let same = isJson ? jsonEq(a, b) : a === b;
      if (!same && c === "added_at" && typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= TOL) {
        tolerated.set(c, (tolerated.get(c) ?? 0) + 1);
        same = true;
      }
      if (!same) {
        if (!mismatches.has(c)) mismatches.set(c, []);
        mismatches.get(c).push({ k, real: a, view: b });
      }
    }
  }

  console.log(`\n── ${label} ──────────────────────────────────────`);
  console.log(`   rows: table ${real.length}   view ${view.length}`);
  console.log(`   only in table: ${onlyReal.length}   only in view: ${onlyView.length}`);
  for (const k of onlyReal.slice(0, 5)) console.log(`     [table-only] ${k}`);
  for (const k of onlyView.slice(0, 5)) console.log(`     [view-only]  ${k}`);
  if (!mismatches.size) console.log(`   OK  every compared column matches on all ${realBy.size} shared rows`);
  for (const [c, list] of mismatches) {
    console.log(`   FAIL ${c}: ${list.length} mismatched`);
    for (const m of list.slice(0, 4)) {
      console.log(`        ${m.k}`);
      console.log(`          table: ${JSON.stringify(m.real)?.slice(0, 200)}`);
      console.log(`          view:  ${JSON.stringify(m.view)?.slice(0, 200)}`);
    }
  }
  for (const [c, n] of tolerated) console.log(`   WARN ${c}: ${n} rows differ within the ±${TOL}s tolerance`);
  return { onlyReal: onlyReal.length, onlyView: onlyView.length, bad: [...mismatches.keys()] };
}

const w = compare("user_watchlist", "user_watchlist", "v_watchlist",
  ["user_id", "media_item_id", "platform_sources", "added_at"]);
const l = compare("user_library", "user_library", "v_library",
  ["user_id", "media_item_id", "platform_sources", "status", "rating", "review", "reviewed_at", "metadata", "added_at"]);

const clean = !w.onlyReal && !w.onlyView && !w.bad.length && !l.onlyReal && !l.onlyView && !l.bad.length;
console.log(`\n${clean ? "CLEAN — the views reproduce both cache tables exactly." : "NOT CLEAN — see above."}`);
if (keepIdx < 0) { db.close(); fs.rmSync(workPath, { force: true }); }
process.exit(clean ? 0 : 1);
