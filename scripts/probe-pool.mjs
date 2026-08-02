// The catalog-pool rebuild probe (docs/archive/performance-audit.md §A).
//
// Answers two questions the request-path timings can't separate: how expensive
// is ONE full `buildCache()`, and what is the SHAPE of that cost — SQL read vs
// JSON.parse vs derive? Also measures the incremental path: a membership write
// (wishlist a browsed item) must NOT cost a full rebuild.
//
// Point it at a COPY of the DB — it writes (the membership-delta section):
//
//   cp data/rr.db /tmp/probe.db
//   DB_PATH=/tmp/probe.db node scripts/probe-pool.mjs
//
// alias-hooks + dynamic import, same pattern and same ordering constraint as
// scripts/rehearse-prune.mjs: hooks only affect later imports, and DB_PATH must
// be set before db.ts is imported because it reads the path at module load.
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
// Load-bearing, same as in migrate.mjs — see the comment there before "tidying".
import "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// Minimal .env reader — the app relies on Next to inject these, and this runs
// under plain node.
const envPath = path.join(REPO, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { query, get, run } = await import("@/lib/db");
const { invalidateDiscoveryCache, find, getCatalogIdf, POOL_WHERE } = await import("@/lib/discovery");

function timed(label, fn) {
  const t0 = performance.now();
  const r = fn();
  const dt = performance.now() - t0;
  console.log(`  ${label.padEnd(46)} ${`${dt.toFixed(0)} ms`.padStart(10)}`);
  return { r, dt };
}

const userId = process.env.DEV_LOGIN_USER_ID;
console.log(`db:   ${process.env.DB_PATH ?? "data/rr.db"}`);
console.log(`user: ${userId ?? "(none — set DEV_LOGIN_USER_ID for the find() section)"}`);

const counts = get(`SELECT COUNT(*) n FROM media_items mi WHERE ${POOL_WHERE}`);
const linkStats = get(
  `SELECT COUNT(*) n, SUM(LENGTH(ml.raw_data)) bytes
     FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id
    WHERE ${POOL_WHERE}`
);
console.log(`pool: ${counts.n} items · ${linkStats.n} links · ${(linkStats.bytes / 1e6).toFixed(1)} MB raw_data\n`);

console.log("cost breakdown of ONE full rebuild:");
timed("SQL: metadata only (no raw_data)", () =>
  query(`SELECT mi.id, mi.type, mi.title, mi.release_date, mi.poster_url, mi.created_at,
                ml.source, ml.source_id, ml.last_synced, ml.release_date link_release_date
           FROM media_items mi LEFT JOIN media_links ml ON ml.media_item_id = mi.id
          WHERE ${POOL_WHERE}`).length
);
const { r: rows } = timed("SQL: WITH raw_data (the old buildCache read)", () =>
  query(`SELECT mi.id, mi.type, mi.title, mi.release_date, mi.poster_url, mi.created_at,
                ml.source, ml.source_id, ml.raw_data, ml.release_date link_release_date
           FROM media_items mi LEFT JOIN media_links ml ON ml.media_item_id = mi.id
          WHERE ${POOL_WHERE}`)
);
timed("JSON.parse of every raw_data", () => {
  let n = 0;
  for (const r of rows) if (r.raw_data) { JSON.parse(r.raw_data); n++; }
  return n;
});

console.log("\nend-to-end (getCache via getCatalogIdf):");
invalidateDiscoveryCache();
timed("cold  (nothing cached anywhere)", () => getCatalogIdf().size);
timed("warm  (signature hit, no work)", () => getCatalogIdf().size);
invalidateDiscoveryCache();
timed("rebuild after invalidate", () => getCatalogIdf().size);

// ── The §A case: a membership write must not cost a full rebuild ─────
// Pick a BROWSED item (not yet in the pool) and wishlist it — the write that
// changes POOL_WHERE's membership half.
const browsed = get(
  `SELECT mi.id FROM media_items mi
    WHERE mi.browsed = 1 AND mi.id NOT IN (SELECT media_item_id FROM user_item_state)
    LIMIT 1`
);
if (browsed && userId) {
  console.log("\nmembership write (wishlist a browsed item → pool promotion):");
  getCatalogIdf(); // ensure warm
  const before = find(userId, { limit: 1 }).total;
  run(
    `INSERT OR IGNORE INTO user_item_state (id, user_id, media_item_id, source, relation)
     VALUES (?, ?, ?, 'local', 'wishlist')`,
    [`probe-${browsed.id}`, userId, browsed.id]
  );
  const { r: after } = timed("find() right after the write", () => find(userId, { limit: 1 }).total);
  console.log(`  pool total ${before} → ${after}  ${after === before + 1 ? "✓ promoted immediately" : "✗ NOT promoted"}`);
  run(`DELETE FROM user_item_state WHERE id = ?`, [`probe-${browsed.id}`]);
  const { r: reverted } = timed("find() after undoing the write", () => find(userId, { limit: 1 }).total);
  console.log(`  pool total ${after} → ${reverted}  ${reverted === before ? "✓ demoted immediately" : "✗ NOT demoted"}`);
}

if (userId) {
  console.log("\nfind():");
  invalidateDiscoveryCache();
  timed("find() cold", () => find(userId, { limit: 60 }).total);
  timed("find() warm", () => find(userId, { limit: 60 }).total);
  timed("find() warm #2", () => find(userId, { limit: 60 }).total);
}
