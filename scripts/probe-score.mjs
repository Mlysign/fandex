// How does the Fandex Score's cost scale with pool size, and where does it go?
//
// Written 2026-08-27 for docs/catalog-growth.md, which cannot be executed until
// this number exists: growing the catalog to 30-50k items multiplies whatever
// one scored request costs today by 12-20×.
//
// It answers three things the request-path timings cannot separate:
//   1. per-item scoring cost, and whether it is linear (it is)
//   2. the rest of find() — state map, filters, sort, hydrate
//   3. the decomposition: how much of an item's cost is the SCORE, and how much
//      is re-validating a cache. ⚠️ getScoringConfig(), getIpAliases() and
//      getItemIpOverrides() each run a signature SELECT per call, and
//      computeFandexScore calls them PER ITEM. First measurement: 100.6 µs of
//      ~150 µs was applyIpFacets and 17.8 µs was getScoringConfig, i.e. ~79% of
//      scoring was cache freshness checks, not arithmetic.
//
//   BENCH_DB=/tmp/bench.db node scripts/probe-score.mjs
//
// Read-only, but point it at a COPY anyway. Same alias-hooks + dynamic-import
// pattern as scripts/probe-pool.mjs (hooks affect later imports only; DB_PATH
// must be set before db.ts loads).
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.DB_PATH = process.env.BENCH_DB;

const { getCatalogFacets, buildProfile, computeFandexScore, find, poolWeight, invalidateDiscoveryCache } =
  await import("@/lib/discovery");

const userId = process.env.DEV_LOGIN_USER_ID;
const ms = (f) => { const t = performance.now(); const r = f(); return [performance.now() - t, r]; };

// Warm the pool, then report its size.
const [coldMs] = ms(() => find(userId, { limit: 1 }));
const w = poolWeight();
console.log(`pool: ${w.items} items, ${w.perItemBytes} B/item (${w.facetBytes} facets + ${w.displayBytes} display), ${w.vocabTerms} vocab terms`);
console.log(`find() COLD (includes pool build): ${coldMs.toFixed(0)} ms`);

const warm = [];
for (let i = 0; i < 5; i++) warm.push(ms(() => find(userId, { limit: 60 }))[0]);
console.log(`find() warm x5: ${warm.map((x) => x.toFixed(0)).join(", ")} ms`);

// Isolate scoring: every pool item's facets, scored against the profile.
const profile = buildProfile(userId);
const { query } = await import("@/lib/db");
const ids = query("SELECT id FROM media_items LIMIT 100000").map((r) => r.id);
const facetSets = [];
for (const id of ids) {
  const f = getCatalogFacets(id);
  if (f) facetSets.push([id, f]);
}
console.log(`facet sets resolved: ${facetSets.length}`);

const scorePass = (reps) => {
  const t = performance.now();
  let n = 0;
  for (let r = 0; r < reps; r++) {
    for (const [id, f] of facetSets) { computeFandexScore(f, profile, undefined, { mediaItemId: id }); n++; }
  }
  return [performance.now() - t, n];
};

scorePass(1); // jit warm
for (const reps of [1, 4, 20]) {
  const [t, n] = scorePass(reps);
  console.log(`score ${n} items (${reps}x pool): ${t.toFixed(0)} ms  →  ${(t / n * 1000).toFixed(1)} µs/item, ${(n / (t / 1000) / 1000).toFixed(0)}k items/s`);
}

const [t1] = scorePass(1);
console.log(`\nPROJECTION at ${(t1 / facetSets.length).toFixed(4)} ms/item:`);
for (const size of [2553, 10000, 30000, 50000, 85000]) {
  console.log(`  ${String(size).padStart(6)} items → ${(t1 / facetSets.length * size).toFixed(0)} ms of scoring per scored request`);
}

// ── Where the per-item cost goes ────────────────────────────────────────────
// The two helpers below are individually well built: each caches, and checks a
// cheap SQL signature before trusting the cache. The cost is calling them once
// PER ITEM instead of once per pass. Both already accept pre-loaded maps.
const { getScoringConfig } = await import("@/lib/scoringConfig");
const { applyIpFacets } = await import("@/lib/ipAlias");
const N = facetSets.length;
const bench = (label, fn, reps = 4) => {
  const t = performance.now();
  for (let i = 0; i < reps; i++) fn();
  const each = (performance.now() - t) / reps;
  console.log(`${label.padEnd(34)} ${each.toFixed(0).padStart(5)} ms/pass ${(each / N * 1000).toFixed(1).padStart(7)} µs/item`);
  return each;
};
console.log("");
const full = bench("full computeFandexScore", () => { for (const [id, f] of facetSets) computeFandexScore(f, profile, undefined, { mediaItemId: id }); });
const cfg = getScoringConfig();
const withCfg = bench("...with the config passed in", () => { for (const [id, f] of facetSets) computeFandexScore(f, profile, cfg, { mediaItemId: id }); });
bench("getScoringConfig() alone", () => { for (let i = 0; i < N; i++) getScoringConfig(); });
bench("applyIpFacets() alone", () => { for (const [id, f] of facetSets) applyIpFacets(f, id); });
console.log(`\nhoisting the config lookup alone saves ${(full - withCfg).toFixed(0)} ms of ${full.toFixed(0)} ms (${((full - withCfg) / full * 100).toFixed(0)}%)`);

invalidateDiscoveryCache();
