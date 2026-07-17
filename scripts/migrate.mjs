// Standalone migration runner for the live data/rr.db. Reuses the SAME ordered
// migration list as the app (src/lib/migrations.ts) rather than restating it, so
// the two apply paths can't drift. Usage: node scripts/migrate.mjs <db-path>
//
// migrations.ts is TypeScript and (since H2a) imports real app modules via the
// `@/*` alias, which plain Node resolves under neither name. alias-hooks.mjs
// teaches it both; type-stripping is native (Node >= 22.18).
//
// registerHooks(), not the deprecated register() (DEP0205): it runs the hook
// in-thread and synchronously. Hooks only affect LATER imports and a static
// import would be hoisted above this call, so migrations.ts is imported
// dynamically below — that ordering is load-bearing, not style.
import { registerHooks } from "node:module";
import Database from "better-sqlite3";
import { resolve } from "./alias-hooks.mjs";

registerHooks({ resolve });
const { runMigrations } = await import("../src/lib/migrations.ts");

const dbPath = process.argv[2];
if (!dbPath) { console.error("usage: node scripts/migrate.mjs <db-path>"); process.exit(1); }

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const before = db.pragma("user_version", { simple: true });
const applied = runMigrations(db);
const after = db.pragma("user_version", { simple: true });

// ── Verification ────────────────────────────────────────────────────────────
const count = (sql) => db.prepare(sql).get().c;

// Expected user_item_state rows derived independently from the legacy JSON shapes.
const expectedWishlist = count(
  "SELECT COUNT(*) c FROM user_watchlist w, json_each(w.platform_sources) je WHERE json_valid(w.platform_sources)"
);
const expectedLibrary = count(
  "SELECT COUNT(*) c FROM user_library l, json_each(l.metadata) je WHERE l.metadata IS NOT NULL AND json_valid(l.metadata)"
);
const actualWishlist = count("SELECT COUNT(*) c FROM user_item_state WHERE relation='wishlist'");
const actualLibrary = count("SELECT COUNT(*) c FROM user_item_state WHERE relation='library'");

// Spot-check: canonical user_library.rating still equals the average of its
// backfilled per-source ratings (no drift introduced).
const driftSql = `
  SELECT COUNT(*) c FROM user_library l
  JOIN (
    SELECT user_id, media_item_id, ROUND(AVG(rating),1) avg_rating
    FROM user_item_state WHERE relation='library' AND rating IS NOT NULL AND rating > 0
    GROUP BY user_id, media_item_id
  ) s ON s.user_id = l.user_id AND s.media_item_id = l.media_item_id
  WHERE l.rating IS NOT NULL AND ROUND(l.rating,1) != s.avg_rating`;
const ratingDrift = count(driftSql);

const report = {
  dbPath,
  userVersion: { before, after },
  applied,
  externalIds: count("SELECT COUNT(*) c FROM media_external_ids"),
  wishlist: { expected: expectedWishlist, actual: actualWishlist, ok: expectedWishlist === actualWishlist },
  library: { expected: expectedLibrary, actual: actualLibrary, ok: expectedLibrary === actualLibrary },
  ratingDriftRows: ratingDrift,
};
db.close();
console.log(JSON.stringify(report, null, 2));

const ok = report.wishlist.ok && report.library.ok && report.ratingDriftRows === 0;
process.exit(ok ? 0 : 2);
