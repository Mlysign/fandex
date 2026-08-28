// What does a warm Discover request actually RETAIN, and in which structure?
//
// Written 2026-08-28 because docs/catalog-growth.md §4 planned a memory fix off
// a `JSON.stringify` estimate of one structure, and the estimate was wrong about
// which structure mattered:
//
//   the doc said the scoring pool was "the biggest single thing in memory"
//   measured: the pool was 13.5 MB of 109.6 MB, and facetCache.derived was 86 MB
//
// It also said interning the facet strings would take a pool item from 1,997 to
// ~150-200 bytes. Measured: interning EVERY live facet array (130,737
// occurrences down to 22,341 distinct objects, 5.85x reuse) saved 0.3 MB.
// `poolWeight()`'s serialised numbers are fine for spotting growth and useless
// for sizing a fix — this is the one that answers "what would I free".
//
//   BENCH_DB=/tmp/bench.db node --expose-gc scripts/probe-memory.mjs
//
// ⚠️ `--expose-gc` is required; without it every delta is noise.
// ⚠️ Order matters when releasing. A shared object frees with its LAST holder,
//    so a structure released early can read as "free" while another still pins
//    its contents. Read the deltas as "what this holder released, given what was
//    already gone", not as independent sizes.
//
// Read-only, but point it at a COPY. Same alias-hooks + dynamic-import pattern
// as scripts/probe-score.mjs.
import { registerHooks } from "node:module";
import fs from "node:fs";
import path from "node:path";
// Load-bearing, same as in migrate.mjs — see the comment there before "tidying".
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.DB_PATH = process.env.BENCH_DB ?? process.env.DB_PATH;

if (!global.gc) {
  console.error("run with --expose-gc, or every number below is noise");
  process.exit(1);
}

const heap = () => { for (let i = 0; i < 4; i++) global.gc(); return process.memoryUsage().heapUsed; };
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
let last = 0;
const mark = (label) => {
  const h = heap();
  console.log(`${label.padEnd(46)} ${mb(h).padStart(9)}   Δ ${mb(h - last).padStart(9)}`);
  last = h;
  return h;
};

last = heap();
const { find, poolWeight, getCatalogFacets, invalidateDiscoveryCache } = await import("@/lib/discovery");
const { sharedCache, cacheWeights } = await import("@/lib/boundedCache");
const { query } = await import("@/lib/db");
const userId = process.env.DEV_LOGIN_USER_ID;
if (!userId) { console.error("set DEV_LOGIN_USER_ID"); process.exit(1); }
const base = mark("modules loaded");

find(userId, { limit: 60 });
const w = poolWeight();
const built = mark(`warm request done (${w.items} pool items)`);
const perItem = (built - base) / w.items;
console.log(`   → ${Math.round(perItem)} B/item RETAINED, all-in (poolWeight says ${w.perItemBytes} B/item serialised)\n`);

console.log("what cacheWeights() prices them at (serialised, its own sampler):");
for (const [k, v] of Object.entries(cacheWeights())) {
  if (v.entries) console.log(`  ${k.padEnd(30)} ${String(v.entries).padStart(6)} × ${String(v.meanBytes ?? v.perEntryBytes ?? "?").padStart(8)} B = ${mb(v.estimatedBytes ?? 0)}`);
}

// The registry's own names, so a cache added later shows up here without an edit.
const NAMES = Object.keys(cacheWeights());
console.log("\nreleased one at a time (see the ordering warning at the top):");
last = built;
for (const name of NAMES) {
  const c = sharedCache(name, { max: 1 }); // `max` is ignored for an existing name
  const n = c.size;
  if (!n) continue;
  c.clear();
  mark(`  ${name} (${n} entries)`);
}
invalidateDiscoveryCache();
mark("  the discovery pool");
console.log(`\nfloor: ${mb(heap())} (modules + sqlite; started at ${mb(base)})`);

// ── Would interning the facet objects help? ─────────────────────────────────
// It would not, and this is the measurement that says so. Interning across the
// POOL alone frees nothing (facetCache holds the same objects), so this does
// every live array at once — the best case any real implementation could reach.
console.log("\n── rebuild, then intern EVERY live facet array ──");
last = heap();
find(userId, { limit: 60 });
const rebuilt = mark("warm request rebuilt");

const fc = sharedCache("facetCache.derived", { max: 6000 });
const arrays = [];
for (const r of query("SELECT id FROM media_items")) { const f = getCatalogFacets(r.id); if (f) arrays.push(f); }
for (const v of fc.sample(1e6)) if (v?.facets) arrays.push(v.facets);
let occ = 0;
for (const a of arrays) occ += a.length;
const keyOf = (f) => `${f.kind} ${f.role ?? ""} ${f.key} ${f.label} ${f.category ?? ""} ${f.prominence ?? ""}`;
const canon = new Map();
for (const a of arrays) for (let i = 0; i < a.length; i++) {
  const k = keyOf(a[i]);
  const hit = canon.get(k);
  if (hit) a[i] = hit; else canon.set(k, a[i]);
}
console.log(`  ${arrays.length} arrays, ${occ} occurrences, ${canon.size} distinct (${(occ / canon.size).toFixed(2)}× reuse)`);
last = rebuilt;
mark("after interning every live array");

console.log("\nPROJECTION at the measured retained B/item (the pool alone is the part that grows):");
for (const size of [10000, 30000, 50000, 85000]) {
  console.log(`  ${String(size).padStart(6)} items → ${mb(perItem * size)} all-in, if nothing else changes`);
}
