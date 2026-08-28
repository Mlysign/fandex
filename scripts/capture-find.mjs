// Capture find()'s FULL output for five request shapes, so a change to the
// scoring/caching path can be proved output-preserving the strongest way
// available: same catalog, same profile, byte-identical bytes.
//
// Written 2026-08-28, after the same comparison had been hand-rolled twice in
// one week (docs/catalog-growth.md §11, §11b). Everything a caller can observe
// is captured — ids, slugs, both scores, the center, `fandexPending`, and every
// reason label and contribution — because the interesting regressions have all
// been in a field nobody thought to diff.
//
//   BENCH_DB=/tmp/bench.db node scripts/capture-find.mjs /tmp/before.json
//   git stash && ...capture before.json && git stash pop
//   BENCH_DB=/tmp/bench.db node scripts/capture-find.mjs /tmp/after.json
//   diff /tmp/before.json /tmp/after.json && echo IDENTICAL
//
// Read-only, but point it at a COPY anyway. Same alias-hooks + dynamic-import
// pattern as scripts/probe-score.mjs (hooks affect later imports only; DB_PATH
// must be set before db.ts loads).
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

const { find } = await import("@/lib/discovery");

const userId = process.env.DEV_LOGIN_USER_ID;
const out = process.argv[2];
if (!userId) { console.error("set DEV_LOGIN_USER_ID"); process.exit(1); }
if (!out) { console.error("usage: node scripts/capture-find.mjs <outfile>"); process.exit(1); }

// One shape per code path that can pick a DIFFERENT number: the default
// Fandex-Score sort, a sort that ignores it, a filtered subset, the text query,
// and a deep offset (which is the one that catches a mis-sorted tail).
const SHAPES = [
  ["default", { limit: 60 }],
  ["date", { limit: 60, sort: "releaseDate" }],
  ["filtered", { limit: 60, filters: { types: ["movie"], yearMin: 2015, yearMax: 2024 } }],
  ["query", { limit: 60, q: "the" }],
  ["deep", { limit: 60, offset: 300 }],
];

const capture = {};
for (const [name, req] of SHAPES) {
  const r = find(userId, req);
  capture[name] = {
    total: r.total,
    baseline: r.baseline,
    profileSummary: r.profileSummary,
    items: r.items.map((i) => ({
      id: i.id, slug: i.slug, score: i.score, fandexScore: i.fandexScore,
      fandexCenter: i.fandexCenter, fandexPending: i.fandexPending, reasons: i.reasons,
    })),
  };
}

const text = JSON.stringify(capture, null, 1);
fs.writeFileSync(out, text);
console.log(`${out}: ${text.length} bytes, ${Object.keys(capture).length} shapes`);
